import argon2 from "argon2";
import Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";

const passwordHashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
};

let database;
let dummyPasswordHash;

export async function initializeAccountStore() {
  if (database) return;

  await mkdir(path.dirname(config.databasePath), { recursive: true });
  database = new Database(config.databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  const migrate = database.transaction(() => {
    database.exec(`
    CREATE TABLE IF NOT EXISTS users (
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
    );

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

    ensureColumn(database, "users", "subscription_status", "TEXT NOT NULL DEFAULT 'free'");
    ensureColumn(database, "users", "subscription_expire_date", "TEXT");
    ensureColumn(database, "users", "app_account_token", "TEXT");
    const usersWithoutAppAccountToken = database.prepare(
      "SELECT id FROM users WHERE app_account_token IS NULL OR app_account_token = ''"
    ).all();
    const updateAppAccountToken = database.prepare("UPDATE users SET app_account_token = ? WHERE id = ?");
    for (const row of usersWithoutAppAccountToken) updateAppAccountToken.run(randomUUID(), row.id);
    database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_app_account_token_idx
      ON users(app_account_token)
      WHERE app_account_token IS NOT NULL;
    `);
    database.exec(`
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
  });
  migrate.immediate();

  dummyPasswordHash = await argon2.hash(randomBytes(32), passwordHashOptions);
  deleteExpiredSessions();
}

export function closeAccountStore() {
  if (!database) return;
  database.close();
  database = undefined;
  dummyPasswordHash = undefined;
}

export async function registerAccount(input) {
  const db = requireDatabase();
  const email = normalizeEmail(input.email);
  const passwordHash = await argon2.hash(input.password, passwordHashOptions);
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    appAccountToken: randomUUID(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    birthDate: input.birthDate,
    email,
    termsVersion: config.termsVersion,
    privacyVersion: config.privacyVersion,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now
  };

  try {
    db.prepare(`
      INSERT INTO users (
        id, first_name, last_name, birth_date, email, password_hash,
        app_account_token, terms_version, privacy_version, accepted_at, created_at, updated_at
      ) VALUES (
        @id, @firstName, @lastName, @birthDate, @email, @passwordHash,
        @appAccountToken, @termsVersion, @privacyVersion, @acceptedAt, @createdAt, @updatedAt
      )
    `).run({ ...user, passwordHash });
  } catch (error) {
    if (String(error?.code).startsWith("SQLITE_CONSTRAINT")) {
      throw new HttpError(409, "An account already exists for this email address.", {
        code: "ACCOUNT_EXISTS"
      });
    }
    throw error;
  }

  return createAuthenticatedAccount(user);
}

export async function loginAccount({ email, password }) {
  const db = requireDatabase();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
  const passwordMatches = row
    ? await argon2.verify(row.password_hash, password)
    : await argon2.verify(dummyPasswordHash, password);

  if (!row || !passwordMatches) {
    throw new HttpError(401, "Email address or password is incorrect.", {
      code: "INVALID_CREDENTIALS"
    });
  }

  return createAuthenticatedAccount(mapUser(row));
}

export function authenticateRequest(request) {
  const token = readBearerToken(request.get("authorization"));
  if (!token) {
    throw new HttpError(401, "Authentication is required.", { code: "AUTH_REQUIRED" });
  }

  deleteExpiredSessions();
  const row = requireDatabase().prepare(`
    SELECT users.*, account_sessions.expires_at AS session_expires_at
    FROM account_sessions
    INNER JOIN users ON users.id = account_sessions.user_id
    WHERE account_sessions.token_hash = ?
  `).get(hashToken(token));

  if (!row || Date.parse(row.session_expires_at) <= Date.now()) {
    throw new HttpError(401, "Session has expired.", { code: "SESSION_EXPIRED" });
  }

  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: row.session_expires_at,
    user: mapUser(row)
  };
}

export function authenticateOptionalRequest(request) {
  const authorization = request.get("authorization");
  if (!authorization) return null;
  return authenticateRequest(request);
}

export function getAccountDatabase() {
  return requireDatabase();
}

export function getOrCreateAppAccountToken(userId) {
  const db = requireDatabase();
  const row = db.prepare("SELECT app_account_token FROM users WHERE id = ?").get(userId);
  if (!row) {
    throw new HttpError(404, "Account was not found.", { code: "ACCOUNT_NOT_FOUND" });
  }
  if (row.app_account_token) return row.app_account_token;
  const token = randomUUID();
  db.prepare("UPDATE users SET app_account_token = ?, updated_at = ? WHERE id = ?")
    .run(token, new Date().toISOString(), userId);
  return token;
}

export function logoutAccount(tokenHash) {
  requireDatabase().prepare("DELETE FROM account_sessions WHERE token_hash = ?").run(tokenHash);
}

export async function deleteAccount({ userId, password }) {
  const db = requireDatabase();
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
  if (!row || !(await argon2.verify(row.password_hash, password))) {
    throw new HttpError(401, "Password is incorrect.", { code: "INVALID_CREDENTIALS" });
  }

  db.transaction(() => {
    if (tableExists(db, "subscription_entitlements")) {
      db.prepare(`
        UPDATE subscription_entitlements
        SET user_id = NULL, updated_at = ?
        WHERE user_id = ?
      `).run(new Date().toISOString(), userId);
    }
    if (tableExists(db, "free_conversion_usage")) {
      db.prepare("DELETE FROM free_conversion_usage WHERE user_id = ?").run(userId);
    }
    if (tableExists(db, "conversion_usage_events")) {
      db.prepare(`
        UPDATE conversion_usage_events
        SET user_id = NULL
        WHERE user_id = ?
      `).run(userId);
    }
    db.prepare("DELETE FROM account_sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();
}

export function addConversionHistory({ userId, fileName, inputFormat, outputFormat, fileSizeBytes, status }) {
  const db = requireDatabase();
  const item = {
    id: randomUUID(),
    userId,
    fileName: fileName.trim(),
    inputFormat: inputFormat.toUpperCase(),
    outputFormat: outputFormat.toUpperCase(),
    fileSizeBytes,
    status,
    createdAt: new Date().toISOString()
  };

  db.transaction(() => {
    db.prepare(`
      INSERT INTO conversion_history (
        id, user_id, file_name, input_format, output_format,
        file_size_bytes, status, created_at
      ) VALUES (
        @id, @userId, @fileName, @inputFormat, @outputFormat,
        @fileSizeBytes, @status, @createdAt
      )
    `).run(item);
    db.prepare(`
      DELETE FROM conversion_history
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM conversion_history
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 200
        )
    `).run(userId, userId);
  })();

  return publicConversionHistoryItem(item);
}

export function listConversionHistory({ userId, limit = 30 }) {
  return requireDatabase().prepare(`
    SELECT id, file_name, input_format, output_format, file_size_bytes, status, created_at
    FROM conversion_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit).map(mapConversionHistoryItem);
}

function createAuthenticatedAccount(user) {
  deleteExpiredSessions();
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + config.authSessionDays * 24 * 60 * 60 * 1000);
  requireDatabase().prepare(`
    INSERT INTO account_sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), user.id, expiresAt.toISOString(), createdAt.toISOString());

  return {
    user: publicUser(user),
    session: {
      token,
      expiresAt: expiresAt.toISOString()
    }
  };
}

function publicUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    birthDate: user.birthDate,
    email: user.email,
    appAccountToken: user.appAccountToken,
    subscriptionStatus: user.subscriptionStatus ?? "free",
    subscriptionExpireDate: user.subscriptionExpireDate ?? null,
    termsVersion: user.termsVersion,
    privacyVersion: user.privacyVersion,
    acceptedAt: user.acceptedAt,
    createdAt: user.createdAt
  };
}

function mapUser(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    email: row.email,
    appAccountToken: row.app_account_token,
    subscriptionStatus: row.subscription_status ?? "free",
    subscriptionExpireDate: row.subscription_expire_date ?? null,
    termsVersion: row.terms_version,
    privacyVersion: row.privacy_version,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicConversionHistoryItem(item) {
  return {
    id: item.id,
    fileName: item.fileName,
    from: item.inputFormat,
    to: item.outputFormat,
    fileSizeBytes: item.fileSizeBytes,
    status: item.status,
    createdAt: item.createdAt
  };
}

function mapConversionHistoryItem(row) {
  return publicConversionHistoryItem({
    id: row.id,
    fileName: row.file_name,
    inputFormat: row.input_format,
    outputFormat: row.output_format,
    fileSizeBytes: row.file_size_bytes,
    status: row.status,
    createdAt: row.created_at
  });
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function readBearerToken(header) {
  if (typeof header !== "string") return null;
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(header);
  return match?.[1] ?? null;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function deleteExpiredSessions() {
  requireDatabase().prepare("DELETE FROM account_sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

function requireDatabase() {
  if (!database) throw new Error("Account store is not initialized.");
  return database;
}
