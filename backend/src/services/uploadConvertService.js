import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { PDFDocument } from "pdf-lib";
import { config } from "../config.js";

export async function convertUploadedFile({ file, outputFormat, trimOptions }) {
  await mkdir(config.downloadDir, { recursive: true });

  const id = nanoid();
  const safeFormat = outputFormat;

  if (safeFormat === "udf" && isPdfInput(file)) {
    const filename = await convertPdfToUdf(file.path, file.originalname, id);
    return {
      fileUrl: `${config.publicBaseUrl}/files/${filename}`,
      filename
    };
  }

  if ((safeFormat === "jpg" || safeFormat === "png") && isPdfInput(file)) {
    const createdFiles = await renderPdfToImages(file.path, id, safeFormat);
    return {
      files: createdFiles.map((filename) => ({
        fileUrl: `${config.publicBaseUrl}/files/${filename}`,
        filename
      }))
    };
  }

  if ((safeFormat === "jpg" || safeFormat === "png" || safeFormat === "webp") && isStillImageInput(file)) {
    const filename = await convertStillImage(file.path, id, safeFormat);
    return {
      fileUrl: `${config.publicBaseUrl}/files/${filename}`,
      filename
    };
  }

  const outputName = `upload_${id}.${safeFormat}`;
  const outputPath = path.join(config.downloadDir, outputName);

  await runFfmpeg(file.path, outputPath, safeFormat, trimOptions);

  return {
    fileUrl: `${config.publicBaseUrl}/files/${outputName}`,
    filename: outputName
  };
}

export async function convertUploadedImagesToPdf({ files }) {
  await mkdir(config.downloadDir, { recursive: true });
  if (!files?.length) {
    throw new Error("No files were uploaded.");
  }

  const id = nanoid();
  const pdf = await PDFDocument.create();

  for (const file of files) {
    const bytes = await readFile(file.path);
    const image = isPngInput(file) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const outputName = `upload_${id}.pdf`;
  const outputPath = path.join(config.downloadDir, outputName);
  await writeFile(outputPath, await pdf.save());

  return {
    fileUrl: `${config.publicBaseUrl}/files/${outputName}`,
    filename: outputName
  };
}

async function convertPdfToUdf(inputPath, originalName, id) {
  const text = await extractPdfText(inputPath);
  const filename = `upload_${id}.udf`;
  const outputPath = path.join(config.downloadDir, filename);
  await writeFile(outputPath, buildUdfDocument({ sourceName: originalName, text }), "utf8");
  return filename;
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

function isPdfInput(file) {
  return file.mimetype === "application/pdf" || file.originalname?.toLowerCase().endsWith(".pdf");
}

function isPngInput(file) {
  return file.mimetype === "image/png" || file.originalname?.toLowerCase().endsWith(".png");
}

function isStillImageInput(file) {
  const name = file.originalname?.toLowerCase() ?? "";
  return (
    file.mimetype?.startsWith("image/") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp")
  );
}

async function convertStillImage(inputPath, id, outputFormat) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(await readFile(inputPath));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");

  if (outputFormat === "jpg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0, image.width, image.height);

  const filename = `upload_${id}.${outputFormat}`;
  const outputPath = path.join(config.downloadDir, filename);
  const buffer =
    outputFormat === "jpg"
      ? canvas.toBuffer("image/jpeg", 0.92)
      : outputFormat === "webp"
        ? canvas.toBuffer("image/webp", 0.88)
        : canvas.toBuffer("image/png");
  await writeFile(outputPath, buffer);
  return filename;
}

async function renderPdfToImages(inputPath, id, outputFormat) {
  const { createCanvas, DOMMatrix, ImageData, Path2D } = await import("@napi-rs/canvas");
  globalThis.DOMMatrix ??= DOMMatrix;
  globalThis.ImageData ??= ImageData;
  globalThis.Path2D ??= Path2D;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await readFile(inputPath)),
    disableFontFace: true,
    disableWorker: true,
    useSystemFonts: true
  });
  const pdf = await loadingTask.promise;
  const files = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    if (outputFormat === "jpg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    await page.render({
      canvas,
      canvasContext: context,
      viewport
    }).promise;

    const filename = `upload_${id}_page_${String(pageNumber).padStart(3, "0")}.${outputFormat}`;
    const imagePath = path.join(config.downloadDir, filename);
    const buffer =
      outputFormat === "jpg"
        ? canvas.toBuffer("image/jpeg", 0.92)
        : canvas.toBuffer("image/png");
    await writeFile(imagePath, buffer);
    files.push(filename);
  }

  return files;
}

function runFfmpeg(inputPath, outputPath, outputFormat, trimOptions) {
  return new Promise((resolve, reject) => {
    const args = buildArgs(inputPath, outputPath, outputFormat, trimOptions);

    const child = spawn(config.ffmpegPath, args, { shell: false, windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "FFmpeg conversion failed."));
        return;
      }
      resolve();
    });
  });
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
