import express from "express";
import { z } from "zod";
import path from "node:path";
import multer from "multer";
import { config } from "../config.js";
import { getMediaInfo } from "../services/mediaInfoService.js";
import { enqueueDownload } from "../services/downloadService.js";
import { convertUploadedFile, convertUploadedImagesToPdf } from "../services/uploadConvertService.js";
import { getJob } from "../services/jobStore.js";
import { HttpError } from "../utils/httpError.js";

export const mediaRoutes = express.Router();
const upload = multer({
  dest: path.join(config.downloadDir, "uploads"),
  limits: { fileSize: config.maxInputBytes }
});

const urlSchema = z.object({
  url: z.string().url()
});

const downloadSchema = z.object({
  url: z.string().url(),
  quality: z.enum(["360p", "480p", "720p"]).default("720p"),
  format: z.enum(["mp4", "mp3"])
});

mediaRoutes.get("/health", (_request, response) => {
  response.json({ ok: true });
});

mediaRoutes.get("/media-info", async (request, response, next) => {
  try {
    const { url } = urlSchema.parse(request.query);
    response.json(await getMediaInfo(url));
  } catch (error) {
    next(error);
  }
});

mediaRoutes.post("/download", async (request, response, next) => {
  try {
    const payload = downloadSchema.parse(request.body);
    response.status(202).json(await enqueueDownload(payload));
  } catch (error) {
    next(error);
  }
});

mediaRoutes.post("/convert-file", upload.single("file"), async (request, response, next) => {
  try {
    if (!request.file) {
      throw new HttpError(400, "File is required.");
    }
    const payload = z.object({
      outputFormat: z.enum(["mp3", "mp4", "gif", "jpg", "png", "webp", "wav", "udf"]),
      trimStartSeconds: z.coerce.number().min(0).optional(),
      trimDurationSeconds: z.coerce.number().min(0.1).max(3).optional()
    }).parse(request.body);
    response.json(await convertUploadedFile({
      file: request.file,
      outputFormat: payload.outputFormat,
      trimOptions: payload.trimStartSeconds !== undefined || payload.trimDurationSeconds !== undefined
        ? {
            startSeconds: payload.trimStartSeconds ?? 0,
            durationSeconds: payload.trimDurationSeconds ?? 3
          }
        : undefined
    }));
  } catch (error) {
    next(error);
  }
});

mediaRoutes.post("/convert-images-to-pdf", upload.array("files", 100), async (request, response, next) => {
  try {
    response.json(await convertUploadedImagesToPdf({ files: request.files }));
  } catch (error) {
    next(error);
  }
});

mediaRoutes.get("/download/:jobId", (request, response, next) => {
  const job = getJob(request.params.jobId);
  if (!job) {
    next(new HttpError(404, "Job not found."));
    return;
  }
  response.json(job);
});

mediaRoutes.get("/files/:filename", (request, response, next) => {
  const safeName = path.basename(request.params.filename);
  if (safeName !== request.params.filename) {
    next(new HttpError(400, "Invalid filename."));
    return;
  }

  response.download(path.join(config.downloadDir, safeName));
});
