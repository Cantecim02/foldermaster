const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(path.join(root, "src/services/archiveService.ts"), "utf8");
const nativeModule = fs.readFileSync(
  path.join(root, "modules/editio-archive-extractor/ios/EditioArchiveExtractorModule.swift"),
  "utf8"
);
const nativeService = fs.readFileSync(
  path.join(root, "modules/editio-archive-extractor/ios/NativeZipExtractionService.swift"),
  "utf8"
);

assert.match(service, /Platform\.OS === "ios"[\s\S]*extractZipOnIOS/);
assert.doesNotMatch(
  service.match(/async function extractZipOnIOS[\s\S]*?\n}/)?.[0] ?? "",
  /Base64|ArrayBuffer|Uint8Array|JSZip|readAsStringAsync|writeAsStringAsync/
);
assert.match(nativeModule, /promise\.reject\(/);
assert.match(nativeModule, /EditioExecuteAndCaptureObjectiveCException/);
assert.match(nativeService, /DispatchQueue|extractionBufferBytes|minimumFreeDiskReserveBytes/);
assert.match(nativeService, /EditioArchiveExtractions/);

const result = spawnSync(
  "swift",
  ["test", "--package-path", path.join(root, "modules/editio-archive-extractor")],
  { cwd: root, encoding: "utf8", stdio: "pipe" }
);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

console.log("Archive bridge contract and native extraction tests passed.");
