export type FileType =
  | "pdf"
  | "udf"
  | "docx"
  | "doc"
  | "txt"
  | "rtf"
  | "odt"
  | "xlsx"
  | "xls"
  | "csv"
  | "ods"
  | "jpg"
  | "png"
  | "gif"
  | "bmp"
  | "webp"
  | "mp4"
  | "avi"
  | "mov"
  | "mkv"
  | "webm"
  | "mp3"
  | "wav"
  | "ogg"
  | "flac"
  | "m4a"
  | "zip"
  | "rar"
  | "7z"
  | "tar";

export type AppFile = {
  name: string;
  uri: string;
  mimeType?: string | null;
  size: number;
};

export type ConvertedFile = {
  name: string;
  uri: string;
  mimeType: string;
  uti?: string;
};

export type ConversionJob = {
  id: string;
  files: AppFile[];
  inputType: FileType;
  outputType: FileType;
  createdAt: string;
  status: "success" | "failed";
  outputs?: ConvertedFile[];
  error?: string;
};
