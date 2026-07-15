import express from "express";
import { z } from "zod";
import path from "node:path";
import { stat } from "node:fs/promises";
import multer from "multer";
import { config } from "../config.js";
import { compressUploadedPdf, convertUploadedFile, convertUploadedImagesToPdf } from "../services/uploadConvertService.js";
import { createOperationTracker, safeRemoveFile } from "../services/fileCleanupService.js";
import { allowedKindsForOutput, validateUploadedFiles } from "../services/fileValidationService.js";
import { conversionQueue } from "../services/conversionJobQueue.js";
import { HttpError } from "../utils/httpError.js";

export const mediaRoutes = express.Router();
const upload = multer({
  dest: path.join(config.downloadDir, "uploads"),
  limits: {
    fileSize: config.maxInputBytes,
    files: config.maxFilesPerRequest,
    fields: 8
  }
});
const outputFormatSchema = z.enum(["mp3", "mp4", "gif", "jpg", "png", "webp", "wav", "udf"]);
const compressionPresetSchema = z.enum(["quality", "balanced", "small"]);

mediaRoutes.get("/health", (_request, response) => {
  response.json({ ok: true });
});

mediaRoutes.post("/convert-file", upload.single("file"), async (request, response, next) => {
  const requestContext = createRequestContext(request, response);
  const tracker = createOperationTracker();
  if (request.file) tracker.trackInput(request.file.path);
  let keepOutputs = false;
  try {
    if (!request.file) {
      throw new HttpError(400, "File is required.");
    }
    const payload = z.object({
      outputFormat: outputFormatSchema,
      trimStartSeconds: z.coerce.number().min(0).optional(),
      trimDurationSeconds: z.coerce.number().min(0.1).max(3).optional()
    }).parse(request.body);
    const trimOptions =
      payload.trimStartSeconds !== undefined || payload.trimDurationSeconds !== undefined
        ? {
            startSeconds: payload.trimStartSeconds ?? 0,
            durationSeconds: payload.trimDurationSeconds ?? 3
          }
        : undefined;
    await validateUploadedFiles(request.file, allowedKindsForOutput(payload.outputFormat), { signal: requestContext.signal });
    const result = await conversionQueue.run(
      ({ signal }) => convertUploadedFile({
        file: request.file,
        outputFormat: payload.outputFormat,
        trimOptions,
        context: { signal, tracker }
      }),
      { signal: requestContext.signal }
    );
    if (requestContext.signal.aborted) {
      throw new HttpError(499, "Request was cancelled.", { code: "REQUEST_CANCELLED", expose: false });
    }
    response.json(result);
    keepOutputs = true;
  } catch (error) {
    next(error);
  } finally {
    await tracker.close({ keepOutputs });
    await cleanupUploadedFiles(request.file);
    requestContext.close();
  }
});

mediaRoutes.post("/convert-images-to-pdf", upload.array("files", config.maxFilesPerRequest), async (request, response, next) => {
  const requestContext = createRequestContext(request, response);
  const tracker = createOperationTracker();
  const files = Array.isArray(request.files) ? request.files : [];
  for (const file of files) tracker.trackInput(file.path);
  let keepOutputs = false;
  try {
    if (!files.length) {
      throw new HttpError(400, "At least one image file is required.");
    }
    await validateUploadedFiles(files, ["jpg", "png"], { signal: requestContext.signal });
    const result = await conversionQueue.run(
      ({ signal }) => convertUploadedImagesToPdf({ files, context: { signal, tracker } }),
      { signal: requestContext.signal }
    );
    if (requestContext.signal.aborted) {
      throw new HttpError(499, "Request was cancelled.", { code: "REQUEST_CANCELLED", expose: false });
    }
    response.json(result);
    keepOutputs = true;
  } catch (error) {
    next(error);
  } finally {
    await tracker.close({ keepOutputs });
    await cleanupUploadedFiles(files);
    requestContext.close();
  }
});

mediaRoutes.post("/compress-pdf", upload.single("file"), async (request, response, next) => {
  const requestContext = createRequestContext(request, response);
  const tracker = createOperationTracker();
  if (request.file) tracker.trackInput(request.file.path);
  let keepOutputs = false;
  try {
    if (!request.file) {
      throw new HttpError(400, "File is required.");
    }
    const payload = z.object({
      compressionPreset: compressionPresetSchema.default("balanced")
    }).parse(request.body);
    await validateUploadedFiles(request.file, ["pdf"], { signal: requestContext.signal });
    const result = await conversionQueue.run(
      ({ signal }) => compressUploadedPdf({
        file: request.file,
        compressionPreset: payload.compressionPreset,
        context: { signal, tracker }
      }),
      { signal: requestContext.signal }
    );
    if (requestContext.signal.aborted) {
      throw new HttpError(499, "Request was cancelled.", { code: "REQUEST_CANCELLED", expose: false });
    }
    response.json(result);
    keepOutputs = true;
  } catch (error) {
    next(error);
  } finally {
    await tracker.close({ keepOutputs });
    await cleanupUploadedFiles(request.file);
    requestContext.close();
  }
});

mediaRoutes.get("/files/:filename", async (request, response, next) => {
  const safeName = sanitizeDownloadName(request.params.filename);
  if (!safeName) {
    next(new HttpError(400, "Invalid filename."));
    return;
  }

  const filePath = path.resolve(config.downloadDir, safeName);
  if (!isDirectChild(config.downloadDir, filePath)) {
    next(new HttpError(400, "Invalid filename."));
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile() || Date.now() - info.mtimeMs > config.jobTtlMs) {
      await safeRemoveFile(filePath);
      next(new HttpError(404, "File not found.", { code: "FILE_NOT_FOUND" }));
      return;
    }
    response.type(contentTypeFor(safeName));
    response.download(filePath, safeName, {
      headers: {
        "X-Content-Type-Options": "nosniff"
      }
    }, (error) => {
      if (!error) return;
      if (response.headersSent) {
        next(error);
        return;
      }
      next(new HttpError(error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "File not found." : "File could not be downloaded."));
    });
  } catch (error) {
    next(new HttpError(error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "File not found." : "File could not be downloaded."));
  }
});

async function cleanupUploadedFiles(files) {
  const uploadFiles = [files].flat().filter(Boolean);
  await Promise.allSettled(
    uploadFiles.map((file) => safeRemoveFile(file.path))
  );
}

function createRequestContext(request, response) {
  const controller = new AbortController();
  const abort = () => {
    if (!response.writableEnded) controller.abort(new Error("client aborted"));
  };
  request.on("aborted", abort);
  response.on("close", abort);
  return {
    signal: controller.signal,
    close() {
      request.off("aborted", abort);
      response.off("close", abort);
    }
  };
}

function sanitizeDownloadName(value) {
  if (typeof value !== "string") return null;
  if (value !== path.basename(value)) return null;
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) return null;
  if (value.startsWith(".") || value === "uploads") return null;
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(value)) return null;
  return value;
}

function isDirectChild(root, candidate) {
  return path.dirname(candidate) === path.resolve(root);
}

function contentTypeFor(filename) {
  const extension = path.extname(filename).toLowerCase();
  return {
    ".pdf": "application/pdf",
    ".udf": "application/xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4"
  }[extension] ?? "application/octet-stream";
}
