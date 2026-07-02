import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { PDFDocument } from "pdf-lib";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";

export async function convertUploadedFile({ file, outputFormat, trimOptions, context = {} }) {
  assertNotAborted(context.signal);
  await mkdir(config.downloadDir, { recursive: true });

  const id = nanoid();
  const safeFormat = outputFormat;

  if (safeFormat === "udf" && isPdfInput(file)) {
    const filename = await convertPdfToUdf(file.path, file.originalname, id, context);
    return {
      fileUrl: `${config.publicBaseUrl}/files/${filename}`,
      filename
    };
  }

  if ((safeFormat === "jpg" || safeFormat === "png") && isPdfInput(file)) {
    const createdFiles = await renderPdfToImages(file.path, id, safeFormat, context);
    return {
      files: createdFiles.map((filename) => ({
        fileUrl: `${config.publicBaseUrl}/files/${filename}`,
        filename
      }))
    };
  }

  if ((safeFormat === "jpg" || safeFormat === "png" || safeFormat === "webp") && isStillImageInput(file)) {
    const filename = await convertStillImage(file.path, id, safeFormat, context);
    return {
      fileUrl: `${config.publicBaseUrl}/files/${filename}`,
      filename
    };
  }

  const outputName = `upload_${id}.${safeFormat}`;
  const outputPath = trackOutput(path.join(config.downloadDir, outputName), context);

  validateFfmpegConversion(file, safeFormat);
  try {
    await runFfmpeg(file.path, outputPath, safeFormat, trimOptions, context.signal);
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }
  context.tracker?.keepOutput(outputPath);

  return {
    fileUrl: `${config.publicBaseUrl}/files/${outputName}`,
    filename: outputName
  };
}

function validateFfmpegConversion(file, outputFormat) {
  const supported =
    (outputFormat === "mp3" && (isVideoInput(file) || isWavInput(file))) ||
    (outputFormat === "wav" && isMp3Input(file)) ||
    (outputFormat === "gif" && (isMp4Input(file) || isMovInput(file))) ||
    (outputFormat === "mp4" && (isGifInput(file) || isVideoInput(file)));

  if (!supported) {
    throw new HttpError(400, "Unsupported conversion pair.");
  }
}

export async function convertUploadedImagesToPdf({ files, context = {} }) {
  assertNotAborted(context.signal);
  await mkdir(config.downloadDir, { recursive: true });
  if (!files?.length) {
    throw new HttpError(400, "At least one image file is required.");
  }

  const id = nanoid();
  const pdf = await PDFDocument.create();

  for (const file of files) {
    assertNotAborted(context.signal);
    if (!isPngInput(file) && !isJpegInput(file)) {
      throw new HttpError(400, "Only JPG and PNG images can be merged into a PDF.");
    }
    const bytes = await readFile(file.path);
    const image = isPngInput(file) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const outputName = `upload_${id}.pdf`;
  const outputPath = trackOutput(path.join(config.downloadDir, outputName), context);
  await writeFile(outputPath, await pdf.save());
  context.tracker?.keepOutput(outputPath);

  return {
    fileUrl: `${config.publicBaseUrl}/files/${outputName}`,
    filename: outputName
  };
}

export async function compressUploadedPdf({ file, context = {} }) {
  assertNotAborted(context.signal);
  await mkdir(config.downloadDir, { recursive: true });
  if (!isPdfInput(file)) {
    throw new HttpError(400, "A PDF file is required.");
  }

  const id = nanoid();
  const originalBytes = await readFile(file.path);
  const candidates = [];

  try {
    assertNotAborted(context.signal);
    const rewritten = await rewritePdfWithObjectStreams(originalBytes);
    candidates.push({ method: "optimized", bytes: rewritten });
  } catch {
    // Some PDFs are encrypted or malformed; raster compression can still work for readable pages.
  }

  try {
    assertNotAborted(context.signal);
    const rasterized = await rasterizePdfForCompression(originalBytes, context);
    candidates.push({ method: "rasterized", bytes: rasterized });
  } catch {
    // Keep the safe rewritten/original fallback below.
  }

  const best = candidates
    .filter((candidate) => candidate.bytes.byteLength > 0)
    .sort((left, right) => left.bytes.byteLength - right.bytes.byteLength)[0] ?? {
      method: "original",
      bytes: originalBytes
    };
  const finalBytes = best.bytes.byteLength < originalBytes.byteLength ? best.bytes : originalBytes;
  const method = best.bytes.byteLength < originalBytes.byteLength ? best.method : "original";
  const outputName = `compressed_${id}.pdf`;
  const outputPath = trackOutput(path.join(config.downloadDir, outputName), context);

  try {
    assertNotAborted(context.signal);
    await writeFile(outputPath, finalBytes);
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }
  context.tracker?.keepOutput(outputPath);

  const compressedBytes = finalBytes.byteLength;
  const savedBytes = Math.max(0, originalBytes.byteLength - compressedBytes);

  return {
    fileUrl: `${config.publicBaseUrl}/files/${outputName}`,
    filename: outputName,
    originalBytes: originalBytes.byteLength,
    compressedBytes,
    savedBytes,
    savedPercent: originalBytes.byteLength > 0 ? Math.round((savedBytes / originalBytes.byteLength) * 1000) / 10 : 0,
    method
  };
}

async function convertPdfToUdf(inputPath, originalName, id, context) {
  let text = "";
  try {
    assertNotAborted(context.signal);
    text = await extractPdfText(inputPath);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "PDF text could not be extracted.");
  }
  const filename = `upload_${id}.udf`;
  const outputPath = trackOutput(path.join(config.downloadDir, filename), context);
  assertNotAborted(context.signal);
  await writeFile(outputPath, buildUdfDocument({ sourceName: sanitizeSourceName(originalName), text }), "utf8");
  context.tracker?.keepOutput(outputPath);
  return filename;
}

async function rewritePdfWithObjectStreams(originalBytes) {
  const pdf = await PDFDocument.load(originalBytes, {
    ignoreEncryption: false,
    updateMetadata: false
  });
  return Buffer.from(await pdf.save({
    useObjectStreams: true,
    addDefaultPage: false
  }));
}

async function rasterizePdfForCompression(originalBytes, context = {}) {
  const { createCanvas, DOMMatrix, ImageData, Path2D } = await import("@napi-rs/canvas");
  globalThis.DOMMatrix ??= DOMMatrix;
  globalThis.ImageData ??= ImageData;
  globalThis.Path2D ??= Path2D;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(originalBytes),
    disableFontFace: true,
    disableWorker: true,
    useSystemFonts: true
  });
  const sourcePdf = await loadingTask.promise;
  const compressedPdf = await PDFDocument.create();
  const maxRasterDimension = 1500;
  const jpegQuality = 0.72;

  for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
    assertNotAborted(context.signal);
    const page = await sourcePdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(
      1,
      Math.min(1.55, maxRasterDimension / Math.max(baseViewport.width, baseViewport.height))
    );
    const renderViewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(renderViewport.width), Math.ceil(renderViewport.height));
    const drawingContext = canvas.getContext("2d");
    drawingContext.fillStyle = "#ffffff";
    drawingContext.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: drawingContext,
      viewport: renderViewport
    }).promise;

    const image = await compressedPdf.embedJpg(canvas.toBuffer("image/jpeg", jpegQuality));
    const outputPage = compressedPdf.addPage([baseViewport.width, baseViewport.height]);
    outputPage.drawImage(image, {
      x: 0,
      y: 0,
      width: baseViewport.width,
      height: baseViewport.height
    });
  }

  return Buffer.from(await compressedPdf.save({ useObjectStreams: true }));
}

async function extractPdfText(inputPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await readFile(inputPath)),
    disableFontFace: true,
    disableWorker: true,
    useSystemFonts: true
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(pageText);
  }

  return pages.filter(Boolean).join("\n\n");
}

function buildUdfDocument({ sourceName, text }) {
  const createdAt = new Date().toISOString();
  const escapedSource = escapeXml(sourceName ?? "converted.pdf");
  const escapedText = escapeXml(text || "PDF metni çıkarılamadı. Kaynak PDF görsel tabanlı olabilir.");

  return `<?xml version="1.0" encoding="UTF-8"?>
<uyapDocument version="1.0" generator="File Converter">
  <metadata>
    <source>${escapedSource}</source>
    <createdAt>${createdAt}</createdAt>
    <conversion>PDF_TO_UDF</conversion>
  </metadata>
  <content>
    <paragraph>${escapedText}</paragraph>
  </content>
</uyapDocument>
`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeSourceName(value) {
  return path.basename(String(value || "converted.pdf")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160);
}

function isPdfInput(file) {
  return file.detectedKind === "pdf";
}

function isPngInput(file) {
  return file.detectedKind === "png";
}

function isJpegInput(file) {
  return file.detectedKind === "jpg";
}

function isStillImageInput(file) {
  return file.detectedKind === "jpg" || file.detectedKind === "png" || file.detectedKind === "webp";
}

function isVideoInput(file) {
  return ["mp4", "avi", "mov", "mkv", "webm"].includes(file.detectedKind);
}

function isMp4Input(file) {
  return file.detectedKind === "mp4";
}

function isMovInput(file) {
  return file.detectedKind === "mov";
}

function isGifInput(file) {
  return file.detectedKind === "gif";
}

function isMp3Input(file) {
  return file.detectedKind === "mp3";
}

function isWavInput(file) {
  return file.detectedKind === "wav";
}

async function convertStillImage(inputPath, id, outputFormat, context = {}) {
  assertNotAborted(context.signal);
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(await readFile(inputPath));
  const canvas = createCanvas(image.width, image.height);
  const drawingContext = canvas.getContext("2d");

  if (outputFormat === "jpg") {
    drawingContext.fillStyle = "#ffffff";
    drawingContext.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawingContext.drawImage(image, 0, 0, image.width, image.height);

  const filename = `upload_${id}.${outputFormat}`;
  const outputPath = trackOutput(path.join(config.downloadDir, filename), context);
  const buffer =
    outputFormat === "jpg"
      ? canvas.toBuffer("image/jpeg", 0.92)
      : outputFormat === "webp"
        ? canvas.toBuffer("image/webp", 0.88)
        : canvas.toBuffer("image/png");
  await writeFile(outputPath, buffer);
  context.tracker?.keepOutput(outputPath);
  return filename;
}

async function renderPdfToImages(inputPath, id, outputFormat, context = {}) {
  assertNotAborted(context.signal);
  const { createCanvas, DOMMatrix, ImageData, Path2D } = await import("@napi-rs/canvas");
  globalThis.DOMMatrix ??= DOMMatrix;
  globalThis.ImageData ??= ImageData;
  globalThis.Path2D ??= Path2D;

  const files = [];

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await readFile(inputPath)),
      disableFontFace: true,
      disableWorker: true,
      useSystemFonts: true
    });
    const pdf = await loadingTask.promise;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      assertNotAborted(context.signal);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const drawingContext = canvas.getContext("2d");

      if (outputFormat === "jpg") {
        drawingContext.fillStyle = "#ffffff";
        drawingContext.fillRect(0, 0, canvas.width, canvas.height);
      }

      await page.render({
        canvas,
        canvasContext: drawingContext,
        viewport
      }).promise;

      const filename = `upload_${id}_page_${String(pageNumber).padStart(3, "0")}.${outputFormat}`;
      const imagePath = trackOutput(path.join(config.downloadDir, filename), context);
      const buffer =
        outputFormat === "jpg"
          ? canvas.toBuffer("image/jpeg", 0.92)
          : canvas.toBuffer("image/png");
      await writeFile(imagePath, buffer);
      context.tracker?.keepOutput(imagePath);
      files.push(filename);
    }
  } catch (error) {
    await Promise.allSettled(files.map((filename) => rm(path.join(config.downloadDir, filename), { force: true })));
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "PDF pages could not be rendered.");
  }

  return files;
}

function runFfmpeg(inputPath, outputPath, outputFormat, trimOptions, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    const args = buildArgs(inputPath, outputPath, outputFormat, trimOptions);

    const child = spawn(config.ffmpegPath, args, { shell: false, windowsHide: true });
    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 1500).unref?.();
      reject(cancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new HttpError(500, "Conversion engine could not be started.", { expose: false }));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(cancelledError());
        return;
      }
      if (code !== 0) {
        reject(new HttpError(422, "File could not be converted. Check that the input file matches the selected output format."));
        return;
      }
      resolve();
    });
  });
}

function trackOutput(outputPath, context) {
  return context.tracker?.trackOutput(outputPath) ?? outputPath;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw cancelledError();
}

function cancelledError() {
  return new HttpError(499, "Request was cancelled.", { code: "REQUEST_CANCELLED", expose: false });
}

function buildArgs(inputPath, outputPath, outputFormat, trimOptions) {
  if (outputFormat === "mp3") {
    return ["-y", "-i", inputPath, "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", outputPath];
  }

  if (outputFormat === "wav") {
    return ["-y", "-i", inputPath, "-vn", "-codec:a", "pcm_s16le", outputPath];
  }

  if (outputFormat === "gif") {
    const startSeconds = clampNumber(trimOptions?.startSeconds ?? 0, 0, 24 * 60 * 60);
    const durationSeconds = clampNumber(trimOptions?.durationSeconds ?? 3, 0.1, 3);
    return [
      "-y",
      "-ss",
      String(startSeconds),
      "-t",
      String(durationSeconds),
      "-i",
      inputPath,
      "-an",
      "-vf",
      "fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
      "-loop",
      "0",
      "-f",
      "gif",
      outputPath
    ];
  }

  if (outputFormat === "jpg" || outputFormat === "png") {
    return [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "scale=1600:-1",
      "-frames:v",
      "999",
      outputPath
    ];
  }

  if (outputFormat === "webp") {
    return ["-y", "-i", inputPath, "-c:v", "libwebp", "-quality", "88", outputPath];
  }

  return [
    "-y",
    "-i",
    inputPath,
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

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}
