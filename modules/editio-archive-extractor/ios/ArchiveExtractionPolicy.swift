import Foundation

#if canImport(ExpoModulesCore)
import ExpoModulesCore

struct ArchiveExtractionOptionsRecord: Record {
  @Field var extractionBufferBytes: Int = 64 * 1024
  @Field var maxCompressionRatio: Double = 250
  @Field var maxEntryCompressionRatio: Double = 1_000
  @Field var maxEntries: Int = 10_000
  @Field var maxPathDepth: Int = 32
  @Field var maxPathLengthBytes: Int = 1_024
  @Field var maxTotalUncompressedBytes: Double = 8 * 1024 * 1024 * 1024
  @Field var minimumFreeDiskReserveBytes: Double = 256 * 1024 * 1024
  @Field var staleExtractionMaxAgeSeconds: Double = 24 * 60 * 60
}
#endif

struct ArchiveExtractionPolicy {
  let extractionBufferBytes: Int
  let maxCompressionRatio: Double
  let maxEntryCompressionRatio: Double
  let maxEntries: Int
  let maxPathDepth: Int
  let maxPathLengthBytes: Int
  let maxTotalUncompressedBytes: UInt64
  let minimumFreeDiskReserveBytes: UInt64

#if canImport(ExpoModulesCore)
  init(options: ArchiveExtractionOptionsRecord) throws {
    try self.init(
      extractionBufferBytes: options.extractionBufferBytes,
      maxCompressionRatio: options.maxCompressionRatio,
      maxEntryCompressionRatio: options.maxEntryCompressionRatio,
      maxEntries: options.maxEntries,
      maxPathDepth: options.maxPathDepth,
      maxPathLengthBytes: options.maxPathLengthBytes,
      maxTotalUncompressedBytes: options.maxTotalUncompressedBytes,
      minimumFreeDiskReserveBytes: options.minimumFreeDiskReserveBytes
    )
  }
#endif

  init(
    extractionBufferBytes: Int = 64 * 1024,
    maxCompressionRatio: Double = 250,
    maxEntryCompressionRatio: Double = 1_000,
    maxEntries: Int = 10_000,
    maxPathDepth: Int = 32,
    maxPathLengthBytes: Int = 1_024,
    maxTotalUncompressedBytes: Double = 8 * 1024 * 1024 * 1024,
    minimumFreeDiskReserveBytes: Double = 256 * 1024 * 1024
  ) throws {
    let maximumExactlyRepresentableInteger = 9_007_199_254_740_991.0
    guard
      extractionBufferBytes >= 16 * 1024,
      extractionBufferBytes <= 1024 * 1024,
      maxCompressionRatio.isFinite,
      maxCompressionRatio >= 1,
      maxEntryCompressionRatio.isFinite,
      maxEntryCompressionRatio >= 1,
      maxEntries > 0,
      maxPathDepth > 0,
      maxPathLengthBytes > 0,
      maxTotalUncompressedBytes.isFinite,
      maxTotalUncompressedBytes > 0,
      maxTotalUncompressedBytes <= maximumExactlyRepresentableInteger,
      minimumFreeDiskReserveBytes.isFinite,
      minimumFreeDiskReserveBytes >= 0,
      minimumFreeDiskReserveBytes <= maximumExactlyRepresentableInteger
    else {
      throw ArchiveExtractionError.invalidPolicy
    }

    self.extractionBufferBytes = extractionBufferBytes
    self.maxCompressionRatio = maxCompressionRatio
    self.maxEntryCompressionRatio = maxEntryCompressionRatio
    self.maxEntries = maxEntries
    self.maxPathDepth = maxPathDepth
    self.maxPathLengthBytes = maxPathLengthBytes
    self.maxTotalUncompressedBytes = UInt64(maxTotalUncompressedBytes)
    self.minimumFreeDiskReserveBytes = UInt64(minimumFreeDiskReserveBytes)
  }
}

enum ArchiveExtractionError: Error {
  case cancelled
  case duplicateOperation
  case empty
  case encrypted
  case insufficientDisk
  case invalidArchive
  case invalidPolicy
  case nativeException
  case readFailed
  case tooLarge
  case unsafePath
  case unsupportedCompression
  case zip64
  case zipBomb

  var code: String {
    switch self {
    case .cancelled: return "ERR_ARCHIVE_CANCELLED"
    case .duplicateOperation: return "ERR_ARCHIVE_DUPLICATE_OPERATION"
    case .empty: return "ERR_ARCHIVE_EMPTY"
    case .encrypted: return "ERR_ARCHIVE_PASSWORD_REQUIRED"
    case .insufficientDisk: return "ERR_ARCHIVE_INSUFFICIENT_DISK"
    case .invalidArchive: return "ERR_ARCHIVE_INVALID_ZIP"
    case .invalidPolicy: return "ERR_ARCHIVE_INVALID_POLICY"
    case .nativeException: return "ERR_ARCHIVE_NATIVE_FAILURE"
    case .readFailed: return "ERR_FILE_READ_FAILED"
    case .tooLarge: return "ERR_ARCHIVE_TOO_LARGE"
    case .unsafePath: return "ERR_ARCHIVE_UNSAFE_PATH"
    case .unsupportedCompression: return "ERR_ARCHIVE_UNSUPPORTED_COMPRESSION"
    case .zip64: return "ERR_ARCHIVE_ZIP64"
    case .zipBomb: return "ERR_ARCHIVE_ZIP_BOMB"
    }
  }

  var safeDescription: String {
    switch self {
    case .cancelled: return "Archive extraction was cancelled."
    case .duplicateOperation: return "This archive is already being extracted."
    case .empty: return "The archive is empty."
    case .encrypted: return "Encrypted ZIP archives are not supported."
    case .insufficientDisk: return "There is not enough free space to extract this archive."
    case .invalidArchive: return "The ZIP archive is corrupted or incomplete."
    case .invalidPolicy: return "The archive extraction policy is invalid."
    case .nativeException: return "Native archive extraction failed safely."
    case .readFailed: return "The archive file could not be read."
    case .tooLarge: return "The archive exceeds the configured extraction safety ceiling."
    case .unsafePath: return "The archive contains an unsafe file path."
    case .unsupportedCompression: return "The ZIP uses an unsupported compression method."
    case .zip64: return "ZIP64 archives are not supported by this extractor."
    case .zipBomb: return "The archive has a suspicious compression ratio."
    }
  }

  #if canImport(ExpoModulesCore)
  var exception: Exception {
    Exception(name: "EditioArchiveExtractionException", description: safeDescription, code: code)
  }
  #endif
}

enum ArchivePathValidator {
  static func validatedRelativePath(_ rawPath: String, policy: ArchiveExtractionPolicy) throws -> String {
    guard !rawPath.isEmpty, !rawPath.contains("\0") else {
      throw ArchiveExtractionError.unsafePath
    }

    let normalized = rawPath.replacingOccurrences(of: "\\", with: "/").precomposedStringWithCanonicalMapping
    guard
      !normalized.hasPrefix("/"),
      !normalized.hasPrefix("//"),
      normalized.lengthOfBytes(using: .utf8) <= policy.maxPathLengthBytes
    else {
      throw ArchiveExtractionError.unsafePath
    }

    let withoutDirectorySuffix = normalized.hasSuffix("/") ? String(normalized.dropLast()) : normalized
    let components = withoutDirectorySuffix.split(separator: "/", omittingEmptySubsequences: false)
    guard !components.isEmpty, components.count <= policy.maxPathDepth else {
      throw ArchiveExtractionError.unsafePath
    }

    for (index, componentSlice) in components.enumerated() {
      let component = String(componentSlice)
      guard
        !component.isEmpty,
        component != ".",
        component != "..",
        !component.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
      else {
        throw ArchiveExtractionError.unsafePath
      }
      if index == 0, component.count >= 2 {
        let first = component[component.startIndex]
        let secondIndex = component.index(after: component.startIndex)
        if first.isASCII, first.isLetter, component[secondIndex] == ":" {
          throw ArchiveExtractionError.unsafePath
        }
      }
    }

    return components.joined(separator: "/")
  }

  static func collisionKey(for relativePath: String) -> String {
    relativePath.folding(
      options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
      locale: Locale(identifier: "en_US_POSIX")
    )
  }

  static func containedDestination(root: URL, relativePath: String) throws -> URL {
    let standardizedRoot = root.standardizedFileURL
    let destination = standardizedRoot.appendingPathComponent(relativePath).standardizedFileURL
    let rootPrefix = standardizedRoot.path.hasSuffix("/") ? standardizedRoot.path : standardizedRoot.path + "/"
    guard destination.path.hasPrefix(rootPrefix) else {
      throw ArchiveExtractionError.unsafePath
    }
    return destination
  }
}
