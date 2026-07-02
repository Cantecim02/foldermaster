import { AppFile } from "../types";
import {
  FileCategory,
  FileTypeDetection,
  detectFileTypeInfo,
  sanitizeFileNameForLogs
} from "./fileTypeDetector";

export type FileOperation =
  | "open"
  | "convert"
  | "archive.extract"
  | "archive.compress"
  | "editor.open"
  | "read-aloud";

export type DestinationModule =
  | "pdf-editor"
  | "image-converter"
  | "archive"
  | "document-converter"
  | "spreadsheet-converter"
  | "audio-converter"
  | "video-converter"
  | "unsupported";

export type FileRoute = {
  canStart: boolean;
  operation: FileOperation;
  category: FileCategory;
  destinationModule: DestinationModule;
  detection: FileTypeDetection;
  reason?: "unsupported-file-type" | "unsupported-archive-format" | "native-required";
};

export const archivePickerMimeTypes = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-gtar",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed"
];

const extractableArchiveExtensions = new Set(["zip", "tar"]);
const nativeArchiveExtensions = new Set(["rar", "7z"]);
const recognizedArchiveExtensions = new Set(["zip", "tar", "rar", "7z", "gz", "tgz"]);

export function routeFileForOperation(file: AppFile | null | undefined, operation: FileOperation): FileRoute {
  const detection = detectFileTypeInfo(file);
  const destinationModule = destinationForCategory(detection.category);

  if (!file || detection.category === "unknown") {
    return {
      canStart: false,
      operation,
      category: detection.category,
      destinationModule: "unsupported",
      detection,
      reason: "unsupported-file-type"
    };
  }

  if (operation === "archive.extract") {
    return routeArchiveExtraction(detection, operation);
  }

  return {
    canStart: destinationModule !== "unsupported",
    operation,
    category: detection.category,
    destinationModule,
    detection,
    reason: destinationModule === "unsupported" ? "unsupported-file-type" : undefined
  };
}

export function canExtractArchive(file: AppFile | null | undefined) {
  return routeFileForOperation(file, "archive.extract").canStart;
}

export function createFileRouteLogMetadata(route: FileRoute, file?: Pick<AppFile, "name"> | null) {
  return {
    feature: "file-router",
    fileName: sanitizeFileNameForLogs(file?.name),
    detectedExtension: route.detection.normalizedExtension,
    detectedMimeType: route.detection.detectedMimeType,
    category: route.category,
    destinationModule: route.destinationModule,
    operation: route.operation,
    source: route.detection.source,
    confidence: route.detection.confidence,
    canStart: route.canStart,
    reason: route.reason
  };
}

function routeArchiveExtraction(detection: FileTypeDetection, operation: FileOperation): FileRoute {
  const archiveType = detection.fileType ?? detection.normalizedExtension;
  const destinationModule = detection.category === "archive" ? "archive" : destinationForCategory(detection.category);

  if (!archiveType || !recognizedArchiveExtensions.has(archiveType) || detection.category !== "archive") {
    return {
      canStart: false,
      operation,
      category: detection.category,
      destinationModule,
      detection,
      reason: "unsupported-file-type"
    };
  }

  if (extractableArchiveExtensions.has(archiveType)) {
    return {
      canStart: true,
      operation,
      category: "archive",
      destinationModule: "archive",
      detection
    };
  }

  return {
    canStart: false,
    operation,
    category: "archive",
    destinationModule: "archive",
    detection,
    reason: nativeArchiveExtensions.has(archiveType) ? "native-required" : "unsupported-archive-format"
  };
}

function destinationForCategory(category: FileCategory): DestinationModule {
  if (category === "pdf") return "pdf-editor";
  if (category === "image") return "image-converter";
  if (category === "archive") return "archive";
  if (category === "document") return "document-converter";
  if (category === "spreadsheet") return "spreadsheet-converter";
  if (category === "audio") return "audio-converter";
  if (category === "video") return "video-converter";
  return "unsupported";
}
