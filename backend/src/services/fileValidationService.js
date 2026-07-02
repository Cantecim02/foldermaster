import { open } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import { HttpError } from "../utils/httpError.js";

const SUPPORTED_KINDS = new Set(["pdf", "jpg", "png", "webp", "gif", "wav", "mp3", "mp4", "mov", "avi", "mkv", "webm"]);
const CONVERT_FILE_KINDS = [...SUPPORTED_KINDS];

export async function validateUploadedFiles(files, allowedKinds, { signal } = {}) {
  const uploadFiles = [files].flat().filter(Boolean);
  for (const file of uploadFiles) {
    await validateUploadedFile(file, allowedKinds, { signal });
  }
}

export async function validateUploadedFile(file, allowedKinds, { signal } = {}) {
  assertNotAborted(signal);
  const detected = await detectUploadedFile(file.path);
  assertNotAborted(signal);

  if (!detected || !SUPPORTED_KINDS.has(detected.kind)) {
    throw new HttpError(415, "Unsupported file type.", { code: "UNSUPPORTED_FILE_TYPE" });
  }

  if (!allowedKinds.includes(detected.kind)) {
    throw new HttpError(415, "File content does not match the selected conversion.", {
      code: "INVALID_FILE_CONTENT",
      details: { detected: detected.kind, allowed: allowedKinds }
    });
  }

  file.detectedKind = detected.kind;
  file.detectedMime = detected.mime;
  return detected;
}

export async function detectUploadedFile(filePath) {
  const header = await readHeader(filePath);
  const fallback = detectFromHeader(header);
  if (fallback) return fallback;

  const detected = await fileTypeFromFile(filePath).catch(() => null);
  if (!detected) return null;
  return mapFileType(detected);
}

export function allowedKindsForOutput(outputFormat) {
  switch (outputFormat) {
    case "udf":
    case "jpg":
    case "png":
    case "webp":
    case "mp3":
    case "wav":
    case "gif":
    case "mp4":
      return CONVERT_FILE_KINDS;
    default:
      return [];
  }
}

export function allowedKindsForOutputStrict(outputFormat) {
  switch (outputFormat) {
    case "udf":
      return ["pdf"];
    case "jpg":
    case "png":
      return ["pdf", "jpg", "png", "webp"];
    case "webp":
      return ["jpg", "png", "webp"];
    case "mp3":
      return ["mp4", "mov", "avi", "mkv", "webm", "wav"];
    case "wav":
      return ["mp3"];
    case "gif":
      return ["mp4", "mov"];
    case "mp4":
      return ["gif", "avi", "mov", "mkv", "webm", "mp4"];
    default:
      return [];
  }
}

async function readHeader(filePath) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectFromHeader(buffer) {
  if (buffer.length < 4) return null;
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", mime: "application/pdf" };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { kind: "jpg", mime: "image/jpeg" };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: "png", mime: "image/png" };
  }
  const prefix6 = buffer.subarray(0, 6).toString("latin1");
  if (prefix6 === "GIF87a" || prefix6 === "GIF89a") return { kind: "gif", mime: "image/gif" };
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF") {
    const riffKind = buffer.subarray(8, 12).toString("latin1");
    if (riffKind === "WEBP") return { kind: "webp", mime: "image/webp" };
    if (riffKind === "WAVE") return { kind: "wav", mime: "audio/wav" };
    if (riffKind === "AVI ") return { kind: "avi", mime: "video/x-msvideo" };
  }
  if (buffer.subarray(0, 3).toString("latin1") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return { kind: "mp3", mime: "audio/mpeg" };
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { kind: "webm", mime: "video/webm" };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("latin1");
    if (brand === "qt  ") return { kind: "mov", mime: "video/quicktime" };
    return { kind: "mp4", mime: "video/mp4" };
  }
  return null;
}

function mapFileType(detected) {
  const ext = detected.ext === "jpeg" ? "jpg" : detected.ext;
  if (ext === "m4v" || ext === "m4a") return { kind: "mp4", mime: detected.mime };
  if (SUPPORTED_KINDS.has(ext)) return { kind: ext, mime: detected.mime };
  if (detected.mime === "video/quicktime") return { kind: "mov", mime: detected.mime };
  return null;
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    throw new HttpError(499, "Request was cancelled.", { code: "REQUEST_CANCELLED", expose: false });
  }
}
