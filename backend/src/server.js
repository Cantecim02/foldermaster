import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { mkdir } from "node:fs/promises";
import { config } from "./config.js";
import { mediaRoutes } from "./routes/mediaRoutes.js";
import { cleanupJobs } from "./services/jobStore.js";
import { HttpError } from "./utils/httpError.js";

await mkdir(config.downloadDir, { recursive: true });

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin(origin, callback) {
      const isLocalNetworkOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(origin ?? "");
      if (!origin || config.allowedOrigins.includes(origin) || isLocalNetworkOrigin) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, "Origin not allowed."));
    }
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use("/", mediaRoutes);

app.use((error, _request, response, _next) => {
  if (error?.name === "ZodError") {
    response.status(400).json({ error: "Invalid request.", details: error.issues });
    return;
  }

  const status = error?.status ?? 500;
  if (status >= 500) {
    console.error(error);
  }
  response.status(status).json({
    error: error instanceof Error ? error.message : "Unexpected server error."
  });
});

setInterval(cleanupJobs, 10 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`Media backend listening on ${config.publicBaseUrl}`);
});
