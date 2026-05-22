import axios from "axios";

const API_BASE_URL = process.env.EXPO_PUBLIC_MEDIA_API_URL ?? "http://localhost:4000";
const uploadTimeoutMs = 10 * 60 * 1000;

export type MediaInfo = {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  contentType: string;
  filesize: number | null;
  mp4Qualities: Array<{ label: string; height: number; filesize: number | null }>;
  audioFormats: string[];
};

export type MediaJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  stage: string;
  fileUrl?: string;
  error?: string;
};

export async function fetchMediaInfo(url: string) {
  const response = await axios.get<MediaInfo>(`${API_BASE_URL}/media-info`, {
    params: { url }
  });
  return response.data;
}

export async function startMediaDownload(params: {
  url: string;
  format: "mp4" | "mp3";
  quality: "360p" | "480p" | "720p";
}) {
  const response = await axios.post<{ jobId: string }>(`${API_BASE_URL}/download`, params);
  return response.data;
}

export async function getMediaJob(jobId: string) {
  const response = await axios.get<MediaJob>(`${API_BASE_URL}/download/${jobId}`);
  return response.data;
}

type NativeUploadFile = { uri: string; name: string; type: string };

export async function convertUploadedMediaFile(params: {
  file: Blob | NativeUploadFile;
  filename: string;
  outputFormat: "mp3" | "mp4" | "gif" | "jpg" | "png" | "webp" | "wav" | "udf";
  trimStartSeconds?: number;
  trimDurationSeconds?: number;
}) {
  const form = new FormData();
  if (isNativeUploadFile(params.file)) {
    form.append("file", params.file as unknown as Blob);
  } else {
    form.append("file", params.file, params.filename);
  }
  form.append("outputFormat", params.outputFormat);
  if (typeof params.trimStartSeconds === "number") {
    form.append("trimStartSeconds", String(params.trimStartSeconds));
  }
  if (typeof params.trimDurationSeconds === "number") {
    form.append("trimDurationSeconds", String(params.trimDurationSeconds));
  }

  const response = await postMultipartWithRetry<
    { fileUrl: string; filename: string } | { files: Array<{ fileUrl: string; filename: string }> }
  >(
    `${API_BASE_URL}/convert-file`,
    form
  );
  return normalizeDownloadUrls(response.data);
}

export async function convertUploadedImagesToPdf(params: {
  files: Array<Blob | NativeUploadFile>;
  filename: string;
}) {
  const form = new FormData();
  for (const file of params.files) {
    if (isNativeUploadFile(file)) {
      form.append("files", file as unknown as Blob);
    } else {
      form.append("files", file, params.filename);
    }
  }

  const response = await postMultipartWithRetry<{ fileUrl: string; filename: string }>(
    `${API_BASE_URL}/convert-images-to-pdf`,
    form
  );
  return normalizeDownloadUrls(response.data);
}

async function postMultipartWithRetry<T>(url: string, form: FormData) {
  try {
    return await axios.post<T>(url, form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: uploadTimeoutMs
    });
  } catch (caught) {
    if (!isTransientUploadError(caught)) throw caught;
    return axios.post<T>(url, form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: uploadTimeoutMs
    });
  }
}

function isTransientUploadError(caught: unknown) {
  if (!axios.isAxiosError(caught)) return false;
  if (caught.code === "ECONNABORTED" || caught.code === "ERR_NETWORK") return true;
  const status = caught.response?.status;
  return status === 408 || status === 502 || status === 503 || status === 504;
}

function isNativeUploadFile(file: Blob | NativeUploadFile): file is NativeUploadFile {
  return typeof (file as NativeUploadFile).uri === "string";
}

function normalizeDownloadUrls<T extends { fileUrl?: string; files?: Array<{ fileUrl: string }> }>(data: T): T {
  if (data.fileUrl) {
    return { ...data, fileUrl: normalizeDownloadUrl(data.fileUrl) };
  }

  if (data.files) {
    return {
      ...data,
      files: data.files.map((file) => ({
        ...file,
        fileUrl: normalizeDownloadUrl(file.fileUrl)
      }))
    };
  }

  return data;
}

function normalizeDownloadUrl(url: string) {
  try {
    const apiUrl = new URL(API_BASE_URL);
    const fileUrl = new URL(url);
    if (fileUrl.hostname === "localhost" || fileUrl.hostname === "127.0.0.1") {
      fileUrl.protocol = apiUrl.protocol;
      fileUrl.hostname = apiUrl.hostname;
      fileUrl.port = apiUrl.port;
    }
    return fileUrl.toString();
  } catch {
    return url;
  }
}
