import {
  type EventSubscription,
  type NativeModule,
  requireOptionalNativeModule
} from "expo-modules-core";

export type NativeExtractedArchiveFile = {
  mimeType: string;
  name: string;
  size: number;
  uri: string;
};

export type NativeArchiveExtractionOptions = {
  extractionBufferBytes: number;
  maxCompressionRatio: number;
  maxEntryCompressionRatio: number;
  maxEntries: number;
  maxPathDepth: number;
  maxPathLengthBytes: number;
  maxTotalUncompressedBytes: number;
  minimumFreeDiskReserveBytes: number;
  staleExtractionMaxAgeSeconds: number;
};

export type NativeArchiveProgressEvent = {
  completedBytes: number;
  operationId: string;
  progress: number;
  totalBytes: number;
};

type ArchiveEvents = {
  onArchiveProgress: (event: NativeArchiveProgressEvent) => void;
};

type EditioArchiveExtractorNativeModule = NativeModule<ArchiveEvents> & {
  addListener(
    eventName: "onArchiveProgress",
    listener: ArchiveEvents["onArchiveProgress"]
  ): EventSubscription;
  cancel(operationId: string): Promise<boolean>;
  cleanupAbandoned(staleAfterSeconds: number): Promise<number>;
  extractZip(
    sourceUri: string,
    operationId: string,
    options: NativeArchiveExtractionOptions
  ): Promise<NativeExtractedArchiveFile[]>;
};

const nativeModule = requireOptionalNativeModule<EditioArchiveExtractorNativeModule>(
  "EditioArchiveExtractor"
);

export function isNativeArchiveExtractorAvailable() {
  return nativeModule !== null;
}

export function addArchiveProgressListener(
  listener: (event: NativeArchiveProgressEvent) => void
): EventSubscription | null {
  return nativeModule?.addListener("onArchiveProgress", listener) ?? null;
}

export async function extractZipNative(
  sourceUri: string,
  operationId: string,
  options: NativeArchiveExtractionOptions
) {
  if (!nativeModule) {
    throw createUnavailableError();
  }
  return nativeModule.extractZip(sourceUri, operationId, options);
}

export async function cancelNativeZipExtraction(operationId: string) {
  if (!nativeModule) return false;
  return nativeModule.cancel(operationId);
}

export async function cleanupAbandonedNativeExtractions(staleAfterSeconds: number) {
  if (!nativeModule) return 0;
  return nativeModule.cleanupAbandoned(staleAfterSeconds);
}

function createUnavailableError() {
  const error = new Error("ERR_ARCHIVE_NATIVE_REQUIRED") as Error & { code?: string };
  error.code = "ERR_ARCHIVE_NATIVE_REQUIRED";
  return error;
}
