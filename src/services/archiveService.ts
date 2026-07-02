import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import JSZip from "jszip";
import { AppFile, ConvertedFile } from "../types";
import { routeFileForOperation } from "./fileRouter";

export type ExtractedArchiveFile = ConvertedFile & {
  size: number;
};

type ArchiveProgress = (progress: number) => void;

const archiveDir = `${FileSystem.documentDirectory ?? ""}archives/`;
const maxMobileZipInputBytes = 80 * 1024 * 1024;

export class UnsupportedArchiveError extends Error {
  code = "ERR_ARCHIVE_UNSUPPORTED" as const;

  constructor(message = "ERR_ARCHIVE_UNSUPPORTED") {
    super(message);
    this.name = "UnsupportedArchiveError";
  }
}

export class UnsupportedArchiveFormatError extends Error {
  code = "ERR_ARCHIVE_FORMAT_UNSUPPORTED" as const;

  constructor(message = "ERR_ARCHIVE_FORMAT_UNSUPPORTED") {
    super(message);
    this.name = "UnsupportedArchiveFormatError";
  }
}

export class NativeArchiveRequiredError extends Error {
  code = "ERR_ARCHIVE_NATIVE_REQUIRED" as const;

  constructor(message = "ERR_ARCHIVE_NATIVE_REQUIRED") {
    super(message);
    this.name = "NativeArchiveRequiredError";
  }
}

export async function extractArchive(file: AppFile, onProgress: ArchiveProgress) {
  const route = routeFileForOperation(file, "archive.extract");
  if (!route.canStart) {
    if (route.reason === "native-required") {
      throw new NativeArchiveRequiredError();
    }
    if (route.reason === "unsupported-archive-format") {
      throw new UnsupportedArchiveFormatError();
    }
    throw new UnsupportedArchiveError();
  }

  const extension = route.detection.fileType ?? route.detection.normalizedExtension;

  if (extension === "zip") {
    return extractZip(file, onProgress);
  }

  if (extension === "tar") {
    return extractTar(file, onProgress);
  }

  throw new UnsupportedArchiveError();
}

export async function createZipArchive(files: AppFile[], onProgress: ArchiveProgress) {
  if (!files.length) throw new Error("ERR_ARCHIVE_NO_FILES");
  assertMobileZipPayload(files);

  const zip = new JSZip();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (Platform.OS === "web") {
      const bytes = await readBytes(file.uri);
      zip.file(safeArchiveName(file.name), bytes, { compression: "STORE" });
    } else {
      const base64 = await readBase64(file.uri);
      assertMobileBase64Size(base64);
      zip.file(safeArchiveName(file.name), base64, { base64: true, compression: "STORE" });
    }
    onProgress((index + 1) / (files.length + 1));
    await yieldToUi();
  }

  if (Platform.OS === "web") {
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }, (metadata) => {
      onProgress(0.75 + metadata.percent / 400);
    });
    return makeWebOutput("compressed_files.zip", blob, "application/zip");
  }

  await ensureArchiveDir();
  await yieldToUi();
  const base64 = await zip.generateAsync({ type: "base64", compression: "STORE", streamFiles: true }, (metadata) => {
    onProgress(0.75 + metadata.percent / 400);
  });
  const uri = `${archiveDir}compressed_${Date.now()}.zip`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64
  });
  onProgress(1);
  return {
    name: uri.split("/").pop() ?? "compressed_files.zip",
    uri,
    mimeType: "application/zip"
  };
}

function assertMobileZipPayload(files: AppFile[]) {
  if (Platform.OS === "web") return;
  const knownTotalBytes = files.reduce((total, file) => total + (file.size ?? 0), 0);
  const largestKnownFile = Math.max(0, ...files.map((file) => file.size ?? 0));
  if (knownTotalBytes > maxMobileZipInputBytes || largestKnownFile > maxMobileZipInputBytes) {
    throw new Error("ERR_ARCHIVE_TOO_LARGE");
  }
}

function assertMobileBase64Size(base64: string) {
  const estimatedBytes = Math.floor((base64.length * 3) / 4);
  if (estimatedBytes > maxMobileZipInputBytes) {
    throw new Error("ERR_ARCHIVE_TOO_LARGE");
  }
}

async function extractZip(file: AppFile, onProgress: ArchiveProgress): Promise<ExtractedArchiveFile[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readBytes(file.uri));
  } catch (caught) {
    throw mapZipError(caught);
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (!entries.length) throw new Error("ERR_ARCHIVE_EMPTY");

  const outputs: ExtractedArchiveFile[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    let bytes: Uint8Array;
    try {
      bytes = await entry.async("uint8array");
    } catch (caught) {
      throw mapZipError(caught);
    }
    outputs.push(await writeExtractedFile(entry.name, bytes, guessMime(entry.name)));
    onProgress((index + 1) / entries.length);
  }

  return outputs;
}

async function extractTar(file: AppFile, onProgress: ArchiveProgress): Promise<ExtractedArchiveFile[]> {
  const bytes = await readBytes(file.uri);
  const outputs: ExtractedArchiveFile[] = [];
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = decodeTarString(header.slice(0, 100));
    const sizeText = decodeTarString(header.slice(124, 136)).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    offset += 512;

    if (name && size > 0) {
      outputs.push(await writeExtractedFile(name, bytes.slice(offset, offset + size), guessMime(name)));
    }

    offset += Math.ceil(size / 512) * 512;
    onProgress(Math.min(1, offset / bytes.length));
  }

  if (!outputs.length) throw new Error("ERR_ARCHIVE_EMPTY");
  return outputs;
}

async function readBytes(uri: string) {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    if (!response.ok) throw new Error("ERR_FILE_READ_FAILED");
    return new Uint8Array(await response.arrayBuffer());
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
  return base64ToUint8Array(base64);
}

async function readBase64(uri: string) {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function writeExtractedFile(name: string, bytes: Uint8Array, mimeType: string): Promise<ExtractedArchiveFile> {
  if (Platform.OS === "web") {
    const output = makeWebOutput(name, new Blob([toArrayBuffer(bytes)], { type: mimeType }), mimeType);
    return { ...output, size: bytes.byteLength };
  }

  await ensureArchiveDir();
  const safeName = `${Date.now()}_${safeArchiveName(name)}`;
  const uri = `${archiveDir}${safeName}`;
  await FileSystem.writeAsStringAsync(uri, uint8ArrayToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64
  });
  return {
    name: safeName,
    uri,
    mimeType,
    size: bytes.byteLength
  };
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function makeWebOutput(name: string, blob: Blob, mimeType: string): ConvertedFile {
  return {
    name: safeArchiveName(name),
    uri: URL.createObjectURL(blob),
    mimeType
  };
}

async function ensureArchiveDir() {
  const info = await FileSystem.getInfoAsync(archiveDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(archiveDir, { intermediates: true });
  }
}

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function safeArchiveName(name: string) {
  return name.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || `file_${Date.now()}`;
}

function decodeTarString(bytes: Uint8Array) {
  const end = bytes.findIndex((byte) => byte === 0);
  const slice = end >= 0 ? bytes.slice(0, end) : bytes;
  return String.fromCharCode(...slice).trim();
}

function guessMime(name: string) {
  const extension = getExtension(name);
  if (extension === "pdf") return "application/pdf";
  if (extension === "udf") return "application/vnd.uyap.udf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "txt") return "text/plain";
  if (extension === "csv") return "text/csv";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "mp4") return "video/mp4";
  return "application/octet-stream";
}

function mapZipError(caught: unknown) {
  const message = caught instanceof Error ? caught.message.toLowerCase() : "";
  if (message.includes("encrypted") || message.includes("password")) {
    return new Error("ERR_ARCHIVE_PASSWORD_REQUIRED");
  }
  if (
    message.includes("corrupted") ||
    message.includes("end of central directory") ||
    message.includes("can't find") ||
    message.includes("invalid")
  ) {
    return new Error("ERR_ARCHIVE_INVALID_ZIP");
  }
  if (message.includes("zip64")) {
    return new Error("ERR_ARCHIVE_ZIP64");
  }
  return new Error("ERR_ARCHIVE_FAILED");
}

function base64ToUint8Array(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const cleaned = base64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of cleaned) {
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}
