import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { config } from "../config.js";
import { sendSupportRequest } from "../services/supportMailService.js";
import { HttpError } from "../utils/httpError.js";

export const supportRoutes = express.Router();

const allowedFileTypes = new Map([
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".png", new Set(["image/png"])],
  [".webp", new Set(["image/webp"])],
  [".heic", new Set(["image/heic", "image/heif"])],
  [".heif", new Set(["image/heic", "image/heif"])],
  [".pdf", new Set(["application/pdf"])],
  [".txt", new Set(["text/plain"])],
  [".log", new Set(["text/plain"])]
]);

const allowedClientMimeTypes = new Set([
  "application/octet-stream",
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.supportMaxAttachmentBytes,
    files: 1,
    fields: 4,
    fieldSize: 4 * 1024
  },
  fileFilter(_request, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedFileTypes.has(extension) || !allowedClientMimeTypes.has(file.mimetype.toLowerCase())) {
      callback(new HttpError(415, "The attachment type is not supported.", {
        code: "UNSUPPORTED_ATTACHMENT_TYPE"
      }));
      return;
    }
    callback(null, true);
  }
});

const supportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler(request, response) {
    response.status(429).json({
      success: false,
      code: "SUPPORT_RATE_LIMITED",
      message: "Too many support requests. Please try again later.",
      error: "Too many support requests. Please try again later.",
      requestId: request.id
    });
  }
});

const safeText = z.string().refine(
  (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
  "Unsupported control characters were provided."
);

const supportRequestSchema = z.object({
  fullName: safeText.trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  subject: safeText.trim().min(3).max(140).refine((value) => !/[\r\n\u2028\u2029]/.test(value), "Subject must use one line."),
  description: safeText.trim().min(10).max(3000)
}).strict();

supportRoutes.post("/requests", supportLimiter, upload.single("attachment"), async (request, response, next) => {
  try {
    const payload = supportRequestSchema.parse(request.body);
    const attachment = request.file ? await validateAttachment(request.file) : null;
    await sendSupportRequest({
      ...payload,
      attachment,
      requestId: request.id
    });
    response.status(201).json({
      success: true,
      message: "Support request received.",
      requestId: request.id
    });
  } catch (error) {
    next(error);
  }
});

async function validateAttachment(file) {
  if (!file.buffer?.length) {
    throw new HttpError(400, "The attachment is empty.", { code: "EMPTY_ATTACHMENT" });
  }

  const extension = path.extname(file.originalname).toLowerCase();
  const expectedMimeTypes = allowedFileTypes.get(extension);
  const detected = await fileTypeFromBuffer(file.buffer);

  if (extension === ".txt" || extension === ".log") {
    if (detected || file.buffer.includes(0)) {
      throw new HttpError(415, "The attachment content does not match its file type.", {
        code: "INVALID_ATTACHMENT_CONTENT"
      });
    }
    return {
      buffer: file.buffer,
      filename: sanitizeFilename(file.originalname),
      mimeType: "text/plain"
    };
  }

  if (!detected || !expectedMimeTypes?.has(detected.mime)) {
    throw new HttpError(415, "The attachment content does not match its file type.", {
      code: "INVALID_ATTACHMENT_CONTENT"
    });
  }

  return {
    buffer: file.buffer,
    filename: sanitizeFilename(file.originalname),
    mimeType: detected.mime
  };
}

function sanitizeFilename(originalName) {
  const basename = path.basename(originalName).normalize("NFKC");
  const safe = basename
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return safe || "attachment";
}
