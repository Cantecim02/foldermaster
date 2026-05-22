import axios from "axios";
import fs from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { createJob, updateJob } from "./jobStore.js";
import { validatePublicMediaUrl } from "../utils/safeUrl.js";

export async function enqueueDownload({ url: rawUrl, format, quality }) {
  const url = await validatePublicMediaUrl(rawUrl);
  const id = nanoid();
  const workDir = path.join(config.downloadDir, "jobs", id);
  const inputPath = path.join(workDir, "source");
  const outputName = `media_${id}.${format}`;
  const outputPath = path.join(config.downloadDir, outputName);

  await mkdir(workDir, { recursive: true });
  await mkdir(config.downloadDir, { recursive: true });

  createJob({
    id,
    url,
    format,
    quality,
    workDir,
    inputPath,
    outputPath,
    outputName
  });

  runJob(id).catch((error) => {
    updateJob(id, {
      status: "failed",
      stage: "failed",
      error: error instanceof Error ? error.message : "Download failed"
    });
  });

  return { jobId: id };
}

async function runJob(id) {
  const job = updateJob(id, { status: "running", stage: "downloading", progress: 2 });
  await downloadToFile(job.url, job.inputPath, (percent) => {
    updateJob(id, {
      progress: Math.min(50, Math.round(percent * 0.5)),
      stage: "downloading"
    });
  });

  updateJob(id, { stage: "converting", progress: 55 });
  await convertWithFfmpeg(job.inputPath, job.outputPath, job.format, job.quality, (percent) => {
    updateJob(id, {
      progress: 55 + Math.round(percent * 0.4),
      stage: "converting"
    });
  });

  await rm(job.workDir, { recursive: true, force: true });
  updateJob(id, {
    status: "completed",
    stage: "completed",
    progress: 100,
    fileUrl: `${config.publicBaseUrl}/files/${job.outputName}`
  });
}

async function downloadToFile(url, targetPath, onProgress) {
  const response = await axios.get(url, {
    responseType: "stream",
    maxRedirects: 5,
    timeout: 20000
  });

  const total = Number(response.headers["content-length"] ?? 0);
  if (total > config.maxInputBytes) {
    throw new Error("Media file is larger than the configured limit.");
  }

  await new Promise((resolve, reject) => {
    let received = 0;
    const writer = fs.createWriteStream(targetPath);
    response.data.on("data", (chunk) => {
      received += chunk.length;
      if (total) onProgress(Math.round((received / total) * 100));
    });
    response.data.on("error", reject);
    writer.on("error", reject);
    writer.on("finish", resolve);
    response.data.pipe(writer);
  });

  if (!total) onProgress(100);
}

function convertWithFfmpeg(inputPath, outputPath, format, quality, onProgress) {
  return new Promise((resolve, reject) => {
    const args = buildFfmpegArgs(inputPath, outputPath, format, quality);
    const child = spawn(config.ffmpegPath, args, { shell: false, windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const time = parseFfmpegTime(stderr);
      if (time) onProgress(Math.min(95, time));
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "FFmpeg conversion failed."));
        return;
      }
      onProgress(100);
      resolve();
    });
  });
}

function buildFfmpegArgs(inputPath, outputPath, format, quality) {
  if (format === "mp3") {
    return ["-y", "-i", inputPath, "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", outputPath];
  }

  const height = Number.parseInt(String(quality).replace(/\D/g, ""), 10) || 720;
  return [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale=-2:min(${height}\\,ih)`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath
  ];
}

function parseFfmpegTime(stderr) {
  const matches = [...stderr.matchAll(/time=(\d{2}):(\d{2}):(\d{2})\.\d+/g)];
  if (!matches.length) return 0;
  const latest = matches[matches.length - 1];
  const seconds = Number(latest[1]) * 3600 + Number(latest[2]) * 60 + Number(latest[3]);
  return Math.min(95, seconds);
}
