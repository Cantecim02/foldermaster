import dotenv from "dotenv";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const bundledFfmpegPath = require("ffmpeg-static");
const bundledFfprobePath = require("ffprobe-static").path;

export const config = {
  port: Number(process.env.PORT ?? 4000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:4000",
  downloadDir: path.resolve(rootDir, process.env.DOWNLOAD_DIR ?? "downloads"),
  maxInputBytes: Number(process.env.MAX_INPUT_MB ?? 500) * 1024 * 1024,
  jobTtlMs: Number(process.env.JOB_TTL_MINUTES ?? 60) * 60 * 1000,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:8081,http://localhost:8082,http://localhost:8090")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  ffmpegPath: process.env.FFMPEG_PATH ?? bundledFfmpegPath ?? "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH ?? bundledFfprobePath ?? "ffprobe"
};
