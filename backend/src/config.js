import dotenv from "dotenv";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const bundledFfmpegPath = require("ffmpeg-static");
const bundledFfprobePath = require("ffprobe-static").path;
const isProduction = process.env.NODE_ENV === "production";
const port = readNumber("PORT", 4000, { min: 1, max: 65535 });

function readNumber(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new Error(`${name} must be a number${min !== undefined ? ` >= ${min}` : ""}${max !== undefined ? ` and <= ${max}` : ""}.`);
  }
  return value;
}

function readCsv(name, fallback = "") {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(value) {
  if (!value) {
    if (isProduction) {
      throw new Error("PUBLIC_BASE_URL is required when NODE_ENV=production.");
    }
    return `http://localhost:${port}`;
  }

  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("PUBLIC_BASE_URL must start with http:// or https://.");
  }
  if (isProduction) {
    if (parsed.protocol !== "https:") {
      throw new Error("PUBLIC_BASE_URL must start with https:// when NODE_ENV=production.");
    }
    if (isLocalOrPrivateHost(parsed.hostname)) {
      throw new Error("PUBLIC_BASE_URL must not use localhost, loopback, or private LAN hosts in production.");
    }
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isLocalOrPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

export const config = {
  isProduction,
  port,
  publicBaseUrl: normalizeBaseUrl(process.env.PUBLIC_BASE_URL?.trim()),
  downloadDir: path.resolve(rootDir, process.env.DOWNLOAD_DIR ?? "downloads"),
  maxInputBytes: readNumber("MAX_INPUT_MB", 100, { min: 1, max: 500 }) * 1024 * 1024,
  maxFilesPerRequest: readNumber("MAX_FILES_PER_REQUEST", 10, { min: 1, max: 50 }),
  maxConcurrentJobs: readNumber("MAX_CONCURRENT_JOBS", 2, { min: 1, max: 8 }),
  maxPendingJobs: readNumber("MAX_PENDING_JOBS", 10, { min: 0, max: 50 }),
  jobTtlMs: readNumber("JOB_TTL_MINUTES", 30, { min: 5, max: 24 * 60 }) * 60 * 1000,
  trustProxyHops: readNumber("TRUST_PROXY_HOPS", 0, { min: 0, max: 3 }),
  allowedOrigins: readCsv(
    "ALLOWED_ORIGINS",
    isProduction ? "" : "http://localhost:8081,http://localhost:8082,http://localhost:8090"
  ),
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || bundledFfmpegPath || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH?.trim() || bundledFfprobePath || "ffprobe"
};
