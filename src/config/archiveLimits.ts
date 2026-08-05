const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

/**
 * Archive safety policy shared with the native extractor. These are security
 * ceilings, not a claim about the largest archive a device can process.
 */
export const archiveLimits = Object.freeze({
  extractionBufferBytes: 64 * 1024,
  fallbackMobileZipInputBytes: 80 * MEBIBYTE,
  maxCompressionRatio: 250,
  maxEntryCompressionRatio: 1_000,
  maxEntries: 10_000,
  maxPathDepth: 32,
  maxPathLengthBytes: 1_024,
  maxTotalUncompressedBytes: 8 * GIBIBYTE,
  minimumFreeDiskReserveBytes: 256 * MEBIBYTE,
  staleExtractionMaxAgeSeconds: 24 * 60 * 60
});

export type NativeArchiveLimits = Pick<
  typeof archiveLimits,
  | "extractionBufferBytes"
  | "maxCompressionRatio"
  | "maxEntryCompressionRatio"
  | "maxEntries"
  | "maxPathDepth"
  | "maxPathLengthBytes"
  | "maxTotalUncompressedBytes"
  | "minimumFreeDiskReserveBytes"
  | "staleExtractionMaxAgeSeconds"
>;
