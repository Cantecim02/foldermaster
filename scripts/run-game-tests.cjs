const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "game-tests");
try {
  fs.rmSync(outDir, { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    "--pretty", "false", "--module", "commonjs", "--target", "ES2020",
    "--moduleResolution", "node", "--skipLibCheck", "true", "--strict", "true",
    "--outDir", outDir, "src/game/fileBasketPhysics.ts", "src/game/fileBasketRules.ts", "tests/game.test.ts"
  ], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [path.join(outDir, "tests/game.test.js")], { cwd: root, stdio: "inherit" });
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
