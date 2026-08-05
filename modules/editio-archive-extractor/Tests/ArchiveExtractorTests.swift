import Foundation
import Darwin
import XCTest
import ZIPFoundation
@testable import EditioArchiveExtractorCore

final class ArchiveExtractorTests: XCTestCase {
  private let fileManager = FileManager.default

  func testSmallZipExtractsFileToFileAndReturnsMetadataOnly() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("small.zip")
      try makeStreamingArchive(at: archiveURL, entries: [("notes/readme.txt", 8 * 1024, 0x41)])

      var progressValues: [Double] = []
      let files = try extract(archiveURL, operationId: operationId("small")) { completed, total in
        progressValues.append(total == 0 ? 0 : Double(completed) / Double(total))
      }
      defer { removeOutputDirectory(for: files) }

      XCTAssertEqual(files.count, 1)
      XCTAssertEqual(files[0].name, "notes/readme.txt")
      XCTAssertEqual(files[0].size, 8 * 1024)
      XCTAssertEqual(files[0].mimeType, "text/plain")
      XCTAssertTrue(FileManager.default.fileExists(atPath: try XCTUnwrap(URL(string: files[0].uri)).path))
      XCTAssertEqual(Set(files[0].dictionary.keys), Set(["mimeType", "name", "size", "uri"]))
      XCTAssertLessThan(try JSONSerialization.data(withJSONObject: files[0].dictionary).count, 1_024)
      XCTAssertEqual(progressValues.first, 0)
      XCTAssertEqual(progressValues.last, 1)
    }
  }

  func testGenerated600MBVideoExtractsWithoutPuttingBinaryInMetadata() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("large-video.zip")
      let largeSize = 600 * 1024 * 1024
      try makeStreamingArchive(at: archiveURL, entries: [("media/large.mp4", largeSize, 0x5A)])

      let peakBefore = peakResidentBytes()
      let files = try extract(archiveURL, operationId: operationId("large"))
      let peakAfter = peakResidentBytes()
      defer { removeOutputDirectory(for: files) }

      XCTAssertEqual(files.map(\.size), [UInt64(largeSize)])
      XCTAssertEqual(files.map(\.mimeType), ["video/mp4"])
      XCTAssertLessThan(try JSONSerialization.data(withJSONObject: files.map(\.dictionary)).count, 2_048)

      let peakGrowth = peakAfter >= peakBefore ? peakAfter - peakBefore : 0
      print("EDITIO_ARCHIVE_600MB_PEAK_RSS_GROWTH_BYTES=\(peakGrowth)")
      XCTAssertLessThan(peakGrowth, 160 * 1024 * 1024)
    }
  }

  func testSeveralLargeVideosRemainFilesystemMetadata() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("videos.zip")
      let entrySize = 24 * 1024 * 1024
      try makeStreamingArchive(at: archiveURL, entries: [
        ("video/one.mp4", entrySize, 0x11),
        ("video/two.mp4", entrySize, 0x22),
        ("video/three.mp4", entrySize, 0x33)
      ])

      let files = try extract(archiveURL, operationId: operationId("videos"))
      defer { removeOutputDirectory(for: files) }

      XCTAssertEqual(files.count, 3)
      XCTAssertTrue(files.allSatisfy { $0.mimeType == "video/mp4" && $0.size == UInt64(entrySize) })
      XCTAssertTrue(files.allSatisfy { Set($0.dictionary.keys) == Set(["mimeType", "name", "size", "uri"]) })
    }
  }

  func testCorruptZipIsRejected() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("corrupt.zip")
      try Data("not a zip".utf8).write(to: archiveURL)
      assertArchiveError("ERR_ARCHIVE_INVALID_ZIP") {
        _ = try self.extract(archiveURL, operationId: self.operationId("corrupt"))
      }
    }
  }

  func testEncryptedZipIsRejectedBeforeExtraction() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("encrypted.zip")
      try makeRawStoredZip(at: archiveURL, path: "secret.txt", flags: 0x0001)
      assertArchiveError("ERR_ARCHIVE_PASSWORD_REQUIRED") {
        _ = try self.extract(archiveURL, operationId: self.operationId("encrypted"))
      }
    }
  }

  func testUnsupportedCompressionIsRejected() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("unsupported.zip")
      try makeRawStoredZip(at: archiveURL, path: "file.bin", method: 99)
      assertArchiveError("ERR_ARCHIVE_UNSUPPORTED_COMPRESSION") {
        _ = try self.extract(archiveURL, operationId: self.operationId("method"))
      }
    }
  }

  func testPathTraversalAndAbsolutePathsAreRejected() throws {
    for path in ["../escape.txt", "/private/escape.txt", "C:/escape.txt", "folder/../../escape.txt"] {
      try withTemporaryDirectory { directory in
        let archiveURL = directory.appendingPathComponent("unsafe.zip")
        try makeRawStoredZip(at: archiveURL, path: path)
        assertArchiveError("ERR_ARCHIVE_UNSAFE_PATH") {
          _ = try self.extract(archiveURL, operationId: self.operationId("unsafe"))
        }
      }
    }
  }

  func testZipBombMetadataIsRejectedWithoutAllocatingDeclaredOutput() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("bomb.zip")
      try makeRawStoredZip(
        at: archiveURL,
        path: "huge.bin",
        payload: Data([0]),
        declaredUncompressedSize: 600 * 1024 * 1024
      )
      assertArchiveError("ERR_ARCHIVE_ZIP_BOMB") {
        _ = try self.extract(archiveURL, operationId: self.operationId("bomb"))
      }
    }
  }

  func testInsufficientDiskIsRejectedBeforeStaging() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("disk.zip")
      try makeStreamingArchive(at: archiveURL, entries: [("file.bin", 4 * 1024, 0x44)])
      let available = try availableCapacity()
      let policy = try ArchiveExtractionPolicy(
        maxTotalUncompressedBytes: Double(available + 4 * 1024),
        minimumFreeDiskReserveBytes: Double(available + 1)
      )
      assertArchiveError("ERR_ARCHIVE_INSUFFICIENT_DISK") {
        _ = try self.extract(archiveURL, operationId: self.operationId("disk"), policy: policy)
      }
    }
  }

  func testCancellationRequestedBeforeReservationIsHonored() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("cancel.zip")
      try makeStreamingArchive(at: archiveURL, entries: [("movie.mp4", 8 * 1024 * 1024, 0x55)])
      let id = operationId("cancel")
      XCTAssertTrue(NativeZipExtractionService.cancel(operationId: id))
      assertArchiveError("ERR_ARCHIVE_CANCELLED") {
        _ = try self.extract(archiveURL, operationId: id)
      }
      XCTAssertFalse(stagingDirectories().contains { $0.lastPathComponent.contains(id) })
    }
  }

  func testActiveExtractionCanBeCancelledAndCleansStaging() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("active-cancel.zip")
      try makeStreamingArchive(at: archiveURL, entries: [("movie.mp4", 256 * 1024 * 1024, 0x5C)])
      let id = operationId("active-cancel")
      let before = Set(stagingDirectories().map(\.path))

      let finished = expectation(description: "native extraction rejects after cancellation")
      let result = LockedExtractionResult()
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          _ = try self.extract(archiveURL, operationId: id)
          result.storeSuccess()
        } catch {
          result.store(error: error)
        }
        finished.fulfill()
      }

      let deadline = Date().addingTimeInterval(5)
      while Date() < deadline,
            Set(stagingDirectories().map(\.path)).subtracting(before).isEmpty {
        usleep(1_000)
      }
      XCTAssertFalse(Set(stagingDirectories().map(\.path)).subtracting(before).isEmpty)
      XCTAssertTrue(NativeZipExtractionService.cancel(operationId: id))
      wait(for: [finished], timeout: 10)

      guard case let .failure(error as ArchiveExtractionError) = result.value else {
        return XCTFail("Expected ERR_ARCHIVE_CANCELLED, received \(String(describing: result.value))")
      }
      XCTAssertEqual(error.code, "ERR_ARCHIVE_CANCELLED")

      XCTAssertEqual(Set(stagingDirectories().map(\.path)), before)
    }
  }

  func testDuplicateSourceCannotStartTwice() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("duplicate.zip")
      try makeStreamingArchive(at: archiveURL, entries: [("file.txt", 1_024, 0x66)])
      let token = try NativeZipExtractionService.reserve(operationId: operationId("first"), sourceURL: archiveURL)
      defer { NativeZipExtractionService.abandonReserved(token) }
      assertArchiveError("ERR_ARCHIVE_DUPLICATE_OPERATION") {
        _ = try NativeZipExtractionService.reserve(
          operationId: self.operationId("second"),
          sourceURL: archiveURL
        )
      }
    }
  }

  func testExtractionFailureRejectsAndCleansStagingDirectory() throws {
    try withTemporaryDirectory { directory in
      let archiveURL = directory.appendingPathComponent("bad-crc.zip")
      try makeRawStoredZip(at: archiveURL, path: "bad.bin", forcedCRC32: 0)
      let before = Set(stagingDirectories().map(\.path))
      assertArchiveError("ERR_ARCHIVE_INVALID_ZIP") {
        _ = try self.extract(archiveURL, operationId: self.operationId("badcrc"))
      }
      XCTAssertEqual(Set(stagingDirectories().map(\.path)), before)
    }
  }

  func testAbandonedTemporaryDirectoryCleanupOnlyRemovesStaleStaging() throws {
    let root = extractionRoot()
    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    let stale = root.appendingPathComponent(".extracting-stale-test", isDirectory: true)
    let fresh = root.appendingPathComponent(".extracting-fresh-test", isDirectory: true)
    try? fileManager.removeItem(at: stale)
    try? fileManager.removeItem(at: fresh)
    try fileManager.createDirectory(at: stale, withIntermediateDirectories: false)
    try fileManager.createDirectory(at: fresh, withIntermediateDirectories: false)
    try fileManager.setAttributes(
      [.modificationDate: Date().addingTimeInterval(-3_600)],
      ofItemAtPath: stale.path
    )
    defer {
      try? fileManager.removeItem(at: stale)
      try? fileManager.removeItem(at: fresh)
    }

    XCTAssertEqual(try NativeZipExtractionService.cleanupAbandoned(staleAfterSeconds: 60), 1)
    XCTAssertFalse(fileManager.fileExists(atPath: stale.path))
    XCTAssertTrue(fileManager.fileExists(atPath: fresh.path))
  }

  private func extract(
    _ archiveURL: URL,
    operationId: String,
    policy: ArchiveExtractionPolicy? = nil,
    onProgress: @escaping NativeArchiveProgressCallback = { _, _ in }
  ) throws -> [NativeExtractedArchiveFile] {
    let token = try NativeZipExtractionService.reserve(operationId: operationId, sourceURL: archiveURL)
    let extractionPolicy = try policy ?? ArchiveExtractionPolicy()
    return try NativeZipExtractionService.extractReserved(
      sourceURL: archiveURL,
      operationToken: token,
      policy: extractionPolicy,
      onProgress: onProgress
    )
  }

  private func makeStreamingArchive(
    at url: URL,
    entries: [(path: String, size: Int, byte: UInt8)]
  ) throws {
    let archive = try Archive(url: url, accessMode: .create)
    for entry in entries {
      try archive.addEntry(
        with: entry.path,
        type: .file,
        uncompressedSize: Int64(entry.size),
        compressionMethod: .none,
        bufferSize: 64 * 1024
      ) { position, requestedSize in
        let remaining = entry.size - Int(position)
        return Data(repeating: entry.byte, count: min(requestedSize, remaining))
      }
    }
  }

  private func makeRawStoredZip(
    at url: URL,
    path: String,
    flags: UInt16 = 0,
    method: UInt16 = 0,
    payload: Data = Data([0x41]),
    declaredUncompressedSize: UInt32? = nil,
    forcedCRC32: UInt32? = nil
  ) throws {
    let name = Data(path.utf8)
    let checksum = forcedCRC32 ?? crc32(payload)
    let compressedSize = UInt32(payload.count)
    let uncompressedSize = declaredUncompressedSize ?? compressedSize

    var local = Data()
    local.appendLE(UInt32(0x04034b50))
    local.appendLE(UInt16(20))
    local.appendLE(flags)
    local.appendLE(method)
    local.appendLE(UInt16(0))
    local.appendLE(UInt16(0))
    local.appendLE(checksum)
    local.appendLE(compressedSize)
    local.appendLE(uncompressedSize)
    local.appendLE(UInt16(name.count))
    local.appendLE(UInt16(0))
    local.append(name)
    local.append(payload)

    var central = Data()
    central.appendLE(UInt32(0x02014b50))
    central.appendLE(UInt16(20))
    central.appendLE(UInt16(20))
    central.appendLE(flags)
    central.appendLE(method)
    central.appendLE(UInt16(0))
    central.appendLE(UInt16(0))
    central.appendLE(checksum)
    central.appendLE(compressedSize)
    central.appendLE(uncompressedSize)
    central.appendLE(UInt16(name.count))
    central.appendLE(UInt16(0))
    central.appendLE(UInt16(0))
    central.appendLE(UInt16(0))
    central.appendLE(UInt16(0))
    central.appendLE(UInt32(0))
    central.appendLE(UInt32(0))
    central.append(name)

    var end = Data()
    end.appendLE(UInt32(0x06054b50))
    end.appendLE(UInt16(0))
    end.appendLE(UInt16(0))
    end.appendLE(UInt16(1))
    end.appendLE(UInt16(1))
    end.appendLE(UInt32(central.count))
    end.appendLE(UInt32(local.count))
    end.appendLE(UInt16(0))

    var zip = local
    zip.append(central)
    zip.append(end)
    try zip.write(to: url, options: .atomic)
  }

  private func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
    let directory = fileManager.temporaryDirectory
      .appendingPathComponent("editio-archive-test-\(UUID().uuidString)", isDirectory: true)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: false)
    defer { try? fileManager.removeItem(at: directory) }
    try body(directory)
  }

  private func assertArchiveError(
    _ expectedCode: String,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ body: () throws -> Void
  ) {
    do {
      try body()
      XCTFail("Expected \(expectedCode)", file: file, line: line)
    } catch let error as ArchiveExtractionError {
      XCTAssertEqual(error.code, expectedCode, file: file, line: line)
    } catch {
      XCTFail("Unexpected error: \(error)", file: file, line: line)
    }
  }

  private func removeOutputDirectory(for files: [NativeExtractedArchiveFile]) {
    guard let uri = files.first?.uri, let fileURL = URL(string: uri) else { return }
    let root = extractionRoot().standardizedFileURL
    var candidate = fileURL.deletingLastPathComponent().standardizedFileURL
    while candidate.path.hasPrefix(root.path + "/") {
      if candidate.deletingLastPathComponent().standardizedFileURL.path == root.path {
        try? fileManager.removeItem(at: candidate)
        return
      }
      candidate.deleteLastPathComponent()
    }
  }

  private func stagingDirectories() -> [URL] {
    (try? fileManager.contentsOfDirectory(at: extractionRoot(), includingPropertiesForKeys: nil))?
      .filter { $0.lastPathComponent.hasPrefix(".extracting-") } ?? []
  }

  private func extractionRoot() -> URL {
    fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("EditioArchiveExtractions", isDirectory: true)
  }

  private func availableCapacity() throws -> UInt64 {
    let root = extractionRoot()
    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    let values = try root.resourceValues(forKeys: [
      .volumeAvailableCapacityForImportantUsageKey,
      .volumeAvailableCapacityKey
    ])
    let capacity = values.volumeAvailableCapacityForImportantUsage ?? values.volumeAvailableCapacity.map(Int64.init)
    return UInt64(try XCTUnwrap(capacity))
  }

  private func operationId(_ prefix: String) -> String {
    "\(prefix)-\(UUID().uuidString.lowercased())"
  }

  private func peakResidentBytes() -> UInt64 {
    var usage = rusage()
    guard getrusage(RUSAGE_SELF, &usage) == 0 else { return 0 }
    return UInt64(max(0, usage.ru_maxrss))
  }

  private func crc32(_ data: Data) -> UInt32 {
    var value: UInt32 = 0xffff_ffff
    for byte in data {
      value ^= UInt32(byte)
      for _ in 0..<8 {
        value = (value >> 1) ^ ((value & 1) == 1 ? 0xedb8_8320 : 0)
      }
    }
    return value ^ 0xffff_ffff
  }
}

private final class LockedExtractionResult: @unchecked Sendable {
  enum Value: CustomStringConvertible {
    case failure(Error)
    case pending
    case success

    var description: String {
      switch self {
      case let .failure(error): return "failure(\(error))"
      case .pending: return "pending"
      case .success: return "success"
      }
    }
  }

  private let lock = NSLock()
  private var storedValue: Value = .pending

  var value: Value {
    lock.lock()
    defer { lock.unlock() }
    return storedValue
  }

  func store(error: Error) {
    lock.lock()
    storedValue = .failure(error)
    lock.unlock()
  }

  func storeSuccess() {
    lock.lock()
    storedValue = .success
    lock.unlock()
  }
}

private extension Data {
  mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
    var littleEndian = value.littleEndian
    Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
  }
}
