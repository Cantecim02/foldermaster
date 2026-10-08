import test from "node:test";
import express from "express";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { HttpError } from "../src/utils/httpError.js";
import { mediaRoutes } from "../src/routes/mediaRoutes.js";
import { conversionQueue } from "../src/services/conversionJobQueue.js";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { EventEmitter, once } from "node:events";
import childProcess from "node:child_process";
import { convertUploadedFile } from "../src/services/uploadConvertService.js";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { JobQueue } from "../src/services/jobQueue.js";
import { createOperationTracker, isActiveFile, cleanupExpiredFiles, markActiveFile } from "../src/services/fileCleanupService.js";

const backendRoot = path.resolve(import.meta.dirname, "..");
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDGgAcICABMmAwnrQp3YAAAAAElFTkSuQmCC",
  "base64"
);

test("support request is delivered through the configured mail transport", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/support/requests`, {
      method: "POST",
      body: makeSupportForm()
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(typeof body.requestId, "string");
  }, {
    SMTP_JSON_TRANSPORT: "true",
    SUPPORT_TO_EMAIL: "editioapp@gmail.com"
  });
});

test("support request accepts a validated image attachment", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await uploadFile(baseUrl, "/support/requests", {
      field: "attachment",
      bytes: tinyPng,
      filename: "support-screen.png",
      type: "image/png",
      fields: supportFields()
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.success, true);
  }, {
    SMTP_JSON_TRANSPORT: "true",
    SUPPORT_TO_EMAIL: "editioapp@gmail.com"
  });
});

test("support request rejects attachment content that does not match its extension", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await uploadFile(baseUrl, "/support/requests", {
      field: "attachment",
      bytes: Buffer.from("not a real image"),
      filename: "fake.png",
      type: "image/png",
      fields: supportFields()
    });
    const body = await response.json();
    assert.equal(response.status, 415);
    assert.equal(body.code, "INVALID_ATTACHMENT_CONTENT");
  }, {
    SMTP_JSON_TRANSPORT: "true"
  });
});

test("support request enforces its attachment size limit", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await uploadFile(baseUrl, "/support/requests", {
      field: "attachment",
      bytes: Buffer.alloc(1024 * 1024 + 1, 65),
      filename: "oversized.txt",
      type: "text/plain",
      fields: supportFields()
    });
    const body = await response.json();
    assert.equal(response.status, 413);
    assert.equal(body.code, "FILE_TOO_LARGE");
  }, {
    SMTP_JSON_TRANSPORT: "true",
    SUPPORT_MAX_ATTACHMENT_MB: "1"
  });
});

test("support request reports unavailable mail configuration without exposing details", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/support/requests`, {
      method: "POST",
      body: makeSupportForm()
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "SUPPORT_UNAVAILABLE");
    assert.equal("stack" in body, false);
  }, {
    SMTP_JSON_TRANSPORT: "false",
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: ""
  });
});

test("valid PDF content is accepted for PDF to UDF", async () => {
  await withServer(async ({ baseUrl, downloadDir }) => {
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
    assert.equal((await fetch(`${baseUrl}/files/${body.filename}`)).status, 200);
  });
});

test("non-PDF content renamed to .pdf is rejected", async () => {
  await withServer(async ({ baseUrl, downloadDir }) => {
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
    assert.equal((await listFiles(downloadDir)).some((name) => name.startsWith("uploads/")), false);
  });
});

test("invalid image content is rejected before image-to-PDF conversion", async () => {
  await withServer(async ({ baseUrl, downloadDir }) => {
    const form = new FormData();
    form.append("files", new Blob([Buffer.from("not png")], { type: "image/png" }), "bad.png");
    const response = await fetch(`${baseUrl}/convert-images-to-pdf`, { method: "POST", body: form });
    const body = await response.json();
    assert.equal(response.status, 415);
    assert.equal(body.success, false);
    assert.equal((await listFiles(downloadDir)).some((name) => name.startsWith("uploads/")), false);
  });
});

test("invalid PDF compression preset is rejected", async () => {
  await withServer(async ({ baseUrl, downloadDir }) => {
    const response = await uploadFile(baseUrl, "/compress-pdf", {
      field: "file",
      bytes: await makePdfBytes(),
      filename: "valid.pdf",
      type: "application/pdf",
      fields: { compressionPreset: "extreme" }
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal((await listFiles(downloadDir)).some((name) => name.startsWith("uploads/")), false);
  });
});

test("valid PDF compression preset is applied", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await uploadFile(baseUrl, "/compress-pdf", {
      field: "file",
      bytes: await makePdfBytes(),
      filename: "valid.pdf",
      type: "application/pdf",
      fields: { compressionPreset: "small" }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.compressionPreset, "small");
    assert.match(body.filename, /\.pdf$/);
  });
});

test("oversized upload returns 413", async () => {
  await withServer(async ({ baseUrl, downloadDir }) => {
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
    assert.equal((await listFiles(downloadDir)).some((name) => name.startsWith("uploads/")), false);
  }, { MAX_INPUT_MB: "1" });
});

test("too many uploaded files are rejected", async () => {
  await withServer(async ({ baseUrl, downloadDir }) => {
    const form = new FormData();
    for (let index = 0; index < 3; index += 1) {
      form.append("files", new Blob([tinyPng], { type: "image/png" }), `image-${index}.png`);
    }
    const response = await fetch(`${baseUrl}/convert-images-to-pdf`, { method: "POST", body: form });
    const body = await response.json();
    assert.equal(response.status, 413);
    assert.equal(body.code, "TOO_MANY_FILES");
    assert.equal((await listFiles(downloadDir)).some((name) => name.startsWith("uploads/")), false);
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

for (const mode of ["cancelled", "queue-error", "cleanup-error"]) {
  test(`${mode}: error middleware waits for upload cleanup without masking the error`, async (t) => {
    const removalStarted = Promise.withResolvers();
    const allowRemoval = Promise.withResolvers();
    const originalRm = fsPromises.rm;
    let input;
    let errorHandled = false;
    const app = express();
    app.use(mediaRoutes);
    app.use((error, _request, response, _next) => {
      errorHandled = true;
      response.status(error.status ?? 500).json({ code: error.code });
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.mock.method(conversionQueue, "run", (task) => mode === "queue-error"
      ? Promise.reject(new HttpError(503, "Queue is full.", { code: "SERVER_BUSY" }))
      : task({ signal: AbortSignal.abort() }));
    t.mock.method(fsPromises, "rm", async (target, options) => {
      if (String(target).includes(`${path.sep}uploads${path.sep}`)) {
        input = target;
        removalStarted.resolve();
        await allowRemoval.promise;
        if (mode === "cleanup-error") throw Object.assign(new Error("denied"), { code: "EACCES" });
      }
      return originalRm(target, options);
    });
    syncBuiltinESMExports();
    let responsePromise;
    try {
      responsePromise = uploadFile(`http://127.0.0.1:${server.address().port}`, "/convert-file", {
        field: "file", bytes: tinyPng, filename: "image.png", type: "image/png",
        fields: { outputFormat: "webp" }
      });
      await removalStarted.promise;
      assert.equal(errorHandled, false);
      assert.equal(await exists(input), true);
      allowRemoval.resolve();
      const response = await responsePromise;
      assert.equal(response.status, mode === "queue-error" ? 503 : 499);
      assert.equal((await response.json()).code, mode === "queue-error" ? "SERVER_BUSY" : "REQUEST_CANCELLED");
      assert.equal(await exists(input), mode === "cleanup-error");
      assert.equal(isActiveFile(input), false);
    } finally {
      allowRemoval.resolve();
      await responsePromise;
      t.mock.restoreAll();
      syncBuiltinESMExports();
      if (input) await originalRm(input, { force: true });
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

test("client disconnect cancels the queued request and cleans its upload", async (t) => {
  const started = Promise.withResolvers();
  const cleaned = Promise.withResolvers();
  const finished = Promise.withResolvers();
  const originalRm = fsPromises.rm;
  const client = new AbortController();
  let input;
  const app = express();
  app.use(mediaRoutes);
  app.use((_error, _request, response, _next) => {
    finished.resolve();
    response.status(499).end();
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.mock.method(conversionQueue, "run", (_task, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new HttpError(499, "cancelled", { code: "REQUEST_CANCELLED" })), { once: true });
    started.resolve();
  }));
  t.mock.method(fsPromises, "rm", async (target, options) => {
    const result = await originalRm(target, options);
    if (String(target).includes(`${path.sep}uploads${path.sep}`)) {
      input = target;
      cleaned.resolve();
    }
    return result;
  });
  syncBuiltinESMExports();
  const form = new FormData();
  form.append("file", new Blob([tinyPng], { type: "image/png" }), "image.png");
  form.append("outputFormat", "webp");
  const response = fetch(`http://127.0.0.1:${server.address().port}/convert-file`, {
    method: "POST", body: form, signal: client.signal
  });
  const rejected = assert.rejects(response, (error) => error.name === "AbortError");
  try {
    await started.promise;
    client.abort();
    await rejected;
    await cleaned.promise;
    await finished.promise;
    assert.equal(await exists(input), false);
    assert.equal(isActiveFile(input), false);
  } finally {
    client.abort();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("FFmpeg cancellation waits for process close before cleanup", async (t) => {
  const tracker = createOperationTracker();
  const controller = new AbortController();
  const spawned = Promise.withResolvers();
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  const killSignals = [];
  child.kill = (signal) => { killSignals.push(signal); return true; };
  let output;
  let settled = false;
  t.mock.method(childProcess, "spawn", (_engine, args) => {
    output = args.at(-1);
    spawned.resolve();
    return child;
  });
  syncBuiltinESMExports();
  const conversion = convertUploadedFile({
    file: { path: "unused.mp3", originalname: "sound.mp3", detectedKind: "mp3" },
    outputFormat: "wav", context: { signal: controller.signal, tracker }
  });
  const checked = assert.rejects(conversion, (error) => error.code === "REQUEST_CANCELLED");
  conversion.then(() => { settled = true; }, () => { settled = true; });
  try {
    await spawned.promise;
    await writeFile(output, "partial");
    controller.abort();
    await Promise.resolve();
    assert.deepEqual(killSignals, ["SIGTERM"]);
    assert.equal(settled, false);
    assert.equal(await exists(output), true);
    child.emit("close", null);
    await checked;
    await tracker.close();
    assert.equal(await exists(output), false);
    assert.equal(isActiveFile(output), false);
  } finally {
    child.emit("close", null);
    await checked;
    await tracker.close();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("tracker removes owned active outputs and shares concurrent close completion", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "editio-tracker-"));
  try {
    const tracker = createOperationTracker();
    const output = tracker.trackOutput(path.join(dir, "partial.wav"));
    await writeFile(output, "partial");
    assert.equal(isActiveFile(output), true);
    const closing = tracker.close();
    assert.equal(tracker.close(), closing);
    await closing;
    assert.equal(await exists(output), false);
    assert.equal(isActiveFile(output), false);
    await tracker.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tracker retains successful outputs and releases records after filesystem failure", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "editio-tracker-"));
  try {
    const successful = createOperationTracker();
    const output = successful.trackOutput(path.join(dir, "final.pdf"));
    await writeFile(output, "final");
    await successful.close({ keepOutputs: true });
    assert.equal(await exists(output), true);
    assert.equal(isActiveFile(output), false);
    const failing = createOperationTracker();
    // rm without recursive cannot remove a directory on either Windows or Unix.
    failing.trackOutput(dir);
    await failing.close();
    assert.equal(isActiveFile(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test("production defaults to loopback and development defaults to LAN binding", async () => {
  await withBindHostConfig((readConfig) => {
    assert.equal(readConfig("production").stdout.trim(), "127.0.0.1");
    assert.equal(readConfig("development").stdout.trim(), "0.0.0.0");
  });
});

test("BIND_HOST overrides accept IPv4, IPv6, and valid hostnames", async () => {
  await withBindHostConfig((readConfig) => {
    for (const mode of ["production", "development"]) {
      for (const host of ["127.0.0.1", "0.0.0.0", "::1", "::", "::ffff:127.0.0.1", "localhost", "api-1.example.com", "localhost."]) {
        const result = readConfig(mode, host);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), host);
      }
    }
  });
});

test("BIND_HOST rejects empty values, malformed hosts, URLs, and ports", async () => {
  await withBindHostConfig((readConfig) => {
    for (const host of ["", " ", " 127.0.0.1 ", "http://localhost", "localhost:4000", "[::1]", "[::1]:4000", "999.1.1.1", "127.1", "-host", "host-", "bad_host", "a..b", "*", "host/path", "host\nname", "host\n", "a".repeat(64), `${"a.".repeat(127)}a`]) {
      const result = readConfig("production", host);
      assert.notEqual(result.status, 0, `Accepted invalid BIND_HOST: ${JSON.stringify(host)}`);
      assert.match(result.stderr, /BIND_HOST must be a valid/);
    }
  });
});

test("backend starts with an explicit loopback bind override", async () => {
  await withServer(async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  }, { BIND_HOST: "127.0.0.1" });
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
      DATABASE_PATH: path.join(downloadDir, "editio-test.sqlite"),
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

function makeSupportForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries(supportFields())) form.append(key, value);
  return form;
}

function supportFields() {
  return {
    fullName: "Editio Test User",
    email: "test@example.com",
    subject: "Conversion support request",
    description: "The conversion stopped while preparing the selected document."
  };
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
      DOWNLOAD_DIR: downloadDir,
      DATABASE_PATH: path.join(downloadDir, "editio-test.sqlite")
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

async function withBindHostConfig(run) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "editio-bind-config-"));
  const configUrl = pathToFileURL(path.join(backendRoot, "src/config.js")).href;
  try {
    run((mode, host) => {
      const env = {
        ...process.env,
        NODE_ENV: mode,
        PUBLIC_BASE_URL: "https://api.example.com",
        MONETIZATION_ENABLED: "false"
      };
      delete env.BIND_HOST;
      if (host !== undefined) env.BIND_HOST = host;
      return spawnSync(process.execPath, [
        "--input-type=module", "--eval",
        `import { config } from ${JSON.stringify(configUrl)}; console.log(config.bindHost);`
      ], { cwd, env, encoding: "utf8" });
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
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
