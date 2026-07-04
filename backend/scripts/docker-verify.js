import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const baseUrl = process.env.DOCKER_VERIFY_BASE_URL ?? "http://127.0.0.1:4000";
const containerName = process.env.DOCKER_CONTAINER ?? "editio-backend-test";
const tempDir = await mkdtemp(path.join(os.tmpdir(), "editio-docker-verify-"));
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDGgAcICABMmAwnrQp3YAAAAAElFTkSuQmCC",
  "base64"
);

try {
  const fixtures = await createFixtures();
  await waitForHealth();
  await verifyNativeDependenciesInContainer();
  await verifyHealth();
  await verifyPdfUpload(fixtures.pdfPath);
  await verifyFakePdfRejected();
  await verifyPdfToImage(fixtures.pdfPath);
  await verifyImageConversionAndDownload(fixtures.pngPath);
  await verifyImageToPdf(fixtures.pngPath);
  await verifyPdfCompression(fixtures.pdfPath);
  await verifyAudioConversion(fixtures.wavPath);
  await verifyVideoConversion(fixtures.mp4Path);
  await verifyUploadLimit();
  await verifyPathTraversalRejected();
  await verifyQueueCapacity(fixtures.mp4Path);
  await verifyRequestAbortCleanup();
  await verifyExpiredCleanup();
  await verifyContainerFilesystem();
  console.log("Docker container verification passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function createFixtures() {
  const pdfPath = path.join(tempDir, "editio-test.pdf");
  const pngPath = path.join(tempDir, "editio-test.png");
  const wavPath = path.join(tempDir, "editio-test.wav");
  const mp4Path = path.join(tempDir, "editio-test.mp4");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([360, 220]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Editio Docker PDF Test", { x: 32, y: 155, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("PDF rendering, compression, and extraction.", { x: 32, y: 125, size: 11, font });
  await writeFile(pdfPath, await pdf.save());
  await writeFile(pngPath, tinyPng);
  await writeFile(wavPath, createWavSine({ seconds: 0.4, sampleRate: 8000 }));

  const ffmpeg = spawnSync(ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64:d=0.6",
    "-pix_fmt",
    "yuv420p",
    mp4Path
  ], { encoding: "utf8" });
  assert.equal(ffmpeg.status, 0, `fixture MP4 generation failed: ${ffmpeg.stderr}`);

  return { pdfPath, pngPath, wavPath, mp4Path };
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await delay(500);
    }
  }
  throw new Error("Container did not become healthy.");
}

async function verifyNativeDependenciesInContainer() {
  const script = `
    import { access, constants, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
    import os from "node:os";
    import path from "node:path";
    import { spawnSync } from "node:child_process";
    import ffmpegPath from "ffmpeg-static";
    import ffprobe from "ffprobe-static";
    import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
    import { PDFDocument, StandardFonts } from "pdf-lib";
    globalThis.DOMMatrix ??= DOMMatrix;
    globalThis.ImageData ??= ImageData;
    globalThis.Path2D ??= Path2D;
    await access(ffmpegPath, constants.X_OK);
    await access(ffprobe.path, constants.X_OK);
    if (spawnSync(ffmpegPath, ["-version"], { encoding: "utf8" }).status !== 0) throw new Error("ffmpeg -version failed");
    const tmp = await mkdtemp(path.join(os.tmpdir(), "editio-native-"));
    try {
      const wav = path.join(tmp, "in.wav");
      const mp3 = path.join(tmp, "out.mp3");
      await writeFile(wav, Buffer.from("UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAA=", "base64"));
      if (spawnSync(ffmpegPath, ["-y", "-i", wav, mp3], { encoding: "utf8" }).status !== 0) throw new Error("minimal ffmpeg conversion failed");
      const canvas = createCanvas(8, 8);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#dd2a7b";
      ctx.fillRect(0, 0, 8, 8);
      if (canvas.toBuffer("image/png").byteLength < 20) throw new Error("canvas export failed");
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([120, 80]);
      page.drawText("ok", { x: 20, y: 40, size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) });
      const bytes = await pdf.save();
      if ((await PDFDocument.load(bytes)).getPageCount() !== 1) throw new Error("pdf-lib load failed");
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, disableFontFace: true, useSystemFonts: true }).promise;
      const firstPage = await loaded.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      const renderCanvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await firstPage.render({ canvas: renderCanvas, canvasContext: renderCanvas.getContext("2d"), viewport }).promise;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  `;
  runDocker(["exec", containerName, "node", "--input-type=module", "-e", script]);
}

async function verifyHealth() {
  const response = await fetch(`${baseUrl}/health`);
  const body = await readResponseBody(response);
  assert.equal(response.status, 200, formatResponseFailure(response, body));
  assert.deepEqual(body, { ok: true });
}

async function verifyPdfUpload(pdfPath) {
  const json = await upload("/convert-file", {
    field: "file",
    filePath: pdfPath,
    type: "application/pdf",
    filename: "valid.pdf",
    fields: { outputFormat: "udf" }
  });
  assert.match(json.filename, /\.udf$/);
}

async function verifyFakePdfRejected() {
  const fakePath = path.join(tempDir, "fake.pdf");
  await writeFile(fakePath, "not a pdf");
  const response = await uploadRaw("/convert-file", {
    field: "file",
    filePath: fakePath,
    type: "application/pdf",
    filename: "fake.pdf",
    fields: { outputFormat: "udf" }
  });
  const body = await readResponseBody(response);
  assert.equal(response.status, 415, formatResponseFailure(response, body));
  assert.equal(body.success, false);
}

async function verifyPdfToImage(pdfPath) {
  const json = await upload("/convert-file", {
    field: "file",
    filePath: pdfPath,
    type: "application/pdf",
    filename: "render.pdf",
    fields: { outputFormat: "png" }
  });
  assert.ok(Array.isArray(json.files));
  assert.match(json.files[0].filename, /\.png$/);
}

async function verifyImageConversionAndDownload(pngPath) {
  const json = await upload("/convert-file", {
    field: "file",
    filePath: pngPath,
    type: "image/png",
    filename: "image.png",
    fields: { outputFormat: "webp" }
  });
  assert.match(json.filename, /\.webp$/);
  const download = await fetch(`${baseUrl}/files/${encodeURIComponent(json.filename)}`);
  assert.equal(download.status, 200);
  assert.ok((await download.arrayBuffer()).byteLength > 0);
}

async function verifyImageToPdf(pngPath) {
  const form = new FormData();
  const bytes = await readFile(pngPath);
  form.append("files", new Blob([bytes], { type: "image/png" }), "one.png");
  form.append("files", new Blob([bytes], { type: "image/png" }), "two.png");
  const response = await fetch(`${baseUrl}/convert-images-to-pdf`, { method: "POST", body: form });
  const body = await readResponseBody(response);
  assert.equal(response.status, 200, formatResponseFailure(response, body));
  assert.match(body.filename, /\.pdf$/);
}

async function verifyPdfCompression(pdfPath) {
  const json = await upload("/compress-pdf", {
    field: "file",
    filePath: pdfPath,
    type: "application/pdf",
    filename: "compress.pdf"
  });
  assert.match(json.filename, /\.pdf$/);
  assert.equal(typeof json.originalBytes, "number");
  assert.equal(typeof json.compressedBytes, "number");
}

async function verifyAudioConversion(wavPath) {
  const json = await upload("/convert-file", {
    field: "file",
    filePath: wavPath,
    type: "audio/wav",
    filename: "sound.wav",
    fields: { outputFormat: "mp3" }
  });
  assert.match(json.filename, /\.mp3$/);
}

async function verifyVideoConversion(mp4Path) {
  const json = await upload("/convert-file", {
    field: "file",
    filePath: mp4Path,
    type: "video/mp4",
    filename: "video.mp4",
    fields: { outputFormat: "gif", trimDurationSeconds: "0.4" }
  });
  assert.match(json.filename, /\.gif$/);
}

async function verifyUploadLimit() {
  const largePath = path.join(tempDir, "large.png");
  const maxInputMb = readContainerNumberEnv("MAX_INPUT_MB", 100);
  const maxInputBytes = maxInputMb * 1024 * 1024;
  await writeFile(largePath, Buffer.concat([tinyPng, Buffer.alloc(maxInputBytes + 1024)]));
  const response = await uploadRaw("/convert-file", {
    field: "file",
    filePath: largePath,
    type: "image/png",
    filename: "large.png",
    fields: { outputFormat: "webp" }
  });
  const body = await readResponseBody(response);
  assert.equal(response.status, 413, formatResponseFailure(response, body));
  assert.equal(body.code, "FILE_TOO_LARGE");
}

async function verifyPathTraversalRejected() {
  const response = await fetch(`${baseUrl}/files/%2e%2e%2f.env`);
  const body = await readResponseBody(response);
  assert.equal(response.status, 400, formatResponseFailure(response, body));
}

async function verifyQueueCapacity(mp4Path) {
  const maxConcurrentJobs = readContainerNumberEnv("MAX_CONCURRENT_JOBS", 2);
  const maxPendingJobs = readContainerNumberEnv("MAX_PENDING_JOBS", 10);
  const requestCount = maxConcurrentJobs + maxPendingJobs + 1;
  const requests = Array.from({ length: requestCount }, (_, index) => uploadRaw("/convert-file", {
    field: "file",
    filePath: mp4Path,
    type: "video/mp4",
    filename: `queue-${index}.mp4`,
    fields: { outputFormat: "gif", trimDurationSeconds: "0.6" }
  }));
  const responses = await Promise.all(requests);
  const parsed = await Promise.all(responses.map(async (response) => ({
    response,
    body: await readResponseBody(response)
  })));
  assert.ok(
    parsed.some(({ response }) => response.status === 503),
    `Expected at least one queue overflow response. Got: ${parsed.map(({ response, body }) => `${response.status}:${JSON.stringify(body)}`).join(", ")}`
  );
}

async function verifyRequestAbortCleanup() {
  await new Promise((resolve) => {
    const boundary = "editio-docker-abort";
    const url = new URL(baseUrl);
    const request = http.request({
      method: "POST",
      host: url.hostname,
      port: url.port,
      path: "/convert-file",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }
    });
    request.on("error", () => resolve());
    request.write(`--${boundary}\r\n`);
    request.write('Content-Disposition: form-data; name="file"; filename="partial.mp4"\r\n');
    request.write("Content-Type: video/mp4\r\n\r\n");
    request.write(Buffer.alloc(128 * 1024));
    request.destroy();
    setTimeout(resolve, 500);
  });
  await delay(800);
  const uploads = dockerOutput(["exec", containerName, "sh", "-c", "find /app/data/downloads/uploads -type f | wc -l"]).trim();
  assert.equal(uploads, "0");
}

async function verifyExpiredCleanup() {
  const ttlMinutes = readContainerNumberEnv("JOB_TTL_MINUTES", 30);
  const expiredAgeMinutes = ttlMinutes + 1;
  runDocker(["exec", containerName, "sh", "-c", `printf old > /app/data/downloads/expired.pdf && touch -d '${expiredAgeMinutes} minutes ago' /app/data/downloads/expired.pdf && npm run cleanup >/tmp/editio-cleanup.log`]);
  const exists = spawnSync("docker", ["exec", containerName, "test", "-e", "/app/data/downloads/expired.pdf"]);
  assert.notEqual(exists.status, 0);
}

async function verifyContainerFilesystem() {
  const check = [
    "test \"$(id -u)\" != \"0\"",
    "test -w /app/data/downloads",
    "test ! -w /app/src/server.js",
    "test ! -e /app/.env",
    "test ! -e /app/downloads",
    "test ! -e /Users/cantecim"
  ].join(" && ");
  runDocker(["exec", containerName, "sh", "-c", check]);
}

async function upload(endpoint, options) {
  const response = await uploadRaw(endpoint, options);
  const body = await readResponseBody(response);
  assert.equal(response.status, 200, formatResponseFailure(response, body));
  return body;
}

async function uploadRaw(endpoint, { field, filePath, type, filename, fields = {} }) {
  const form = new FormData();
  form.append(field, new Blob([await readFile(filePath)], { type }), filename);
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, String(value));
  }
  return fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form });
}

function createWavSine({ seconds, sampleRate }) {
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 12000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

function runDocker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", stdio: "pipe" });
  assert.equal(result.status, 0, `docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function dockerOutput(args) {
  return runDocker(args).stdout;
}

function readContainerNumberEnv(name, fallback) {
  const rawValue = dockerOutput(["exec", containerName, "sh", "-c", `printf '%s' "\${${name}:-}"`]).trim();
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function readResponseBody(response) {
  const rawBody = await response.text();
  if (!rawBody) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

function formatResponseFailure(response, body) {
  const renderedBody = typeof body === "string" ? body : JSON.stringify(body);
  return `Expected successful verification response, got HTTP ${response.status}: ${renderedBody ?? ""}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
