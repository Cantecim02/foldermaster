import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { nanoid } from "nanoid";
import { mkdir } from "node:fs/promises";
import { config } from "./config.js";
import { accountRoutes } from "./routes/accountRoutes.js";
import { mediaRoutes } from "./routes/mediaRoutes.js";
import { closeAccountStore, initializeAccountStore } from "./services/accountService.js";
import { cleanupExpiredFiles, startCleanupTimer, stopCleanupTimer } from "./services/fileCleanupService.js";
import { conversionQueue } from "./services/conversionJobQueue.js";
import { createErrorPayload, HttpError } from "./utils/httpError.js";

await mkdir(config.downloadDir, { recursive: true });
await initializeAccountStore();
await cleanupExpiredFiles().catch((error) => {
  console.warn(`[cleanup] startup failed: ${sanitizeLogMessage(error)}`);
});
startCleanupTimer();

const app = express();

if (config.trustProxyHops > 0) {
  app.set("trust proxy", config.trustProxyHops);
}

app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: false,
  strictTransportSecurity: config.isProduction ? undefined : false
}));
app.use((request, response, next) => {
  request.id = nanoid(12);
  response.setHeader("X-Request-Id", request.id);
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      const isLocalNetworkOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(origin ?? "");
      if (!origin || config.allowedOrigins.includes(origin) || (!config.isProduction && isLocalNetworkOrigin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, "Origin not allowed."));
    }
  })
);
app.use(express.json({ limit: "1mb" }));
morgan.token("id", (request) => request.id ?? "-");
app.use(morgan(config.isProduction ? ":id :method :url :status :response-time ms" : "dev"));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use("/auth", accountRoutes);
app.use("/", mediaRoutes);

app.use((_request, _response, next) => {
  next(new HttpError(404, "Endpoint not found.", { code: "FILE_NOT_FOUND" }));
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error?.name === "ZodError") {
    const invalidRequest = new HttpError(400, "Invalid request.", {
      code: "INVALID_REQUEST",
      details: error.issues
    });
    response.status(400).json(withRequestId(createErrorPayload(invalidRequest, { includeDetails: !config.isProduction }), request));
    return;
  }

  if (error?.name === "MulterError") {
    const mapped = mapMulterError(error);
    response.status(mapped.status).json(withRequestId(createErrorPayload(mapped, { includeDetails: !config.isProduction }), request));
    return;
  }

  const status = error?.status ?? 500;
  if (status >= 500) {
    logServerError(error, request);
  }

  response.status(status).json(withRequestId(createErrorPayload(error, { includeDetails: !config.isProduction }), request));
});

const server = app.listen(config.port, () => {
  console.log(`Media backend listening on ${config.publicBaseUrl}`);
});
server.requestTimeout = 11 * 60 * 1000;
server.headersTimeout = 65 * 1000;
server.keepAliveTimeout = 5 * 1000;

let isShuttingDown = false;

function mapMulterError(error) {
  if (error.code === "LIMIT_FILE_SIZE") {
    return new HttpError(413, "The selected file is too large.", { code: "FILE_TOO_LARGE" });
  }
  if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
    return new HttpError(413, "Too many files were uploaded.", { code: "TOO_MANY_FILES" });
  }
  return new HttpError(400, "Uploaded file could not be accepted.", { code: "INVALID_REQUEST" });
}

function withRequestId(payload, request) {
  return {
    ...payload,
    requestId: request.id
  };
}

function logServerError(error, request = {}) {
  if (config.isProduction) {
    console.error(`[backend] ${request.id ?? "-"} ${sanitizeLogMessage(error)}`);
    return;
  }
  console.error(error);
}

async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[backend] ${signal} received. Closing server...`);
  stopCleanupTimer();
  conversionQueue.cancelPending();
  server.close((error) => {
    if (error) console.error("[backend] Failed to close server cleanly.", error);
  });

  const forceExit = setTimeout(() => process.exit(1), 12_000);
  forceExit.unref?.();
  const idle = await conversionQueue.waitForIdle(5000);
  if (!idle) {
    conversionQueue.cancelActive();
    await conversionQueue.waitForIdle(3000);
  }
  await cleanupExpiredFiles().catch((error) => {
    console.warn(`[cleanup] shutdown failed: ${sanitizeLogMessage(error)}`);
  });
  closeAccountStore();
  process.exit(exitCode);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logServerError(reason);
});
process.on("uncaughtException", (error) => {
  logServerError(error);
  shutdown("uncaughtException", 1);
});

function sanitizeLogMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(config.downloadDir, "<download-dir>");
}
