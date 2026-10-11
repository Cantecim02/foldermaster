import Database from "better-sqlite3";
import path from "node:path";
import { open, unlink } from "node:fs/promises";
import { assertDatabaseHealthy, inspectAccountSchema, migrateAccountProfiles, PROFILE_MIGRATION_APPROVAL } from "./accountProfileMigration.js";
import { prepareAccountTables } from "./accountStoreSchema.js";

/** Offline only: all writers must be stopped. Startup never invokes this runner. */
export async function runAccountMigration(db, { approval, backupPath, makeUsername } = {}) {
  if (approval !== PROFILE_MIGRATION_APPROVAL) throw new Error("Explicit account-profile-v2 approval required");
  if (db.inTransaction) throw new Error("Migration cannot start inside a transaction");
  const state = inspectAccountSchema(db);
  if (state === "empty") throw new Error("Empty databases are initialized at startup; migration is unnecessary");
  assertDatabaseHealthy(db);
  if (!backupPath || !path.isAbsolute(backupPath) || path.resolve(backupPath) === path.resolve(db.name)) {
    throw new Error("A separate absolute backup path is required");
  }
  const version = db.pragma("data_version", { simple: true });
  const changes = db.prepare("SELECT total_changes() n").get().n;
  const checkUnchanged = () => {
    if (version !== db.pragma("data_version", { simple: true }) || changes !== db.prepare("SELECT total_changes() n").get().n) {
      throw new Error("Database changed during backup; stop all writers and retry with a new backup path");
    }
  };
  // Exclusive creation prevents accidental overwrite, symlink following, or replacing the source.
  const handle = await open(backupPath, "wx", 0o600);
  await handle.close();
  try {
    await db.backup(backupPath); // SQLite Online Backup API includes committed WAL pages.
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { assertDatabaseHealthy(backup); inspectAccountSchema(backup); } finally { backup.close(); }
  } catch (error) {
    await unlink(backupPath).catch(() => {});
    throw error;
  }
  // The write lock is acquired before checking for concurrent changes. Preparation
  // and profile rebuild then share one transaction, including rollback on failure.
  migrateAccountProfiles(db, makeUsername, { approval, prepare: () => prepareAccountTables(db), checkUnchanged });
  return { migrated: state === "legacy", backupVerified: true };
}
