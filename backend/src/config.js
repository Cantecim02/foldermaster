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
const downloadDir = path.resolve(rootDir, process.env.DOWNLOAD_DIR ?? "downloads");

function readNumber(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new Error(`${name} must be a number${min !== undefined ? ` >= ${min}` : ""}${max !== undefined ? ` and <= ${max}` : ""}.`);
  }
  return value;
}

function readOptionalInteger(name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

function readCsv(name, fallback = "") {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be true or false.`);
}

function readString(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function readAppleEnvironments() {
  const fallback = isProduction ? "Production" : "Xcode,Sandbox";
  const allowed = new Set(["Production", "Sandbox", "Xcode", "LocalTesting"]);
  const environments = (process.env.APPLE_IAP_ENVIRONMENT?.trim() || fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (environments.length === 0 || environments.some((value) => !allowed.has(value))) {
    throw new Error("APPLE_IAP_ENVIRONMENT must contain Production, Sandbox, Xcode, or LocalTesting.");
  }
  return environments;
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
  downloadDir,
  databasePath: path.resolve(rootDir, process.env.DATABASE_PATH ?? "data/editio.sqlite"),
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
  authSessionDays: readNumber("AUTH_SESSION_DAYS", 30, { min: 1, max: 365 }),
  minAccountAge: readNumber("MIN_ACCOUNT_AGE", 13, { min: 13, max: 18 }),
  termsVersion: process.env.TERMS_VERSION?.trim() || "2026-07-15",
  privacyVersion: process.env.PRIVACY_VERSION?.trim() || "2026-07-16",
  supportRecipientEmail: process.env.SUPPORT_TO_EMAIL?.trim() || "editioapp@gmail.com",
  supportMaxAttachmentBytes: readNumber("SUPPORT_MAX_ATTACHMENT_MB", 10, { min: 1, max: 25 }) * 1024 * 1024,
  smtpHost: process.env.SMTP_HOST?.trim() || "",
  smtpPort: readNumber("SMTP_PORT", 587, { min: 1, max: 65535 }),
  smtpSecure: readBoolean("SMTP_SECURE", false),
  smtpUser: process.env.SMTP_USER?.trim() || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM?.trim() || "",
  smtpJsonTransport: !isProduction && readBoolean("SMTP_JSON_TRANSPORT", false),
  monetizationEnabled: readBoolean("MONETIZATION_ENABLED", false),
  monetizationMinIosBuild: readOptionalInteger("MONETIZATION_MIN_IOS_BUILD"),
  freeConversionLimit: readNumber("FREE_CONVERSION_LIMIT", 3, { min: 0, max: 100 }),
  conversionAuthorizationTtlMs:
    readNumber("CONVERSION_AUTHORIZATION_TTL_MINUTES", 15, { min: 1, max: 120 }) * 60 * 1000,
  appleBundleId: readString("APPLE_BUNDLE_ID", "com.cantecim.editio"),
  appleAppId: readNumber("APPLE_APP_ID", 6790405876, { min: 1 }),
  appleProductIds: Object.freeze([
    readString("APPLE_MONTHLY_PRODUCT_ID", "com.cantecim.editio.pro.monthly"),
    readString("APPLE_YEARLY_PRODUCT_ID", "com.cantecim.editio.pro.yearly")
  ]),
  appleIapIssuerId: readString("APPLE_IAP_ISSUER_ID"),
  appleIapKeyId: readString("APPLE_IAP_KEY_ID"),
  appleIapPrivateKeyPath: readString("APPLE_IAP_PRIVATE_KEY_PATH"),
  appleIapEnvironments: readAppleEnvironments(),
  appleRootCaDirectory: readString("APPLE_ROOT_CA_DIRECTORY"),
  appleNotificationProductionUrl: readString("APPLE_NOTIFICATION_PRODUCTION_URL"),
  appleNotificationSandboxUrl: readString("APPLE_NOTIFICATION_SANDBOX_URL"),
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || bundledFfmpegPath || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH?.trim() || bundledFfprobePath || "ffprobe"
};

if (config.monetizationEnabled && config.isProduction) {
  const missing = [
    ["APPLE_IAP_ISSUER_ID", config.appleIapIssuerId],
    ["APPLE_IAP_KEY_ID", config.appleIapKeyId],
    ["APPLE_IAP_PRIVATE_KEY_PATH", config.appleIapPrivateKeyPath],
    ["APPLE_ROOT_CA_DIRECTORY", config.appleRootCaDirectory]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Monetization is enabled but required Apple configuration is missing: ${missing.join(", ")}.`);
  }
}
