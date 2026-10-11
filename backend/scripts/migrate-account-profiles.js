import Database from "better-sqlite3";
import path from "node:path";
import { runAccountMigration } from "../src/services/accountMigrationRunner.js";

const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!["--database", "--backup", "--approve"].includes(key) || !args[i + 1] || options[key]) {
    throw new Error("Usage: --database ABSOLUTE_PATH --backup NEW_ABSOLUTE_PATH --approve account-profile-v2 (all writers stopped)");
  }
  options[key] = args[i + 1];
}
if (!options["--database"] || !path.isAbsolute(options["--database"])) throw new Error("An explicit absolute database path is required; no default database is opened");
const db = new Database(options["--database"], { fileMustExist: true });
try {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const result = await runAccountMigration(db, { approval: options["--approve"], backupPath: options["--backup"] });
  console.log(JSON.stringify(result)); // Never print account data or credentials.
} finally { db.close(); }
