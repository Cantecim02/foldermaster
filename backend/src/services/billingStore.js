import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";
import { getAccountDatabase, getOrCreateAppAccountToken } from "./accountService.js";

const ACTIVE_STATUSES = new Set(["active", "grace_period"]);

export function initializeBillingStore() {
  const db = getAccountDatabase();
  const migrate = db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS subscription_entitlements (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL CHECK (platform = 'ios'),
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      anonymous_installation_id TEXT,
      app_account_token TEXT,
      product_id TEXT NOT NULL,
      original_transaction_id TEXT NOT NULL UNIQUE,
      latest_transaction_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      status TEXT NOT NULL,
      purchase_date TEXT,
      original_purchase_date TEXT,
      expires_at TEXT,
      grace_period_expires_at TEXT,
      auto_renew_status INTEGER,
      ownership_type TEXT,
      revoked_at TEXT,
      last_verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS subscription_entitlements_latest_transaction_idx
      ON subscription_entitlements(latest_transaction_id);
    CREATE INDEX IF NOT EXISTS subscription_entitlements_user_idx
      ON subscription_entitlements(user_id);
    CREATE INDEX IF NOT EXISTS subscription_entitlements_installation_idx
      ON subscription_entitlements(anonymous_installation_id);
    CREATE INDEX IF NOT EXISTS subscription_entitlements_account_token_idx
      ON subscription_entitlements(app_account_token);

    CREATE TABLE IF NOT EXISTS free_conversion_usage (
      id TEXT PRIMARY KEY,
      principal_key TEXT NOT NULL UNIQUE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      anonymous_installation_id TEXT,
      free_limit INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS free_conversion_usage_user_idx
      ON free_conversion_usage(user_id)
      WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS free_conversion_usage_installation_idx
      ON free_conversion_usage(anonymous_installation_id)
      WHERE anonymous_installation_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS conversion_usage_events (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      principal_key TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      anonymous_installation_id TEXT,
      reservation_status TEXT NOT NULL CHECK (
        reservation_status IN ('reserved', 'completed', 'released', 'expired')
      ),
      consumes_free_credit INTEGER NOT NULL CHECK (consumes_free_credit IN (0, 1)),
      conversion_type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      released_at TEXT
    );

    CREATE INDEX IF NOT EXISTS conversion_usage_events_principal_status_idx
      ON conversion_usage_events(principal_key, reservation_status, expires_at);

    CREATE TABLE IF NOT EXISTS app_store_notification_events (
      notification_uuid TEXT PRIMARY KEY,
      notification_type TEXT NOT NULL,
      subtype TEXT,
      environment TEXT NOT NULL,
      original_transaction_id TEXT,
      payload_hash TEXT NOT NULL,
      received_at TEXT NOT NULL,
      processed_at TEXT,
      processing_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guest_account_merges (
      anonymous_installation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      merged_at TEXT NOT NULL
    );
    `);
  });
  migrate.immediate();
}

export function resolveBillingIdentity({ user = null, installationId = null }) {
  if (!user && !installationId) {
    throw new HttpError(400, "An anonymous installation identifier is required.", {
      code: "INSTALLATION_ID_REQUIRED"
    });
  }

  const identity = {
    userId: user?.id ?? null,
    installationId: installationId || null,
    appAccountToken: user ? getOrCreateAppAccountToken(user.id) : installationId || null
  };

  if (identity.userId && identity.installationId) {
    const installationBelongsToAccount = mergeGuestUsageIntoAccount(identity);
    if (!installationBelongsToAccount) {
      // A shared device may sign in to another Editio account. Keep that account
      // usable without exposing the first account's guest usage or entitlement.
      identity.installationId = null;
    }
  }
  return identity;
}

export function getBillingSnapshot(identity) {
  if (!config.monetizationEnabled) {
    return {
      monetizationEnabled: false,
      active: false,
      status: "disabled",
      productId: null,
      expiresAt: null,
      autoRenewStatus: null,
      freeLimit: config.freeConversionLimit,
      usedFreeConversions: 0,
      reservedFreeConversions: 0,
      remainingFreeConversions: config.freeConversionLimit,
      canConvert: true,
      appAccountToken: identity.appAccountToken
    };
  }

  const db = getAccountDatabase();
  expireStaleReservations(db);
  const principalKey = getPrincipalKey(identity);
  const usage = ensureUsageRow(db, identity, principalKey);
  const entitlement = findBestEntitlement(db, identity);
  const reserved = db.prepare(`
    SELECT COUNT(*) AS count
    FROM conversion_usage_events
    WHERE principal_key = ?
      AND reservation_status = 'reserved'
      AND consumes_free_credit = 1
      AND expires_at > ?
  `).get(principalKey, nowIso()).count;
  const active = isEntitlementActive(entitlement);
  const remaining = Math.max(0, usage.free_limit - usage.used_count - reserved);

  return {
    monetizationEnabled: true,
    active,
    status: entitlement?.status ?? "free",
    productId: entitlement?.product_id ?? null,
    expiresAt: entitlement?.expires_at ?? null,
    gracePeriodExpiresAt: entitlement?.grace_period_expires_at ?? null,
    autoRenewStatus:
      entitlement?.auto_renew_status === null || entitlement?.auto_renew_status === undefined
        ? null
        : Boolean(entitlement.auto_renew_status),
    freeLimit: usage.free_limit,
    usedFreeConversions: usage.used_count,
    reservedFreeConversions: reserved,
    remainingFreeConversions: remaining,
    canConvert: active || remaining > 0,
    appAccountToken: identity.appAccountToken
  };
}

export function reserveConversionAuthorization({ identity, operationId, conversionType }) {
  if (!config.monetizationEnabled) {
    return {
      id: null,
      operationId,
      allowed: true,
      consumesFreeCredit: false,
      entitlement: getBillingSnapshot(identity)
    };
  }

  const db = getAccountDatabase();
  const transaction = db.transaction(() => {
    expireStaleReservations(db);
    const principalKey = getPrincipalKey(identity);
    const existing = db.prepare("SELECT * FROM conversion_usage_events WHERE operation_id = ?")
      .get(operationId);
    if (existing) {
      assertEventOwnership(existing, identity);
      if (existing.reservation_status === "released" || existing.reservation_status === "expired") {
        throw new HttpError(409, "This conversion authorization is no longer active.", {
          code: "AUTHORIZATION_EXPIRED"
        });
      }
      return authorizationResult(existing, getBillingSnapshot(identity));
    }

    const snapshot = getBillingSnapshot(identity);
    if (!snapshot.canConvert) {
      throw new HttpError(402, "The free conversion allowance has been used.", {
        code: "FREE_LIMIT_REACHED",
        details: snapshot
      });
    }

    const now = nowIso();
    const event = {
      id: randomUUID(),
      operationId,
      principalKey,
      userId: identity.userId,
      installationId: identity.installationId,
      reservationStatus: "reserved",
      consumesFreeCredit: snapshot.active ? 0 : 1,
      conversionType,
      expiresAt: new Date(Date.now() + config.conversionAuthorizationTtlMs).toISOString(),
      createdAt: now
    };
    db.prepare(`
      INSERT INTO conversion_usage_events (
        id, operation_id, principal_key, user_id, anonymous_installation_id,
        reservation_status, consumes_free_credit, conversion_type, expires_at, created_at
      ) VALUES (
        @id, @operationId, @principalKey, @userId, @installationId,
        @reservationStatus, @consumesFreeCredit, @conversionType, @expiresAt, @createdAt
      )
    `).run(event);
    return authorizationResult(mapEventInput(event), getBillingSnapshot(identity));
  });

  return transaction.immediate();
}

export function completeConversionAuthorization({ id, identity }) {
  if (!config.monetizationEnabled || !id) return getBillingSnapshot(identity);
  const db = getAccountDatabase();
  const transaction = db.transaction(() => {
    const event = getOwnedEvent(db, id, identity);
    if (event.reservation_status === "completed") return getBillingSnapshot(identity);
    if (event.reservation_status !== "reserved" || Date.parse(event.expires_at) <= Date.now()) {
      throw new HttpError(409, "This conversion authorization cannot be completed.", {
        code: "AUTHORIZATION_EXPIRED"
      });
    }

    const completedAt = nowIso();
    const updated = db.prepare(`
      UPDATE conversion_usage_events
      SET reservation_status = 'completed', completed_at = ?
      WHERE id = ? AND reservation_status = 'reserved'
    `).run(completedAt, id);
    if (updated.changes === 1 && event.consumes_free_credit === 1) {
      const principalKey = getPrincipalKey(identity);
      ensureUsageRow(db, identity, principalKey);
      db.prepare(`
        UPDATE free_conversion_usage
        SET used_count = MIN(free_limit, used_count + 1), updated_at = ?
        WHERE principal_key = ?
      `).run(completedAt, principalKey);
    }
    return getBillingSnapshot(identity);
  });
  return transaction.immediate();
}

export function releaseConversionAuthorization({ id, identity }) {
  if (!config.monetizationEnabled || !id) return getBillingSnapshot(identity);
  const db = getAccountDatabase();
  const transaction = db.transaction(() => {
    const event = getOwnedEvent(db, id, identity);
    if (event.reservation_status === "completed") {
      return getBillingSnapshot(identity);
    }
    if (event.reservation_status === "reserved") {
      db.prepare(`
        UPDATE conversion_usage_events
        SET reservation_status = 'released', released_at = ?
        WHERE id = ? AND reservation_status = 'reserved'
      `).run(nowIso(), id);
    }
    return getBillingSnapshot(identity);
  });
  return transaction.immediate();
}

export function validateConversionAuthorization({ id, identity }) {
  if (!config.monetizationEnabled) return null;
  if (!id) {
    throw new HttpError(402, "A conversion authorization is required.", {
      code: "CONVERSION_AUTHORIZATION_REQUIRED"
    });
  }
  const event = getOwnedEvent(getAccountDatabase(), id, identity);
  if (event.reservation_status !== "reserved" || Date.parse(event.expires_at) <= Date.now()) {
    throw new HttpError(409, "This conversion authorization has expired.", {
      code: "AUTHORIZATION_EXPIRED"
    });
  }
  return event;
}

export function upsertSubscriptionEntitlement({ identity, transaction, renewal = null, status }) {
  const db = getAccountDatabase();
  const originalTransactionId = String(transaction.originalTransactionId ?? "");
  const transactionId = String(transaction.transactionId ?? "");
  if (!originalTransactionId || !transactionId) {
    throw new HttpError(400, "Apple transaction identifiers are missing.", {
      code: "INVALID_APPLE_TRANSACTION"
    });
  }

  const existing = db.prepare(`
    SELECT * FROM subscription_entitlements WHERE original_transaction_id = ?
  `).get(originalTransactionId);
  if (existing && existing.environment !== transaction.environment) {
    throw new HttpError(409, "This purchase belongs to a different App Store environment.", {
      code: "PURCHASE_ENVIRONMENT_CONFLICT"
    });
  }
  if (existing?.user_id && identity.userId && existing.user_id !== identity.userId) {
    throw new HttpError(409, "This purchase is linked to another Editio account.", {
      code: "PURCHASE_OWNERSHIP_CONFLICT"
    });
  }

  const now = nowIso();
  const item = {
    id: existing?.id ?? randomUUID(),
    userId: identity.userId ?? existing?.user_id ?? null,
    installationId: identity.installationId ?? existing?.anonymous_installation_id ?? null,
    appAccountToken: transaction.appAccountToken ?? existing?.app_account_token ?? null,
    productId: transaction.productId,
    originalTransactionId,
    latestTransactionId: transactionId,
    environment: transaction.environment,
    status,
    purchaseDate: toIso(transaction.purchaseDate),
    originalPurchaseDate: toIso(transaction.originalPurchaseDate),
    expiresAt: toIso(transaction.expiresDate),
    gracePeriodExpiresAt: toIso(renewal?.gracePeriodExpiresDate),
    autoRenewStatus: normalizeBooleanInteger(renewal?.autoRenewStatus),
    ownershipType: transaction.inAppOwnershipType ?? null,
    revokedAt: toIso(transaction.revocationDate),
    lastVerifiedAt: now,
    createdAt: existing?.created_at ?? now,
    updatedAt: now
  };

  db.prepare(`
    INSERT INTO subscription_entitlements (
      id, platform, user_id, anonymous_installation_id, app_account_token,
      product_id, original_transaction_id, latest_transaction_id, environment,
      status, purchase_date, original_purchase_date, expires_at,
      grace_period_expires_at, auto_renew_status, ownership_type, revoked_at,
      last_verified_at, created_at, updated_at
    ) VALUES (
      @id, 'ios', @userId, @installationId, @appAccountToken,
      @productId, @originalTransactionId, @latestTransactionId, @environment,
      @status, @purchaseDate, @originalPurchaseDate, @expiresAt,
      @gracePeriodExpiresAt, @autoRenewStatus, @ownershipType, @revokedAt,
      @lastVerifiedAt, @createdAt, @updatedAt
    )
    ON CONFLICT(original_transaction_id) DO UPDATE SET
      user_id = excluded.user_id,
      anonymous_installation_id = excluded.anonymous_installation_id,
      app_account_token = COALESCE(excluded.app_account_token, subscription_entitlements.app_account_token),
      product_id = excluded.product_id,
      latest_transaction_id = excluded.latest_transaction_id,
      environment = excluded.environment,
      status = excluded.status,
      purchase_date = excluded.purchase_date,
      original_purchase_date = excluded.original_purchase_date,
      expires_at = excluded.expires_at,
      grace_period_expires_at = excluded.grace_period_expires_at,
      auto_renew_status = COALESCE(excluded.auto_renew_status, subscription_entitlements.auto_renew_status),
      ownership_type = excluded.ownership_type,
      revoked_at = excluded.revoked_at,
      last_verified_at = excluded.last_verified_at,
      updated_at = excluded.updated_at
  `).run(item);

  syncLegacySubscriptionFields(db, item.userId, item);
  return item;
}

export function findEntitlementByOriginalTransactionId(originalTransactionId) {
  return getAccountDatabase().prepare(`
    SELECT * FROM subscription_entitlements WHERE original_transaction_id = ?
  `).get(String(originalTransactionId));
}

export function recordNotification({ notificationUuid, notificationType, subtype, environment, originalTransactionId, signedPayload }) {
  const result = getAccountDatabase().prepare(`
    INSERT OR IGNORE INTO app_store_notification_events (
      notification_uuid, notification_type, subtype, environment,
      original_transaction_id, payload_hash, received_at, processing_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received')
  `).run(
    notificationUuid,
    notificationType,
    subtype ?? null,
    environment,
    originalTransactionId ?? null,
    createHash("sha256").update(signedPayload).digest("hex"),
    nowIso()
  );
  return result.changes === 1;
}

export function markNotificationProcessed(notificationUuid, processingStatus = "processed") {
  getAccountDatabase().prepare(`
    UPDATE app_store_notification_events
    SET processing_status = ?, processed_at = ?
    WHERE notification_uuid = ?
  `).run(processingStatus, nowIso(), notificationUuid);
}

export function resetBillingStoreForTests() {
  const db = getAccountDatabase();
  db.exec(`
    DELETE FROM app_store_notification_events;
    DELETE FROM conversion_usage_events;
    DELETE FROM free_conversion_usage;
    DELETE FROM subscription_entitlements;
    DELETE FROM guest_account_merges;
  `);
}

function mergeGuestUsageIntoAccount(identity) {
  const db = getAccountDatabase();
  const transaction = db.transaction(() => {
    const priorMerge = db.prepare(`
      SELECT user_id FROM guest_account_merges WHERE anonymous_installation_id = ?
    `).get(identity.installationId);
    if (priorMerge && priorMerge.user_id !== identity.userId) {
      return false;
    }
    if (!priorMerge) {
      db.prepare(`
        INSERT INTO guest_account_merges (anonymous_installation_id, user_id, merged_at)
        VALUES (?, ?, ?)
      `).run(identity.installationId, identity.userId, nowIso());
    }

    const guestKey = `install:${identity.installationId}`;
    const accountKey = `user:${identity.userId}`;
    const guestUsage = db.prepare("SELECT * FROM free_conversion_usage WHERE principal_key = ?").get(guestKey);
    const accountUsage = ensureUsageRow(db, identity, accountKey);
    if (guestUsage) {
      const usedCount = Math.min(
        Math.max(accountUsage.free_limit, guestUsage.free_limit, config.freeConversionLimit),
        accountUsage.used_count + guestUsage.used_count
      );
      db.prepare(`
        UPDATE free_conversion_usage
        SET used_count = ?, free_limit = ?, updated_at = ?
        WHERE principal_key = ?
      `).run(
        usedCount,
        Math.max(accountUsage.free_limit, guestUsage.free_limit, config.freeConversionLimit),
        nowIso(),
        accountKey
      );
      db.prepare("DELETE FROM free_conversion_usage WHERE principal_key = ?").run(guestKey);
    }
    db.prepare(`
      UPDATE conversion_usage_events
      SET principal_key = ?, user_id = ?
      WHERE principal_key = ?
    `).run(accountKey, identity.userId, guestKey);
    db.prepare(`
      UPDATE subscription_entitlements
      SET user_id = ?, updated_at = ?
      WHERE anonymous_installation_id = ? AND user_id IS NULL
    `).run(identity.userId, nowIso(), identity.installationId);
    return true;
  });
  return transaction.immediate();
}

function ensureUsageRow(db, identity, principalKey) {
  const now = nowIso();
  db.prepare(`
    INSERT OR IGNORE INTO free_conversion_usage (
      id, principal_key, user_id, anonymous_installation_id,
      free_limit, used_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    randomUUID(),
    principalKey,
    identity.userId,
    identity.userId ? null : identity.installationId,
    config.freeConversionLimit,
    now,
    now
  );
  return db.prepare("SELECT * FROM free_conversion_usage WHERE principal_key = ?").get(principalKey);
}

function expireStaleReservations(db) {
  const now = nowIso();
  db.prepare(`
    UPDATE conversion_usage_events
    SET reservation_status = 'expired', released_at = ?
    WHERE reservation_status = 'reserved' AND expires_at <= ?
  `).run(now, now);
}

function findBestEntitlement(db, identity) {
  const clauses = [];
  const values = [];
  if (identity.userId) {
    clauses.push("user_id = ?");
    values.push(identity.userId);
  }
  if (!identity.userId && identity.installationId) {
    clauses.push("anonymous_installation_id = ?");
    values.push(identity.installationId);
  }
  if (identity.appAccountToken) {
    clauses.push("app_account_token = ?");
    values.push(identity.appAccountToken);
  }
  if (clauses.length === 0) return null;
  return db.prepare(`
    SELECT * FROM subscription_entitlements
    WHERE ${clauses.map((clause) => `(${clause})`).join(" OR ")}
    ORDER BY COALESCE(grace_period_expires_at, expires_at, updated_at) DESC
    LIMIT 1
  `).get(...values);
}

function isEntitlementActive(entitlement) {
  if (!entitlement || !ACTIVE_STATUSES.has(entitlement.status) || entitlement.revoked_at) return false;
  const accessUntil = entitlement.status === "grace_period"
    ? entitlement.grace_period_expires_at ?? entitlement.expires_at
    : entitlement.expires_at;
  return Boolean(accessUntil && Date.parse(accessUntil) > Date.now());
}

function getOwnedEvent(db, id, identity) {
  const event = db.prepare("SELECT * FROM conversion_usage_events WHERE id = ?").get(id);
  if (!event) {
    throw new HttpError(404, "Conversion authorization was not found.", {
      code: "AUTHORIZATION_NOT_FOUND"
    });
  }
  assertEventOwnership(event, identity);
  return event;
}

function assertEventOwnership(event, identity) {
  const principalKey = getPrincipalKey(identity);
  const ownsEvent = identity.userId
    ? event.principal_key === principalKey || event.user_id === identity.userId
    : event.principal_key === principalKey || (
        identity.installationId && event.anonymous_installation_id === identity.installationId
      );
  if (!ownsEvent) {
    throw new HttpError(403, "This conversion authorization belongs to another user.", {
      code: "AUTHORIZATION_FORBIDDEN"
    });
  }
}

function authorizationResult(event, entitlement) {
  return {
    id: event.id,
    operationId: event.operation_id,
    allowed: true,
    consumesFreeCredit: Boolean(event.consumes_free_credit),
    expiresAt: event.expires_at,
    entitlement
  };
}

function mapEventInput(event) {
  return {
    id: event.id,
    operation_id: event.operationId,
    consumes_free_credit: event.consumesFreeCredit,
    expires_at: event.expiresAt
  };
}

function syncLegacySubscriptionFields(db, userId, entitlement) {
  if (!userId) return;
  const status = isEntitlementActive({
    status: entitlement.status,
    expires_at: entitlement.expiresAt,
    grace_period_expires_at: entitlement.gracePeriodExpiresAt,
    revoked_at: entitlement.revokedAt
  }) ? "pro" : "free";
  db.prepare(`
    UPDATE users
    SET subscription_status = ?, subscription_expire_date = ?, updated_at = ?
    WHERE id = ?
  `).run(status, entitlement.expiresAt, nowIso(), userId);
}

function getPrincipalKey(identity) {
  if (identity.userId) return `user:${identity.userId}`;
  if (identity.installationId) return `install:${identity.installationId}`;
  throw new HttpError(400, "A billing identity is required.", { code: "BILLING_IDENTITY_REQUIRED" });
}

function normalizeBooleanInteger(value) {
  if (value === undefined || value === null) return null;
  return value === true || value === 1 ? 1 : 0;
}

function toIso(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return new Date(value).toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function nowIso() {
  return new Date().toISOString();
}
