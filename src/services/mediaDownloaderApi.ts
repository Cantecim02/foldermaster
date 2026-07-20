import axios from "axios";
import { NativeModules, Platform } from "react-native";
import { getEditioClientHeaders } from "./clientMetadata";

declare const __DEV__: boolean | undefined;

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_MEDIA_API_URL;
const configuredApiPort = process.env.EXPO_PUBLIC_MEDIA_API_PORT;
const uploadTimeoutMs = 10 * 60 * 1000;

type NativeUploadFile = { uri: string; name: string; type: string };
export type BillingUploadContext = {
  installationId: string;
  authorizationId: string | null;
  sessionToken: string | null;
};
export type PdfCompressionResponse = {
  fileUrl: string;
  filename: string;
  originalBytes: number;
  compressedBytes: number;
  savedBytes: number;
  savedPercent: number;
  method: string;
};
export type PdfCompressionPreset = "quality" | "balanced" | "small";

export async function convertUploadedMediaFile(params: {
  file: Blob | NativeUploadFile;
  filename: string;
  outputFormat: "mp3" | "mp4" | "gif" | "jpg" | "png" | "webp" | "wav" | "udf";
  trimStartSeconds?: number;
  trimDurationSeconds?: number;
  billingContext?: BillingUploadContext;
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
    `${getApiBaseUrl()}/convert-file`,
    form,
    params.billingContext
  );
  return normalizeDownloadUrls(response.data);
}

export async function convertUploadedImagesToPdf(params: {
  files: Array<Blob | NativeUploadFile>;
  filename: string;
  billingContext?: BillingUploadContext;
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
    `${getApiBaseUrl()}/convert-images-to-pdf`,
    form,
    params.billingContext
  );
  return normalizeDownloadUrls(response.data);
}

export async function compressUploadedPdf(params: {
  file: Blob | NativeUploadFile;
  filename: string;
  compressionPreset?: PdfCompressionPreset;
  billingContext?: BillingUploadContext;
}) {
  const form = new FormData();
  if (isNativeUploadFile(params.file)) {
    form.append("file", params.file as unknown as Blob);
  } else {
    form.append("file", params.file, params.filename);
  }
  form.append("compressionPreset", params.compressionPreset ?? "balanced");

  const response = await postMultipartWithRetry<PdfCompressionResponse>(
    `${getApiBaseUrl()}/compress-pdf`,
    form,
    params.billingContext
  );
  return normalizeDownloadUrls(response.data);
}

async function postMultipartWithRetry<T>(url: string, form: FormData, billingContext?: BillingUploadContext) {
  const headers = {
    "Content-Type": "multipart/form-data",
    ...getEditioClientHeaders(),
    ...(billingContext?.installationId
      ? { "x-editio-installation-id": billingContext.installationId }
      : {}),
    ...(billingContext?.authorizationId
      ? { "x-editio-conversion-authorization": billingContext.authorizationId }
      : {}),
    ...(billingContext?.sessionToken
      ? { Authorization: `Bearer ${billingContext.sessionToken}` }
      : {})
  };
  try {
    return await axios.post<T>(url, form, {
      headers,
      timeout: uploadTimeoutMs
    });
  } catch (caught) {
    if (!isTransientUploadError(caught)) throw normalizeApiError(caught);
    try {
      return await axios.post<T>(url, form, {
        headers,
        timeout: uploadTimeoutMs
      });
    } catch (retryError) {
      throw normalizeApiError(retryError);
    }
  }
}

function isTransientUploadError(caught: unknown) {
  if (!axios.isAxiosError(caught)) return false;
  if (caught.code === "ECONNABORTED" || caught.code === "ERR_NETWORK") return true;
  const status = caught.response?.status;
  return status === 408 || status === 502 || status === 503 || status === 504;
}

function normalizeApiError(caught: unknown) {
  if (isBackendUnavailable(caught)) {
    throw new Error("ERR_BACKEND_UNAVAILABLE");
  }
  return caught;
}

function isBackendUnavailable(caught: unknown) {
  if (!axios.isAxiosError(caught)) return false;
  if (!caught.response && (caught.code === "ERR_NETWORK" || caught.message.includes("Network Error"))) return true;
  return caught.response?.status === 404;
}

function isNativeUploadFile(file: Blob | NativeUploadFile): file is NativeUploadFile {
  return typeof (file as NativeUploadFile).uri === "string";
}

export function getApiBaseUrl() {
  const apiBaseUrl = resolveApiBaseUrl();
  if (!apiBaseUrl) {
    throw new Error("ERR_BACKEND_URL_MISSING");
  }

  return apiBaseUrl.replace(/\/$/, "");
}

function resolveApiBaseUrl() {
  const configured = configuredApiBaseUrl?.trim();
  if (configured && !shouldRewriteLocalDevHost(configured)) {
    return configured;
  }

  const nativeDevHost = getNativeDevServerHost();
  const nativeDevPort = getConfiguredApiPort(configured);
  if (nativeDevHost && nativeDevPort) {
    return `http://${nativeDevHost}:${nativeDevPort}`;
  }

  if (configured) return configured;
  return "";
}

function shouldRewriteLocalDevHost(url: string) {
  if (Platform.OS === "web" || typeof __DEV__ === "undefined" || !__DEV__) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function getConfiguredApiPort(configured?: string) {
  const explicitPort = configuredApiPort?.trim();
  if (explicitPort) return explicitPort;
  if (!configured) return "";
  try {
    const parsed = new URL(configured);
    return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return "";
  }
}

function getNativeDevServerHost() {
  if (Platform.OS === "web" || typeof __DEV__ === "undefined" || !__DEV__) return null;
  const scriptURL = NativeModules.SourceCode?.scriptURL;
  if (typeof scriptURL !== "string") return null;

  try {
    const parsed = new URL(scriptURL);
    const host = parsed.hostname;
    if (!host || host === "localhost" || host === "127.0.0.1") return null;
    return host;
  } catch {
    return null;
  }
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
    const apiUrl = new URL(getApiBaseUrl());
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
