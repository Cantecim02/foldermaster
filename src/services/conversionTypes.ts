import { FileType } from "../types";

export type ConversionDefinition = {
  input: FileType;
  output: FileType;
  label: string;
  requiresPdfAd: boolean;
  nativeRequired?: boolean;
};

export const fileTypes: FileType[] = [
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
];

const implemented = new Set([
  "pdf:jpg",
  "pdf:png",
  "pdf:udf",
  "udf:pdf",
  "udf:doc",
  "udf:docx",
  "udf:rtf",
  "udf:odt",
  "udf:txt",
  "jpg:pdf",
  "jpg:png",
  "jpg:webp",
  "png:pdf",
  "txt:pdf",
  "docx:pdf",
  "xlsx:csv",
  "csv:xlsx",
  "png:jpg",
  "png:webp",
  "webp:jpg",
  "webp:png",
  "mp3:wav",
  "wav:mp3",
  "mp4:mp3",
  "avi:mp3",
  "mov:mp3",
  "mkv:mp3",
  "webm:mp3",
  "mp4:gif",
  "mov:gif",
  "gif:mp4"
]);

const matrix: Record<FileType, FileType[]> = {
  pdf: ["docx", "txt", "jpg", "png", "udf"],
  udf: ["pdf", "doc", "docx", "rtf", "odt", "txt"],
  docx: ["pdf", "txt", "rtf"],
  doc: ["pdf", "docx", "txt"],
  txt: ["pdf", "docx"],
  rtf: ["pdf", "docx", "txt"],
  odt: ["pdf", "docx"],
  xlsx: ["csv", "pdf", "xls"],
  xls: ["csv", "pdf", "xlsx"],
  csv: ["xlsx", "xls", "pdf"],
  ods: ["xlsx", "pdf"],
  jpg: ["png", "gif", "bmp", "pdf", "webp"],
  png: ["jpg", "gif", "bmp", "pdf", "webp"],
  gif: ["jpg", "png", "mp4", "webm"],
  bmp: ["jpg", "png", "pdf"],
  webp: ["jpg", "png", "gif"],
  mp4: ["avi", "mov", "mkv", "gif", "mp3"],
  avi: ["mp4", "mov", "mkv", "mp3"],
  mov: ["mp4", "avi", "mkv", "gif", "mp3"],
  mkv: ["mp4", "avi", "mp3"],
  webm: ["mp4", "mp3"],
  mp3: ["wav", "ogg", "flac"],
  wav: ["mp3", "ogg", "flac"],
  ogg: ["mp3", "wav"],
  flac: ["mp3", "wav"],
  m4a: ["mp3", "wav"],
  zip: ["tar", "rar", "7z"],
  rar: ["zip", "tar"],
  "7z": ["zip", "rar"],
  tar: ["zip", "rar"]
};

export const supportedConversions: ConversionDefinition[] = Object.entries(matrix).flatMap(
  ([input, outputs]) =>
    outputs.map((output) => {
      const key = `${input}:${output}`;
      return {
        input: input as FileType,
        output,
        label: `${input.toUpperCase()} -> ${output.toUpperCase()}`,
        requiresPdfAd: input === "pdf",
        nativeRequired: !implemented.has(key)
      };
    })
);

export const mimeByType: Record<FileType, string> = {
  pdf: "application/pdf",
  udf: "application/vnd.uyap.udf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  mp4: "video/mp4",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar"
};

export function extensionFor(type: FileType) {
  return type;
}

export function getAvailableOutputs(inputType: FileType) {
  return supportedConversions
    .filter((conversion) => conversion.input === inputType && !conversion.nativeRequired)
    .map((conversion) => conversion.output);
}
