const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "routing-tests");
const tsc = process.platform === "win32" ? "npx.cmd" : "npx";

try {
  fs.rmSync(outDir, { recursive: true, force: true });

  execFileSync(
    tsc,
    [
      "tsc",
      "--pretty",
      "false",
      "--module",
      "commonjs",
      "--target",
      "ES2020",
      "--moduleResolution",
      "node",
      "--esModuleInterop",
      "true",
      "--skipLibCheck",
      "true",
      "--strict",
      "true",
      "--noEmit",
      "false",
      "--outDir",
      outDir,
      "src/services/fileTypeDetector.ts",
      "src/services/fileRouter.ts",
      "src/services/diagnosticsDedup.ts",
      "src/types.ts",
      "tests/routing.test.ts"
    ],
    { cwd: root, stdio: "inherit" }
  );

  execFileSync("node", [path.join(outDir, "tests", "routing.test.js")], {
    cwd: root,
    stdio: "inherit"
  });
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
