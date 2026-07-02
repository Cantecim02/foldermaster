import { cleanupExpiredFiles } from "../src/services/fileCleanupService.js";

const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";

const deleted = await cleanupExpiredFiles({ dryRun });
console.log(`${dryRun ? "Dry run complete" : "Cleanup complete"}: ${deleted.length} expired file(s) ${dryRun ? "matched" : "deleted"}.`);
