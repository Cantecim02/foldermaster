import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const port = Number(process.env.SMOKE_PORT ?? 4017);
const baseUrl = `http://127.0.0.1:${port}`;
const tempDir = os.tmpdir();
const pdfPath = path.join(tempDir, "foldermaster-smoke.pdf");
const pngPath = path.join(tempDir, "foldermaster-smoke.png");
const smokeDownloadDir = path.join(tempDir, `foldermaster-smoke-downloads-${Date.now()}`);

const child = spawn(process.execPath, ["src/server.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: {
    ...process.env,
    PORT: String(port),
    PUBLIC_BASE_URL: baseUrl,
    DOWNLOAD_DIR: smokeDownloadDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await createFixtures();
  await waitForHealth();
  await assertPdfToUdf();
  await assertPdfToPng();
  await assertPdfCompression();
  await assertPngToWebp();
  await assertUnsupportedPair();
  console.log("Backend smoke tests passed.");
} finally {
  child.kill("SIGTERM");
  await rm(smokeDownloadDir, { recursive: true, force: true });
}

async function createFixtures() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 260]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("FolderMaster smoke test", {
    x: 40,
    y: 180,
    size: 20,
    font,
    color: rgb(0.1, 0.1, 0.1)
  });
  page.drawText("PDF conversion endpoint check", {
    x: 40,
    y: 145,
    size: 13,
    font
  });
  await writeFile(pdfPath, await pdf.save());

  await writeFile(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDGgAcICABMmAwnrQp3YAAAAAElFTkSuQmCC",
      "base64"
    )
  );
}

async function waitForHealth() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Backend did not become healthy. ${stderr}`.trim());
}

async function assertPdfToUdf() {
  const json = await upload(pdfPath, "application/pdf", "smoke.pdf", "udf");
  if (!json.fileUrl?.endsWith(".udf")) {
    throw new Error("PDF -> UDF did not return a UDF file.");
  }
}

async function assertPdfToPng() {
  const json = await upload(pdfPath, "application/pdf", "smoke.pdf", "png");
  if (!Array.isArray(json.files) || !json.files[0]?.fileUrl?.endsWith(".png")) {
    throw new Error("PDF -> PNG did not return PNG files.");
  }
}

async function assertPngToWebp() {
  const json = await upload(pngPath, "image/png", "smoke.png", "webp");
  if (!json.fileUrl?.endsWith(".webp")) {
    throw new Error("PNG -> WEBP did not return a WEBP file.");
  }
}

async function assertPdfCompression() {
  const form = new FormData();
  form.append("file", new Blob([await import("node:fs/promises").then((fs) => fs.readFile(pdfPath))], { type: "application/pdf" }), "smoke.pdf");
  const response = await fetch(`${baseUrl}/compress-pdf`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error(`PDF compression failed with ${response.status}: ${await response.text()}`);
  }
  const json = await response.json();
  if (!json.fileUrl?.endsWith(".pdf") || typeof json.originalBytes !== "number" || typeof json.compressedBytes !== "number") {
    throw new Error(`PDF compression returned invalid payload: ${JSON.stringify(json)}`);
  }
}

async function assertUnsupportedPair() {
  const response = await uploadRaw(pdfPath, "application/pdf", "smoke.pdf", "mp3");
  const body = await response.json();
  if (response.status !== 400 || body.error !== "Unsupported conversion pair.") {
    throw new Error(`Unsupported pair returned ${response.status}: ${JSON.stringify(body)}`);
  }
}

async function upload(filePath, type, filename, outputFormat) {
  const response = await uploadRaw(filePath, type, filename, outputFormat);
  if (!response.ok) {
    throw new Error(`Upload failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function uploadRaw(filePath, type, filename, outputFormat) {
  const form = new FormData();
  form.append("file", new Blob([await import("node:fs/promises").then((fs) => fs.readFile(filePath))], { type }), filename);
  form.append("outputFormat", outputFormat);
  return fetch(`${baseUrl}/convert-file`, {
    method: "POST",
    body: form
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
