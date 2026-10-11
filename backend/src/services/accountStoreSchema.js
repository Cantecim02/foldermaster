import { randomUUID } from "node:crypto";

export const LEGACY_SQL = `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      birth_date TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      app_account_token TEXT UNIQUE,
      subscription_status TEXT NOT NULL DEFAULT 'free',
      subscription_expire_date TEXT,
      terms_version TEXT NOT NULL,
      privacy_version TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`;
export const PROFILE_SQL = `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT, last_name TEXT, birth_date TEXT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
      app_account_token TEXT UNIQUE, subscription_status TEXT NOT NULL DEFAULT 'free', subscription_expire_date TEXT,
      terms_version TEXT NOT NULL, privacy_version TEXT NOT NULL, accepted_at TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      age_attested_at TEXT, age_attested_minimum INTEGER,
      age_attestation_source TEXT CHECK(age_attestation_source IN ('declaration', 'legacy_birth_date'))
    );`;

// Called only inside the caller's schema transaction.
export function prepareAccountTables(db) {
    db.exec(`
    ${PROFILE_SQL}

    CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS account_sessions_user_id_idx
      ON account_sessions(user_id);
    CREATE INDEX IF NOT EXISTS account_sessions_expires_at_idx
      ON account_sessions(expires_at);
    `);

    ensureColumn(db, "users", "subscription_status", "TEXT NOT NULL DEFAULT 'free'");
    ensureColumn(db, "users", "subscription_expire_date", "TEXT");
    ensureColumn(db, "users", "app_account_token", "TEXT");
    const usersWithoutAppAccountToken = db.prepare(
      "SELECT id FROM users WHERE app_account_token IS NULL OR app_account_token = ''"
    ).all();
    const updateAppAccountToken = db.prepare("UPDATE users SET app_account_token = ? WHERE id = ?");
    for (const row of usersWithoutAppAccountToken) updateAppAccountToken.run(randomUUID(), row.id);
    db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_app_account_token_idx
      ON users(app_account_token)
      WHERE app_account_token IS NOT NULL;
    `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS conversion_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      input_format TEXT NOT NULL,
      output_format TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS conversion_history_user_created_idx
      ON conversion_history(user_id, created_at DESC);
    `);
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
