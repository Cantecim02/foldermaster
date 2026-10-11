import { randomBytes } from "node:crypto";
import { LEGACY_SQL, PROFILE_SQL } from "./accountStoreSchema.js";

export const PROFILE_MIGRATION_APPROVAL = "account-profile-v2";
function normalizedSql(sql) {
  const ddl = sql.replace(/^(\s*CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s+)IF\s+NOT\s+EXISTS\s+/i, "$1").replace(/;\s*$/, "");
  // Ignore formatting, but retain literal values and unusual quoted identifiers.
  const tokens = ddl.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g) ?? [];
  return tokens.map(token => {
    if (token.startsWith("'")) return token;
    if (/^["`\[]/.test(token) && /^[A-Za-z_][A-Za-z_0-9]*$/.test(token.slice(1, -1))) return token.slice(1, -1).toLowerCase();
    return token.toLowerCase();
  }).join(" ");
}

// Compare the complete known DDL, including CHECK/UNIQUE/COLLATE constraints.
// Similar columns are not proof that a custom schema is safe to rebuild.
export function inspectAccountSchema(db) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('view', 'trigger')").get()) {
    throw new Error("Custom VIEW/TRIGGER; manual migration review required");
  }
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!table) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()) {
      throw new Error("Unknown nonempty account schema; manual migration review required");
    }
    return "empty";
  }
  const sql = normalizedSql(table.sql);
  const state = sql === normalizedSql(PROFILE_SQL) ? "ready" : sql === normalizedSql(LEGACY_SQL) ? "legacy" : null;
  if (!state) throw new Error("Unknown account DDL/constraints; manual migration review required");
  const allowedIndexes = {
    users_username_idx: "CREATE UNIQUE INDEX users_username_idx ON users(username)",
    users_app_account_token_idx: "CREATE UNIQUE INDEX users_app_account_token_idx ON users(app_account_token) WHERE app_account_token IS NOT NULL"
  };
  for (const index of db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL").all()) {
    if (!allowedIndexes[index.name] || normalizedSql(index.sql) !== normalizedSql(allowedIndexes[index.name])) {
      throw new Error("Custom account INDEX; manual migration review required");
    }
  }
  return state;
}

export function assertDatabaseHealthy(db) {
  const integrity = db.pragma("integrity_check");
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("SQLite integrity_check failed");
  if (db.pragma("foreign_key_check").length) throw new Error("SQLite foreign_key_check failed");
}

export const generateUsername = () => `user-${randomBytes(16).toString("hex")}`;
const profileColumns = ["id", "first_name", "last_name", "birth_date", "email", "password_hash", "app_account_token",
  "subscription_status", "subscription_expire_date", "terms_version", "privacy_version", "accepted_at", "created_at", "updated_at",
  "username", "age_attested_at", "age_attested_minimum", "age_attestation_source"];

export function insertProfile(db, user, makeUsername = generateUsername) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const username = makeUsername();
    if (!/^user-[a-f0-9]{32}$/.test(username)) throw new Error("Invalid generated username");
    try {
      db.prepare(`INSERT INTO users (${profileColumns.join(", ")}) VALUES (
        @id, @firstName, @lastName, @birthDate, @email, @passwordHash, @appAccountToken,
        'free', NULL, @termsVersion, @privacyVersion, @acceptedAt, @createdAt, @updatedAt,
        @username, @ageAttestedAt, @ageAttestedMinimum, @ageAttestationSource
      )`).run({ ...user, username });
      return username;
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE" && error.message === "UNIQUE constraint failed: users.username") continue;
      throw error;
    }
  }
  throw new Error("Username allocation failed");
}

/** SQLite table rebuild: preserve IDs and child rows; never purge birth dates here. */
export function migrateAccountProfiles(db, makeUsername = generateUsername, { approval, prepare = () => {}, checkUnchanged = () => {} } = {}) {
  const state = inspectAccountSchema(db);
  assertDatabaseHealthy(db);
  if (state !== "ready" && approval !== PROFILE_MIGRATION_APPROVAL) throw new Error("Explicit account profile migration approval required");
  if (state === "empty") throw new Error("Empty account schema cannot be rebuilt");
  const columns = db.prepare("PRAGMA table_info(users)").all();
  if (state === "ready") {
    db.transaction(() => {
      checkUnchanged();
      inspectAccountSchema(db);
      prepare();
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username)");
      assertDatabaseHealthy(db);
    }).immediate();
    return;
  }
  const foreignKeys = db.pragma("foreign_keys", { simple: true });
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      checkUnchanged();
      inspectAccountSchema(db);
      assertDatabaseHealthy(db);
      prepare();
      db.exec(PROFILE_SQL.replace("IF NOT EXISTS users", "users_profile_v2"));
      const available = new Set(columns.map(column => column.name));
      const copyColumns = profileColumns.filter(name => name !== "username" && available.has(name));
      // Only identifiers and migration metadata are read into JS; PII stays in SQL.
      const rows = db.prepare("SELECT id" + (available.has("username") ? ", username" : "") + " FROM users").all();
      const copy = db.prepare(`INSERT INTO users_profile_v2 (${copyColumns.join(", ")}, username)
        SELECT ${copyColumns.join(", ")}, ? FROM users WHERE id = ?`);
      for (const row of rows) {
        let copied = false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const username = attempt === 0 && row.username ? row.username : makeUsername();
          if (!/^user-[a-f0-9]{32}$/.test(username)) throw new Error("Invalid generated username");
          try { copy.run(username, row.id); copied = true; break; }
          catch (error) {
            if (error.code !== "SQLITE_CONSTRAINT_UNIQUE" || error.message !== "UNIQUE constraint failed: users_profile_v2.username") throw error;
          }
        }
        if (!copied) throw new Error("Username migration failed");
      }
      db.exec(`DROP TABLE users; ALTER TABLE users_profile_v2 RENAME TO users;
        CREATE UNIQUE INDEX users_username_idx ON users(username);
        CREATE UNIQUE INDEX users_app_account_token_idx ON users(app_account_token) WHERE app_account_token IS NOT NULL;`);
      assertDatabaseHealthy(db);
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
}
