import Foundation
import UniformTypeIdentifiers
import ZIPFoundation

typealias NativeArchiveProgressCallback = (_ completedBytes: UInt64, _ totalBytes: UInt64) -> Void

struct NativeExtractedArchiveFile {
  let mimeType: String
  let name: String
  let size: UInt64
  let uri: String

  var dictionary: [String: Any] {
    [
      "mimeType": mimeType,
      "name": name,
      "size": Double(size),
      "uri": uri
    ]
  }
}

private final class NativeZipExtractionOperation {
  let operationId: String
  let sourcePath: String
  private let lock = NSLock()
  private var cancelled = false
  private var currentProgress: Progress?
  private var currentEntryBytes: UInt64 = 0
  private var completedBytes: UInt64 = 0
  private var totalBytes: UInt64 = 0

  init(operationId: String, sourcePath: String) {
    self.operationId = operationId
    self.sourcePath = sourcePath
  }

  func configure(totalBytes: UInt64) {
    lock.lock()
    self.totalBytes = totalBytes
    lock.unlock()
  }

  func beginEntry(progress: Progress, completedBytes: UInt64, entryBytes: UInt64) {
    lock.lock()
    currentProgress = progress
    currentEntryBytes = entryBytes
    self.completedBytes = completedBytes
    if cancelled { progress.cancel() }
    lock.unlock()
  }

  func finishEntry(completedBytes: UInt64) {
    lock.lock()
    currentProgress = nil
    currentEntryBytes = 0
    self.completedBytes = completedBytes
    lock.unlock()
  }

  func cancel() {
    lock.lock()
    cancelled = true
    currentProgress?.cancel()
    lock.unlock()
  }

  func isCancelled() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  func progressSnapshot() -> (completed: UInt64, total: UInt64) {
    lock.lock()
    defer { lock.unlock() }
    let fraction = min(1, max(0, currentProgress?.fractionCompleted ?? 0))
    let entryCompleted = UInt64(Double(currentEntryBytes) * fraction)
    return (min(totalBytes, completedBytes + entryCompleted), totalBytes)
  }
}

private final class NativeZipExtractionRegistry {
  static let shared = NativeZipExtractionRegistry()

  private let lock = NSLock()
  private var operations: [String: NativeZipExtractionOperation] = [:]
  private var activeSourcePaths = Set<String>()
  private var pendingCancellations: [String: Date] = [:]
  private let pendingCancellationLifetime: TimeInterval = 60

  func reserve(operationId: String, sourceURL: URL) throws -> NativeZipExtractionOperation {
    guard NativeZipExtractionService.isValidOperationId(operationId) else {
      throw ArchiveExtractionError.invalidPolicy
    }

    let sourcePath = sourceURL.standardizedFileURL.path
    lock.lock()
    defer { lock.unlock() }
    purgeExpiredCancellations(now: Date())
    guard operations[operationId] == nil, !activeSourcePaths.contains(sourcePath) else {
      throw ArchiveExtractionError.duplicateOperation
    }

    let operation = NativeZipExtractionOperation(operationId: operationId, sourcePath: sourcePath)
    operations[operationId] = operation
    activeSourcePaths.insert(sourcePath)
    if pendingCancellations.removeValue(forKey: operationId) != nil {
      operation.cancel()
    }
    return operation
  }

  func operation(for operationId: String) -> NativeZipExtractionOperation? {
    lock.lock()
    defer { lock.unlock() }
    return operations[operationId]
  }

  func release(_ operation: NativeZipExtractionOperation) {
    lock.lock()
    operations.removeValue(forKey: operation.operationId)
    activeSourcePaths.remove(operation.sourcePath)
    pendingCancellations.removeValue(forKey: operation.operationId)
    lock.unlock()
  }

  func cancel(operationId: String) -> Bool {
    guard NativeZipExtractionService.isValidOperationId(operationId) else { return false }

    lock.lock()
    purgeExpiredCancellations(now: Date())
    let operation = operations[operationId]
    if operation == nil {
      pendingCancellations[operationId] = Date()
    }
    lock.unlock()

    operation?.cancel()
    return true
  }

  func cancelAll() {
    lock.lock()
    let active = Array(operations.values)
    pendingCancellations.removeAll()
    lock.unlock()
    active.forEach { $0.cancel() }
  }

  private func purgeExpiredCancellations(now: Date) {
    pendingCancellations = pendingCancellations.filter {
      now.timeIntervalSince($0.value) < pendingCancellationLifetime
    }
  }
}

enum NativeZipExtractionService {
  private static let fileManager = FileManager.default
  private static let stagingPrefix = ".extracting-"
  private static let outputPrefix = "extracted-"
  private static let progressQueue = DispatchQueue(label: "com.editio.archive.progress", qos: .utility)

  static func reserve(operationId: String, sourceURL: URL) throws -> AnyObject {
    try NativeZipExtractionRegistry.shared.reserve(operationId: operationId, sourceURL: sourceURL)
  }

  static func extractReserved(
    sourceURL: URL,
    operationToken: AnyObject,
    policy: ArchiveExtractionPolicy,
    onProgress: @escaping NativeArchiveProgressCallback
  ) throws -> [NativeExtractedArchiveFile] {
    guard let operation = operationToken as? NativeZipExtractionOperation else {
      throw ArchiveExtractionError.invalidPolicy
    }

    var stagingURL: URL?
    var extractionSucceeded = false
    defer {
      if !extractionSucceeded, let stagingURL {
        try? removeStagingDirectory(stagingURL)
      }
      NativeZipExtractionRegistry.shared.release(operation)
    }

    guard sourceURL.isFileURL else { throw ArchiveExtractionError.readFailed }
    try checkCancellation(operation)

    let preflight = try ZipCentralDirectoryScanner.scan(
      url: sourceURL,
      policy: policy,
      isCancelled: operation.isCancelled
    )
    guard preflight.entryCount > 0 else { throw ArchiveExtractionError.empty }

    let archive: Archive
    do {
      archive = try Archive(url: sourceURL, accessMode: .read)
    } catch {
      throw mapNativeError(error)
    }

    var validatedEntries: [(entry: Entry, relativePath: String)] = []
    var validatedUncompressedBytes: UInt64 = 0
    var collisionKeys = Set<String>()

    for entry in archive {
      try checkCancellation(operation)
      if entry.type == .symlink { throw ArchiveExtractionError.unsafePath }

      let relativePath = try ArchivePathValidator.validatedRelativePath(entry.path, policy: policy)
      let collisionKey = ArchivePathValidator.collisionKey(for: relativePath)
      guard collisionKeys.insert(collisionKey).inserted else {
        throw ArchiveExtractionError.unsafePath
      }

      guard entry.type != .directory else { continue }
      let sum = validatedUncompressedBytes.addingReportingOverflow(entry.uncompressedSize)
      guard !sum.overflow, sum.partialValue <= policy.maxTotalUncompressedBytes else {
        throw ArchiveExtractionError.tooLarge
      }
      validatedUncompressedBytes = sum.partialValue
      validatedEntries.append((entry, relativePath))
    }

    guard !validatedEntries.isEmpty else { throw ArchiveExtractionError.empty }
    guard validatedUncompressedBytes == preflight.totalUncompressedBytes else {
      throw ArchiveExtractionError.invalidArchive
    }

    let archivesURL = try archivesDirectoryURL()
    try ensureEnoughDiskSpace(at: archivesURL, expandedBytes: validatedUncompressedBytes, policy: policy)

    let stagingName = stagingPrefix + operation.operationId
    let proposedStagingURL = archivesURL.appendingPathComponent(stagingName, isDirectory: true)
    try createPrivateDirectory(proposedStagingURL)
    stagingURL = proposedStagingURL

    operation.configure(totalBytes: validatedUncompressedBytes)
    onProgress(0, validatedUncompressedBytes)

    let timer = makeProgressTimer(operation: operation, callback: onProgress)
    defer { timer.cancel() }

    var completedBytes: UInt64 = 0
    var outputs: [(relativePath: String, size: UInt64)] = []
    outputs.reserveCapacity(validatedEntries.count)

    for item in validatedEntries {
      try checkCancellation(operation)
      let destination = try ArchivePathValidator.containedDestination(
        root: proposedStagingURL,
        relativePath: item.relativePath
      )
      let entryProgress = Progress(totalUnitCount: safeInt64(item.entry.uncompressedSize))
      operation.beginEntry(
        progress: entryProgress,
        completedBytes: completedBytes,
        entryBytes: item.entry.uncompressedSize
      )

      let checksum: CRC32
      do {
        checksum = try archive.extract(
          item.entry,
          to: destination,
          bufferSize: policy.extractionBufferBytes,
          skipCRC32: false,
          allowUncontainedSymlinks: false,
          progress: entryProgress
        )
      } catch {
        throw mapNativeError(error)
      }
      guard checksum == item.entry.checksum else { throw ArchiveExtractionError.invalidArchive }

      try setPrivateFilePermissions(destination)
      let actualSize = try regularFileSize(at: destination)
      guard actualSize == item.entry.uncompressedSize else {
        throw ArchiveExtractionError.invalidArchive
      }
      outputs.append((item.relativePath, actualSize))

      let sum = completedBytes.addingReportingOverflow(actualSize)
      guard !sum.overflow else { throw ArchiveExtractionError.tooLarge }
      completedBytes = sum.partialValue
      operation.finishEntry(completedBytes: completedBytes)
      onProgress(completedBytes, validatedUncompressedBytes)
    }

    try checkCancellation(operation)
    try applyPrivateDirectoryPermissionsRecursively(proposedStagingURL)

    let finalURL = uniqueFinalDirectoryURL(in: archivesURL)
    do {
      try fileManager.moveItem(at: proposedStagingURL, to: finalURL)
    } catch {
      throw mapNativeError(error)
    }
    stagingURL = nil

    let metadata = outputs.map { item -> NativeExtractedArchiveFile in
      let fileURL = finalURL.appendingPathComponent(item.relativePath).standardizedFileURL
      return NativeExtractedArchiveFile(
        mimeType: mimeType(for: fileURL),
        name: item.relativePath,
        size: item.size,
        uri: fileURL.absoluteString
      )
    }

    extractionSucceeded = true
    onProgress(validatedUncompressedBytes, validatedUncompressedBytes)
    return metadata
  }

  static func cancel(operationId: String) -> Bool {
    NativeZipExtractionRegistry.shared.cancel(operationId: operationId)
  }

  static func cancelAll() {
    NativeZipExtractionRegistry.shared.cancelAll()
  }

  static func abandonReserved(_ operationToken: AnyObject) {
    guard let operation = operationToken as? NativeZipExtractionOperation else { return }
    operation.cancel()
    if let root = try? archivesDirectoryURL() {
      let staging = root.appendingPathComponent(stagingPrefix + operation.operationId, isDirectory: true)
      try? removeStagingDirectory(staging)
    }
    NativeZipExtractionRegistry.shared.release(operation)
  }

  static func cleanupAbandoned(staleAfterSeconds: TimeInterval) throws -> Int {
    guard staleAfterSeconds.isFinite, staleAfterSeconds >= 60 else {
      throw ArchiveExtractionError.invalidPolicy
    }

    let root = try archivesDirectoryURL()
    let cutoff = Date().addingTimeInterval(-staleAfterSeconds)
    let keys: Set<URLResourceKey> = [.creationDateKey, .contentModificationDateKey, .isDirectoryKey, .isSymbolicLinkKey]
    let candidates = try fileManager.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: Array(keys),
      options: []
    )

    var removed = 0
    for candidate in candidates where candidate.lastPathComponent.hasPrefix(stagingPrefix) {
      let values = try candidate.resourceValues(forKeys: keys)
      guard values.isDirectory == true, values.isSymbolicLink != true else { continue }
      let lastTouched = values.contentModificationDate ?? values.creationDate ?? .distantFuture
      guard lastTouched < cutoff else { continue }
      try removeStagingDirectory(candidate)
      removed += 1
    }
    return removed
  }

  static func isValidOperationId(_ operationId: String) -> Bool {
    guard (8...80).contains(operationId.count) else { return false }
    return operationId.unicodeScalars.allSatisfy {
      CharacterSet.alphanumerics.contains($0) || $0 == "-"
    }
  }

  private static func makeProgressTimer(
    operation: NativeZipExtractionOperation,
    callback: @escaping NativeArchiveProgressCallback
  ) -> DispatchSourceTimer {
    let timer = DispatchSource.makeTimerSource(queue: progressQueue)
    timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100), leeway: .milliseconds(25))
    timer.setEventHandler {
      let snapshot = operation.progressSnapshot()
      callback(snapshot.completed, snapshot.total)
    }
    timer.resume()
    return timer
  }

  private static func archivesDirectoryURL() throws -> URL {
    guard let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw ArchiveExtractionError.readFailed
    }
    let archives = caches.appendingPathComponent("EditioArchiveExtractions", isDirectory: true)
    if !fileManager.fileExists(atPath: archives.path) {
      try createPrivateDirectory(archives)
    }
    return archives
  }

  private static func createPrivateDirectory(_ url: URL) throws {
    do {
      try fileManager.createDirectory(
        at: url,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
      )
    } catch {
      throw mapNativeError(error)
    }
  }

  private static func ensureEnoughDiskSpace(
    at directory: URL,
    expandedBytes: UInt64,
    policy: ArchiveExtractionPolicy
  ) throws {
    let required = expandedBytes.addingReportingOverflow(policy.minimumFreeDiskReserveBytes)
    guard !required.overflow else { throw ArchiveExtractionError.tooLarge }

    let values: URLResourceValues
    do {
      values = try directory.resourceValues(forKeys: [
        .volumeAvailableCapacityForImportantUsageKey,
        .volumeAvailableCapacityKey
      ])
    } catch {
      throw ArchiveExtractionError.insufficientDisk
    }

    let capacity = values.volumeAvailableCapacityForImportantUsage ?? values.volumeAvailableCapacity.map(Int64.init)
    guard let capacity, capacity >= 0, UInt64(capacity) >= required.partialValue else {
      throw ArchiveExtractionError.insufficientDisk
    }
  }

  private static func regularFileSize(at url: URL) throws -> UInt64 {
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard values.isRegularFile == true, let fileSize = values.fileSize, fileSize >= 0 else {
      throw ArchiveExtractionError.invalidArchive
    }
    return UInt64(fileSize)
  }

  private static func setPrivateFilePermissions(_ url: URL) throws {
    do {
      try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    } catch {
      throw mapNativeError(error)
    }
  }

  private static func applyPrivateDirectoryPermissionsRecursively(_ root: URL) throws {
    let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey]
    guard let enumerator = fileManager.enumerator(
      at: root,
      includingPropertiesForKeys: keys,
      options: [.skipsPackageDescendants],
      errorHandler: { _, _ in false }
    ) else {
      throw ArchiveExtractionError.readFailed
    }

    try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    for case let itemURL as URL in enumerator {
      let values = try itemURL.resourceValues(forKeys: Set(keys))
      guard values.isSymbolicLink != true else { throw ArchiveExtractionError.unsafePath }
      if values.isDirectory == true {
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: itemURL.path)
      }
    }
  }

  private static func removeStagingDirectory(_ url: URL) throws {
    let standardized = url.standardizedFileURL
    guard standardized.lastPathComponent.hasPrefix(stagingPrefix) else {
      throw ArchiveExtractionError.unsafePath
    }
    if fileManager.fileExists(atPath: standardized.path) {
      try fileManager.removeItem(at: standardized)
    }
  }

  private static func uniqueFinalDirectoryURL(in root: URL) -> URL {
    root.appendingPathComponent(outputPrefix + UUID().uuidString.lowercased(), isDirectory: true)
  }

  private static func checkCancellation(_ operation: NativeZipExtractionOperation) throws {
    if operation.isCancelled() { throw ArchiveExtractionError.cancelled }
  }

  private static func safeInt64(_ value: UInt64) -> Int64 {
    value > UInt64(Int64.max) ? Int64.max : Int64(value)
  }

  private static func mimeType(for url: URL) -> String {
    let fileExtension = url.pathExtension.lowercased()
    guard !fileExtension.isEmpty else { return "application/octet-stream" }
    return UTType(filenameExtension: fileExtension)?.preferredMIMEType ?? "application/octet-stream"
  }

  private static func mapNativeError(_ error: Error) -> ArchiveExtractionError {
    if let archiveError = error as? ArchiveExtractionError { return archiveError }
    if let zipError = error as? Archive.ArchiveError {
      switch zipError {
      case .cancelledOperation:
        return .cancelled
      case .invalidCompressionMethod:
        return .unsupportedCompression
      case .uncontainedSymlink, .invalidEntryPath:
        return .unsafePath
      case .unwritableArchive:
        return .insufficientDisk
      default:
        return .invalidArchive
      }
    }

    let cocoaError = error as NSError
    if cocoaError.domain == NSCocoaErrorDomain {
      switch CocoaError.Code(rawValue: cocoaError.code) {
      case .fileWriteOutOfSpace, .fileWriteVolumeReadOnly, .fileWriteNoPermission:
        return .insufficientDisk
      case .fileReadNoSuchFile, .fileReadNoPermission:
        return .readFailed
      default:
        break
      }
    }
    return .invalidArchive
  }
}
