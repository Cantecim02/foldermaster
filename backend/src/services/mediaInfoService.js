import axios from "axios";
import { spawn } from "node:child_process";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";
import { validatePublicMediaUrl } from "../utils/safeUrl.js";

export async function getMediaInfo(rawUrl) {
  const url = await validatePublicMediaUrl(rawUrl);
  const head = await axios.head(url, {
    maxRedirects: 5,
    timeout: 12000,
    validateStatus: (status) => status >= 200 && status < 400
  });

  const contentType = String(head.headers["content-type"] ?? "");
  const contentLength = Number(head.headers["content-length"] ?? 0);

  if (!contentType.startsWith("video/") && !contentType.startsWith("audio/") && !looksLikeMediaUrl(url)) {
    throw new HttpError(415, "URL must point directly to a video or audio file.");
  }

  if (contentLength > config.maxInputBytes) {
    throw new HttpError(413, "Media file is larger than the configured limit.");
  }

  const probe = await probeRemoteMedia(url).catch(() => null);
  const isVideo = contentType.startsWith("video/") || probe?.streams?.some((stream) => stream.codec_type === "video");
  const duration = Number(probe?.format?.duration ?? 0);

  return {
    url,
    title: titleFromUrl(url),
    thumbnail: null,
    duration: Number.isFinite(duration) ? duration : null,
    contentType,
    filesize: contentLength || null,
    mp4Qualities: isVideo ? buildQualities(probe) : [],
    audioFormats: ["mp3"],
    source: "direct-media"
  };
}

function probeRemoteMedia(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      url
    ];
    const child = spawn(config.ffprobePath, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "ffprobe failed"));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

function buildQualities(probe) {
  const video = probe?.streams?.find((stream) => stream.codec_type === "video");
  const height = Number(video?.height ?? 0);
  const all = [360, 480, 720].filter((quality) => !height || quality <= Math.max(height, 360));
  return all.map((quality) => ({
    label: `${quality}p`,
    height: quality,
    filesize: null
  }));
}

function looksLikeMediaUrl(url) {
  return /\.(mp4|mov|mkv|webm|avi|mp3|wav|m4a|ogg|flac)(\?|#|$)/i.test(url);
}

function titleFromUrl(url) {
  const pathname = new URL(url).pathname;
  const name = pathname.split("/").filter(Boolean).pop() ?? "media";
  return decodeURIComponent(name).replace(/\.[^.]+$/, "");
}
