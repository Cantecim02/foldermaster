import Foundation

struct ZipPreflightResult {
  let entryCount: Int
  let totalCompressedBytes: UInt64
  let totalUncompressedBytes: UInt64
}

enum ZipCentralDirectoryScanner {
  private static let endOfCentralDirectorySignature: UInt32 = 0x06054b50
  private static let centralDirectorySignature: UInt32 = 0x02014b50
  private static let maximumEndRecordSearchBytes = 65_557

  static func scan(
    url: URL,
    policy: ArchiveExtractionPolicy,
    isCancelled: () -> Bool
  ) throws -> ZipPreflightResult {
    guard url.isFileURL else { throw ArchiveExtractionError.readFailed }

    let attributes: [FileAttributeKey: Any]
    do {
      attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    } catch {
      throw ArchiveExtractionError.readFailed
    }
    guard
      attributes[.type] as? FileAttributeType == .typeRegular,
      let fileSizeNumber = attributes[.size] as? NSNumber
    else {
      throw ArchiveExtractionError.readFailed
    }

    let fileSize = fileSizeNumber.uint64Value
    guard fileSize >= 22 else { throw ArchiveExtractionError.invalidArchive }

    let handle: FileHandle
    do {
      handle = try FileHandle(forReadingFrom: url)
    } catch {
      throw ArchiveExtractionError.readFailed
    }
    defer { try? handle.close() }

    let tailLength = Int(min(UInt64(maximumEndRecordSearchBytes), fileSize))
    let tailOffset = fileSize - UInt64(tailLength)
    let tail = try readExactly(handle, offset: tailOffset, count: tailLength)
    let endRecordIndex = try findEndRecord(in: tail)

    let diskNumber = try tail.uint16LE(at: endRecordIndex + 4)
    let centralDirectoryDisk = try tail.uint16LE(at: endRecordIndex + 6)
    let entriesOnDisk = try tail.uint16LE(at: endRecordIndex + 8)
    let totalEntries = try tail.uint16LE(at: endRecordIndex + 10)
    let centralDirectorySize = try tail.uint32LE(at: endRecordIndex + 12)
    let centralDirectoryOffset = try tail.uint32LE(at: endRecordIndex + 16)

    guard diskNumber == 0, centralDirectoryDisk == 0, entriesOnDisk == totalEntries else {
      throw ArchiveExtractionError.invalidArchive
    }
    if totalEntries == UInt16.max || centralDirectorySize == UInt32.max || centralDirectoryOffset == UInt32.max {
      throw ArchiveExtractionError.zip64
    }
    guard Int(totalEntries) <= policy.maxEntries else { throw ArchiveExtractionError.tooLarge }

    let endRecordFileOffset = tailOffset + UInt64(endRecordIndex)
    let directoryEnd = UInt64(centralDirectoryOffset) + UInt64(centralDirectorySize)
    guard directoryEnd <= endRecordFileOffset, directoryEnd <= fileSize else {
      throw ArchiveExtractionError.invalidArchive
    }

    var cursor = UInt64(centralDirectoryOffset)
    var totalCompressed: UInt64 = 0
    var totalUncompressed: UInt64 = 0
    var collisionKeys = Set<String>()

    for _ in 0..<Int(totalEntries) {
      if isCancelled() { throw ArchiveExtractionError.cancelled }
      let fixed = try readExactly(handle, offset: cursor, count: 46)
      guard try fixed.uint32LE(at: 0) == centralDirectorySignature else {
        throw ArchiveExtractionError.invalidArchive
      }

      let versionNeeded = try fixed.uint16LE(at: 6)
      let flags = try fixed.uint16LE(at: 8)
      let compressionMethod = try fixed.uint16LE(at: 10)
      let compressedSize = try fixed.uint32LE(at: 20)
      let uncompressedSize = try fixed.uint32LE(at: 24)
      let fileNameLength = Int(try fixed.uint16LE(at: 28))
      let extraLength = Int(try fixed.uint16LE(at: 30))
      let commentLength = Int(try fixed.uint16LE(at: 32))
      let diskStart = try fixed.uint16LE(at: 34)
      let localHeaderOffset = try fixed.uint32LE(at: 42)

      if flags & 0x0001 != 0 || flags & 0x0040 != 0 {
        throw ArchiveExtractionError.encrypted
      }
      guard compressionMethod == 0 || compressionMethod == 8 else {
        throw ArchiveExtractionError.unsupportedCompression
      }
      if versionNeeded >= 45 || compressedSize == UInt32.max || uncompressedSize == UInt32.max ||
          diskStart == UInt16.max || localHeaderOffset == UInt32.max {
        throw ArchiveExtractionError.zip64
      }
      guard fileNameLength > 0, fileNameLength <= policy.maxPathLengthBytes else {
        throw ArchiveExtractionError.unsafePath
      }

      let variableOffset = cursor + 46
      let pathData = try readExactly(handle, offset: variableOffset, count: fileNameLength)
      let extraData = try readExactly(handle, offset: variableOffset + UInt64(fileNameLength), count: extraLength)
      if try containsZip64Extra(extraData) { throw ArchiveExtractionError.zip64 }

      let encoding: String.Encoding = flags & 0x0800 != 0 ? .utf8 : .isoLatin1
      guard let rawPath = String(data: pathData, encoding: encoding) else {
        throw ArchiveExtractionError.unsafePath
      }
      let path = try ArchivePathValidator.validatedRelativePath(rawPath, policy: policy)
      let collisionKey = ArchivePathValidator.collisionKey(for: path)
      guard collisionKeys.insert(collisionKey).inserted else {
        throw ArchiveExtractionError.unsafePath
      }

      let compressed = UInt64(compressedSize)
      let uncompressed = UInt64(uncompressedSize)
      if uncompressed > 0 {
        guard compressed > 0 else { throw ArchiveExtractionError.zipBomb }
        let entryRatio = Double(uncompressed) / Double(compressed)
        guard entryRatio <= policy.maxEntryCompressionRatio else {
          throw ArchiveExtractionError.zipBomb
        }
      }

      let compressedSum = totalCompressed.addingReportingOverflow(compressed)
      let uncompressedSum = totalUncompressed.addingReportingOverflow(uncompressed)
      guard !compressedSum.overflow, !uncompressedSum.overflow else {
        throw ArchiveExtractionError.tooLarge
      }
      totalCompressed = compressedSum.partialValue
      totalUncompressed = uncompressedSum.partialValue
      guard totalUncompressed <= policy.maxTotalUncompressedBytes else {
        throw ArchiveExtractionError.tooLarge
      }

      let variableLength = fileNameLength + extraLength + commentLength
      cursor = variableOffset + UInt64(variableLength)
      guard cursor <= directoryEnd else { throw ArchiveExtractionError.invalidArchive }
    }

    guard cursor == directoryEnd else { throw ArchiveExtractionError.invalidArchive }
    if totalEntries > 0, totalUncompressed > 0 {
      guard totalCompressed > 0 else { throw ArchiveExtractionError.zipBomb }
      let overallRatio = Double(totalUncompressed) / Double(totalCompressed)
      guard overallRatio <= policy.maxCompressionRatio else {
        throw ArchiveExtractionError.zipBomb
      }
    }

    return ZipPreflightResult(
      entryCount: Int(totalEntries),
      totalCompressedBytes: totalCompressed,
      totalUncompressedBytes: totalUncompressed
    )
  }

  private static func findEndRecord(in tail: Data) throws -> Int {
    guard tail.count >= 22 else { throw ArchiveExtractionError.invalidArchive }
    for index in stride(from: tail.count - 22, through: 0, by: -1) {
      guard (try? tail.uint32LE(at: index)) == endOfCentralDirectorySignature else { continue }
      guard let commentLength = try? tail.uint16LE(at: index + 20) else { continue }
      if index + 22 + Int(commentLength) == tail.count {
        return index
      }
    }
    throw ArchiveExtractionError.invalidArchive
  }

  private static func containsZip64Extra(_ data: Data) throws -> Bool {
    var cursor = 0
    while cursor < data.count {
      guard cursor + 4 <= data.count else { throw ArchiveExtractionError.invalidArchive }
      let identifier = try data.uint16LE(at: cursor)
      let size = Int(try data.uint16LE(at: cursor + 2))
      cursor += 4
      guard cursor + size <= data.count else { throw ArchiveExtractionError.invalidArchive }
      if identifier == 0x0001 { return true }
      cursor += size
    }
    return false
  }

  private static func readExactly(_ handle: FileHandle, offset: UInt64, count: Int) throws -> Data {
    guard count >= 0 else { throw ArchiveExtractionError.invalidArchive }
    do {
      try handle.seek(toOffset: offset)
      let data = try handle.read(upToCount: count) ?? Data()
      guard data.count == count else { throw ArchiveExtractionError.invalidArchive }
      return data
    } catch let error as ArchiveExtractionError {
      throw error
    } catch {
      throw ArchiveExtractionError.readFailed
    }
  }
}

private extension Data {
  func uint16LE(at index: Int) throws -> UInt16 {
    guard index >= 0, index + 2 <= count else { throw ArchiveExtractionError.invalidArchive }
    return UInt16(self[index]) | (UInt16(self[index + 1]) << 8)
  }

  func uint32LE(at index: Int) throws -> UInt32 {
    guard index >= 0, index + 4 <= count else { throw ArchiveExtractionError.invalidArchive }
    return UInt32(self[index]) |
      (UInt32(self[index + 1]) << 8) |
      (UInt32(self[index + 2]) << 16) |
      (UInt32(self[index + 3]) << 24)
  }
}
