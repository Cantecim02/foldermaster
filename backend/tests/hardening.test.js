import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { JobQueue } from "../src/services/jobQueue.js";
import { cleanupExpiredFiles, markActiveFile } from "../src/services/fileCleanupService.js";

const backendRoot = path.resolve(import.meta.dirname, "..");
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDGgAcICABMmAwnrQp3YAAAAAElFTkSuQmCC",
  "base64"
);

test("valid PDF content is accepted for PDF to UDF", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await uploadFile(baseUrl, "/convert-file", {
      field: "file",
      bytes: await makePdfBytes(),
      filename: "valid.pdf",
      type: "application/pdf",
      fields: { outputFormat: "udf" }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.filename, /\.udf$/);
  });
});

test("non-PDF content renamed to .pdf is rejected", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await uploadFile(baseUrl, "/convert-file", {
      field: "file",
      bytes: Buffer.from("not a real pdf"),
      filename: "renamed.pdf",
      type: "application/pdf",
      fields: { outputFormat: "udf" }
    });
    const body = await response.json();
    assert.equal(response.status, 415);
    assert.equal(body.success, false);
    assert.match(body.code, /UNSUPPORTED_FILE_TYPE|INVALID_FILE_CONTENT/);
    assert.equal("stack" in body, false);
  });
});

test("invalid image content is rejected before image-to-PDF conversion", async () => {
  await withServer(async ({ baseUrl }) => {
    const form = new FormData();
    form.append("files", new Blob([Buffer.from("not png")], { type: "image/png" }), "bad.png");
    const response = await fetch(`${baseUrl}/convert-images-to-pdf`, { method: "POST", body: form });
    const body = await response.json();
    assert.equal(response.status, 415);
    assert.equal(body.success, false);
  });
});

test("oversized upload returns 413", async () => {
  await withServer(async ({ baseUrl }) => {
    const bytes = Buffer.concat([tinyPng, Buffer.alloc(1024 * 1024 + 10)]);
    const response = await uploadFile(baseUrl, "/convert-file", {
      field: "file",
      bytes,
      filename: "large.png",
      type: "image/png",
      fields: { outputFormat: "webp" }
    });
    const body = await response.json();
    assert.equal(response.status, 413);
    assert.equal(body.code, "FILE_TOO_LARGE");
  }, { MAX_INPUT_MB: "1" });
});

test("too many uploaded files are rejected", async () => {
  await withServer(async ({ baseUrl }) => {
    const form = new FormData();
    for (let index = 0; index < 3; index += 1) {
      form.append("files", new Blob([tinyPng], { type: "image/png" }), `image-${index}.png`);
    }
    const response = await fetch(`${baseUrl}/convert-images-to-pdf`, { method: "POST", body: form });
    const body = await response.json();
    assert.equal(response.status, 413);
    assert.equal(body.code, "TOO_MANY_FILES");
  }, { MAX_FILES_PER_REQUEST: "2" });
});

test("failed conversions clean partial output files", async () => {
  await withServer(async ({ baseUrl, downloadDir }) => {
    const response = await uploadFile(baseUrl, "/convert-file", {
      field: "file",
      bytes: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32)]),
      filename: "broken.mp3",
      type: "audio/mpeg",
      fields: { outputFormat: "wav" }
    });
    assert.equal(response.status, 422);
    const files = await listFiles(downloadDir);
    assert.equal(files.some((name) => name.endsWith(".wav")), false);
    assert.equal(files.some((name) => name.startsWith("uploads/")), false);
  });
});

test("path traversal download attempts are rejected", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/files/%2e%2e%2f.env`);
    assert.equal(response.status, 400);
  });
});

test("expired files are deleted and active files are preserved", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "editio-cleanup-"));
  try {
    const expired = path.join(dir, "expired.pdf");
    const active = path.join(dir, "active.pdf");
    const recent = path.join(dir, "recent.pdf");
    await writeFile(expired, "old");
    await writeFile(active, "active");
    await writeFile(recent, "recent");
    const oldDate = new Date(Date.now() - 5000);
    await utimes(expired, oldDate, oldDate);
    await utimes(active, oldDate, oldDate);
    const release = markActiveFile(active);
    const now = Date.now();
    await cleanupExpiredFiles({ downloadDir: dir, ttlMs: 1000, now, logger: () => {} });
    assert.equal(await exists(expired), false);
    assert.equal(await exists(active), true);
    assert.equal(await exists(recent), true);
    release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrency slots release after success, failure, and capacity overflow", async () => {
  const queue = new JobQueue({ maxConcurrentJobs: 1, maxPendingJobs: 0 });
  assert.equal(await queue.run(async () => "ok"), "ok");
  await assert.rejects(() => queue.run(async () => { throw new Error("boom"); }), /boom/);

  let release;
  const blocker = queue.run(() => new Promise((resolve) => {
    release = () => resolve("done");
  }));
  await assert.rejects(
    () => queue.run(async () => "overflow"),
    (error) => error.status === 503 && error.code === "SERVER_BUSY"
  );
  release();
  assert.equal(await blocker, "done");
  assert.equal(await queue.run(async () => "free"), "free");
});

test("production startup rejects plain HTTP, localhost, and private LAN public URLs", async () => {
  await assertRejectsProductionBaseUrl("http://api.example.com");
  await assertRejectsProductionBaseUrl("https://localhost");
  await assertRejectsProductionBaseUrl("https://192.168.1.10");
});

test("production error responses do not expose stack traces", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await uploadFile(baseUrl, "/convert-file", {
      field: "file",
      bytes: Buffer.from("not a real pdf"),
      filename: "renamed.pdf",
      type: "application/pdf",
      fields: { outputFormat: "udf" }
    });
    const body = await response.json();
    assert.equal(response.status, 415);
    assert.equal("stack" in body, false);
    assert.equal("details" in body, false);
  }, { NODE_ENV: "production", PUBLIC_BASE_URL: "https://api.example.com" });
});

test("aborted multipart uploads do not leave temporary files", async () => {
  await withServer(async ({ port, downloadDir }) => {
    await new Promise((resolve) => {
      const boundary = "editio-abort-boundary";
      const request = http.request({
        method: "POST",
        host: "127.0.0.1",
        port,
        path: "/convert-file",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }
      });
      request.on("error", () => resolve());
      request.write(`--${boundary}\r\n`);
      request.write('Content-Disposition: form-data; name="file"; filename="partial.mp4"\r\n');
      request.write("Content-Type: video/mp4\r\n\r\n");
      request.write(Buffer.alloc(64 * 1024));
      request.destroy();
      setTimeout(resolve, 400);
    });
    await delay(700);
    const files = await listFiles(path.join(downloadDir, "uploads"));
    assert.equal(files.length, 0);
  });
});

async function withServer(fn, env = {}) {
  const port = 4300 + Math.floor(Math.random() * 1000);
  const downloadDir = await mkdtemp(path.join(os.tmpdir(), "editio-backend-"));
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      DOWNLOAD_DIR: downloadDir,
      MAX_INPUT_MB: "1",
      MAX_FILES_PER_REQUEST: "10",
      MAX_CONCURRENT_JOBS: "2",
      MAX_PENDING_JOBS: "2",
      JOB_TTL_MINUTES: "5",
      ...env
    },
    stdio: ["ignore", "ignore", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth(port, () => stderr);
    await fn({ baseUrl: `http://127.0.0.1:${port}`, port, downloadDir });
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(3000)]);
    await rm(downloadDir, { recursive: true, force: true });
  }
}

async function waitForHealth(port, getStderr) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`server did not become healthy: ${typeof getStderr === "function" ? getStderr() : getStderr}`);
}

async function uploadFile(baseUrl, endpoint, { field, bytes, filename, type, fields }) {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), filename);
  for (const [key, value] of Object.entries(fields ?? {})) {
    form.append(key, value);
  }
  return fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form });
}

async function makePdfBytes() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Editio hardening test", { x: 32, y: 120, size: 16, font });
  return Buffer.from(await pdf.save());
}

async function assertRejectsProductionBaseUrl(publicBaseUrl) {
  const downloadDir = await mkdtemp(path.join(os.tmpdir(), "editio-reject-"));
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(5200 + Math.floor(Math.random() * 1000)),
      PUBLIC_BASE_URL: publicBaseUrl,
      DOWNLOAD_DIR: downloadDir
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  try {
    const [code] = await Promise.race([
      once(child, "exit"),
      delay(3000).then(() => {
        child.kill("SIGTERM");
        return [0];
      })
    ]);
    assert.notEqual(code, 0);
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
}

async function listFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        for (const child of await listFiles(path.join(dir, entry.name))) files.push(`${entry.name}/${child}`);
      } else {
        files.push(entry.name);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
