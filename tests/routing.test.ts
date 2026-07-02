import { createDiagnosticEventKey, dedupeDiagnosticEntries, isMetroConnectivityWarning } from "../src/services/diagnosticsDedup";
import { detectFileTypeInfo, fileTypeFromDetection } from "../src/services/fileTypeDetector";
import { canExtractArchive, routeFileForOperation } from "../src/services/fileRouter";
import { AppFile } from "../src/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function file(name: string, mimeType?: string | null, signatureBytes?: number[]): AppFile & { signatureBytes?: number[] } {
  return {
    name,
    uri: `file:///tmp/${name}`,
    mimeType,
    size: 128,
    signatureBytes
  };
}

function assertRouteBlocked(name: string, mimeType?: string | null) {
  const route = routeFileForOperation(file(name, mimeType), "archive.extract");
  assert(!route.canStart, `${name} must not be extractable`);
  assert(route.destinationModule !== "archive" || route.reason !== undefined, `${name} must include a block reason`);
}

const pdf = file("contract.jpg", "application/pdf");
const pdfDetection = detectFileTypeInfo(pdf);
assert(pdfDetection.category === "pdf", "MIME must win over misleading extension");
assert(fileTypeFromDetection(pdfDetection) === "pdf", "PDF MIME should produce pdf FileType");
assertRouteBlocked("document.pdf", "application/pdf");
assertRouteBlocked("photo.jpg", "image/jpeg");
assertRouteBlocked("render.png", "image/png");

const zipRoute = routeFileForOperation(file("EXPORT.ZIP", null), "archive.extract");
assert(zipRoute.canStart, "ZIP should be extractable by extension");
assert(canExtractArchive(file("bundle.tar", "application/x-tar")), "TAR should be extractable");
assert(canExtractArchive(file("download", "application/zip")), "ZIP should be extractable by MIME without extension");

const rarRoute = routeFileForOperation(file("legacy.rar", "application/vnd.rar"), "archive.extract");
assert(!rarRoute.canStart, "RAR should not be extracted without native support");
assert(rarRoute.reason === "native-required", "RAR should report native-required");

const gzRoute = routeFileForOperation(file("bundle.tgz", "application/gzip"), "archive.extract");
assert(!gzRoute.canStart, "GZIP/TGZ should be blocked for extraction");
assert(gzRoute.reason === "unsupported-archive-format", "GZIP/TGZ should report unsupported archive format");

const signatureZip = detectFileTypeInfo(file("unknown.bin", null, [0x50, 0x4b, 0x03, 0x04]));
assert(signatureZip.category === "archive", "ZIP magic bytes should be detected");
assert(signatureZip.source === "signature", "magic-byte detection should report signature source");
assert(canExtractArchive(file("unknown.bin", null, [0x50, 0x4b, 0x03, 0x04])), "ZIP should be extractable by magic bytes");

const firstEntry = {
  id: "a",
  level: "warn",
  source: "console.warn",
  message: "Cannot connect to Metro at URL: 192.168.1.10:8081",
  details: "GET http://192.168.1.10:8081/index.bundle failed",
  createdAt: "2026-06-29T18:22:37.507Z"
};
const secondEntry = {
  ...firstEntry,
  id: "b",
  details: "GET http://192.168.1.10:8081/index.bundle failed"
};
assert(isMetroConnectivityWarning(firstEntry.message), "Metro connectivity warnings should be classified");
assert(createDiagnosticEventKey(firstEntry) === createDiagnosticEventKey(secondEntry), "Equivalent warnings should share a dedupe key");
assert(dedupeDiagnosticEntries([firstEntry, secondEntry], 20).length === 1, "Duplicate diagnostics should be collapsed");

console.log("routing tests passed");
