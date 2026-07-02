import { AppFile, FileType } from "../types";

export type FileCategory =
  | "pdf"
  | "image"
  | "archive"
  | "document"
  | "spreadsheet"
  | "audio"
  | "video"
  | "unknown";

export type FileDetectionSource = "mime" | "extension" | "signature" | "unknown";

export type FileTypeDetection = {
  category: FileCategory;
  fileType: FileType | null;
  normalizedExtension: string | null;
  detectedMimeType: string | null;
  source: FileDetectionSource;
  confidence: "high" | "medium" | "low";
};

export type FileLikeForDetection = Pick<AppFile, "name" | "uri" | "mimeType"> & {
  signatureBytes?: Uint8Array | number[] | null;
};

const mimeToType = new Map<string, FileType | "heic" | "heif" | "tiff" | "gz" | "tgz" | "html" | "md" | "aac" | "m4v">([
  ["application/pdf", "pdf"],
  ["application/vnd.uyap.udf", "udf"],
  ["application/xml", "udf"],
  ["text/xml", "udf"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["text/plain", "txt"],
  ["text/rtf", "rtf"],
  ["application/rtf", "rtf"],
  ["application/vnd.oasis.opendocument.text", "odt"],
  ["text/html", "html"],
  ["text/markdown", "md"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["text/csv", "csv"],
  ["application/vnd.oasis.opendocument.spreadsheet", "ods"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["image/tiff", "tiff"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/x-m4v", "m4v"],
  ["video/webm", "webm"],
  ["video/x-msvideo", "avi"],
  ["video/x-matroska", "mkv"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/mp4", "m4a"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/ogg", "ogg"],
  ["application/zip", "zip"],
  ["application/x-zip-compressed", "zip"],
  ["application/x-tar", "tar"],
  ["application/gzip", "gz"],
  ["application/x-gzip", "gz"],
  ["application/x-gtar", "tgz"],
  ["application/vnd.rar", "rar"],
  ["application/x-rar-compressed", "rar"],
  ["application/x-7z-compressed", "7z"]
]);

const extensionAliases = new Map<string, FileType | "heic" | "heif" | "tiff" | "gz" | "tgz" | "html" | "md" | "aac" | "m4v">([
  ["jpeg", "jpg"],
  ["m4v", "mp4"]
]);

const extensionToType = new Map<string, FileType | "heic" | "heif" | "tiff" | "gz" | "tgz" | "html" | "md" | "aac" | "m4v">([
  ["pdf", "pdf"],
  ["udf", "udf"],
  ["doc", "doc"],
  ["docx", "docx"],
  ["txt", "txt"],
  ["rtf", "rtf"],
  ["odt", "odt"],
  ["html", "html"],
  ["htm", "html"],
  ["md", "md"],
  ["xls", "xls"],
  ["xlsx", "xlsx"],
  ["csv", "csv"],
  ["ods", "ods"],
  ["jpg", "jpg"],
  ["jpeg", "jpg"],
  ["png", "png"],
  ["webp", "webp"],
  ["gif", "gif"],
  ["bmp", "bmp"],
  ["heic", "heic"],
  ["heif", "heif"],
  ["tif", "tiff"],
  ["tiff", "tiff"],
  ["mp4", "mp4"],
  ["mov", "mov"],
  ["m4v", "mp4"],
  ["webm", "webm"],
  ["avi", "avi"],
  ["mkv", "mkv"],
  ["mp3", "mp3"],
  ["wav", "wav"],
  ["m4a", "m4a"],
  ["aac", "aac"],
  ["flac", "flac"],
  ["ogg", "ogg"],
  ["zip", "zip"],
  ["rar", "rar"],
  ["7z", "7z"],
  ["tar", "tar"],
  ["gz", "gz"],
  ["tgz", "tgz"]
]);

const appFileTypes = new Set<FileType>([
  "pdf",
  "udf",
  "docx",
  "doc",
  "txt",
  "rtf",
  "odt",
  "xlsx",
  "xls",
  "csv",
  "ods",
  "jpg",
  "png",
  "gif",
  "bmp",
  "webp",
  "mp4",
  "avi",
  "mov",
  "mkv",
  "webm",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
  "zip",
  "rar",
  "7z",
  "tar"
]);

export function detectFileTypeInfo(file?: FileLikeForDetection | null): FileTypeDetection {
  if (!file) return unknownDetection();

  const detectedMimeType = normalizeMimeType(file.mimeType);
  const normalizedExtension = normalizeExtension(extractExtension(file.name, file.uri));
  const mimeType = detectedMimeType ? mimeToType.get(detectedMimeType) ?? null : null;
  if (mimeType) {
    return makeDetection(mimeType, normalizedExtension, detectedMimeType, "mime", "high");
  }

  const signatureType = detectTypeFromSignature(file.signatureBytes);
  if (signatureType) {
    return makeDetection(signatureType, normalizedExtension, detectedMimeType, "signature", "high");
  }

  const extensionType = normalizedExtension ? extensionToType.get(normalizedExtension) ?? null : null;
  if (extensionType) {
    return makeDetection(extensionType, normalizedExtension, detectedMimeType, "extension", "medium");
  }

  return unknownDetection(normalizedExtension, detectedMimeType);
}

export function fileTypeFromDetection(detection: FileTypeDetection): FileType | null {
  return detection.fileType;
}

export function sanitizeFileNameForLogs(name?: string | null) {
  const decoded = safeDecodeURIComponent(name ?? "");
  const basename = decoded.split(/[\\/]/).pop() || "unknown";
  return basename.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
}

export function normalizeExtension(extension?: string | null) {
  const clean = safeDecodeURIComponent(extension ?? "")
    .split("?")[0]
    .split("#")[0]
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase();
  if (!clean) return null;
  return extensionAliases.get(clean) ?? clean;
}

function makeDetection(
  detectedType: FileType | string,
  normalizedExtension: string | null,
  detectedMimeType: string | null,
  source: FileDetectionSource,
  confidence: FileTypeDetection["confidence"]
): FileTypeDetection {
  return {
    category: categoryForDetectedType(detectedType),
    fileType: appFileTypes.has(detectedType as FileType) ? (detectedType as FileType) : null,
    normalizedExtension,
    detectedMimeType,
    source,
    confidence
  };
}

function unknownDetection(normalizedExtension: string | null = null, detectedMimeType: string | null = null): FileTypeDetection {
  return {
    category: "unknown",
    fileType: null,
    normalizedExtension,
    detectedMimeType,
    source: "unknown",
    confidence: "low"
  };
}

function categoryForDetectedType(type: FileType | string): FileCategory {
  if (type === "pdf") return "pdf";
  if (["jpg", "png", "gif", "bmp", "webp", "heic", "heif", "tiff"].includes(type)) return "image";
  if (["zip", "rar", "7z", "tar", "gz", "tgz"].includes(type)) return "archive";
  if (["doc", "docx", "txt", "rtf", "odt", "udf", "html", "md"].includes(type)) return "document";
  if (["xls", "xlsx", "csv", "ods"].includes(type)) return "spreadsheet";
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(type)) return "audio";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(type)) return "video";
  return "unknown";
}

function normalizeMimeType(mimeType?: string | null) {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") return null;
  return normalized;
}

function extractExtension(name?: string | null, uri?: string | null) {
  const filename = safeDecodeURIComponent(name || extractNameFromUri(uri) || "");
  const withoutQuery = filename.split("?")[0].split("#")[0];
  const lastPart = withoutQuery.split(/[\\/]/).pop() ?? withoutQuery;
  const dotIndex = lastPart.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === lastPart.length - 1) return null;
  return lastPart.slice(dotIndex + 1);
}

function extractNameFromUri(uri?: string | null) {
  if (!uri) return null;
  return uri.split("?")[0].split("#")[0].split(/[\\/]/).pop() ?? null;
}

function detectTypeFromSignature(bytes?: Uint8Array | number[] | null): FileType | null {
  if (!bytes || bytes.length < 4) return null;
  const values = Array.from(bytes.slice(0, Math.min(bytes.length, 265)));

  if (startsWithAscii(values, "%PDF")) return "pdf";
  if (values[0] === 0xff && values[1] === 0xd8 && values[2] === 0xff) return "jpg";
  if (values[0] === 0x89 && startsWithAscii(values.slice(1), "PNG")) return "png";
  if (startsWithAscii(values, "GIF8")) return "gif";
  if (startsWithAscii(values, "PK\u0003\u0004") || startsWithAscii(values, "PK\u0005\u0006") || startsWithAscii(values, "PK\u0007\u0008")) {
    return "zip";
  }
  if (startsWithAscii(values, "Rar!")) return "rar";
  if (values[0] === 0x37 && values[1] === 0x7a && values[2] === 0xbc && values[3] === 0xaf) return "7z";
  if (startsWithAscii(values, "RIFF") && startsWithAscii(values.slice(8), "WEBP")) return "webp";
  if (values.length > 263 && startsWithAscii(values.slice(257), "ustar")) return "tar";
  return null;
}

function startsWithAscii(bytes: number[], text: string) {
  if (bytes.length < text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
