import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { config } from "../src/config.js";
import {
  closeAccountStore,
  deleteAccount,
  getAccountDatabase,
  initializeAccountStore,
  registerAccount
} from "../src/services/accountService.js";
import {
  completeConversionAuthorization,
  findEntitlementByOriginalTransactionId,
  getBillingSnapshot,
  initializeBillingStore,
  releaseConversionAuthorization,
  reserveConversionAuthorization,
  resolveBillingIdentity,
  upsertSubscriptionEntitlement
} from "../src/services/billingStore.js";
import {
  processAppleNotification,
  verifyTransactionAndUpdateEntitlement
} from "../src/services/billingService.js";
import {
  resetAppleStoreAdapterForTests,
  setAppleStoreAdapterForTests
} from "../src/services/appleStoreService.js";
import {
  assertConversionClientCompatibility,
  authorizeBackendConversion
} from "../src/services/conversionAccessService.js";

test("first three successful conversions consume the lifetime allowance and the fourth is blocked", async () => {
  await withBillingStore(() => {
    const identity = guestIdentity();
    for (let index = 0; index < 3; index += 1) {
      const authorization = reserve(identity, randomUUID());
      completeConversionAuthorization({ id: authorization.id, identity });
    }
    const snapshot = getBillingSnapshot(identity);
    assert.equal(snapshot.usedFreeConversions, 3);
    assert.equal(snapshot.remainingFreeConversions, 0);
    assert.equal(snapshot.canConvert, false);
    assert.throws(() => reserve(identity, randomUUID()), (error) => error.status === 402);
  });
});

test("failed or cancelled conversions release their reservation without consuming credit", async () => {
  await withBillingStore(() => {
    const identity = guestIdentity();
    const authorization = reserve(identity, randomUUID());
    releaseConversionAuthorization({ id: authorization.id, identity });
    const snapshot = getBillingSnapshot(identity);
    assert.equal(snapshot.usedFreeConversions, 0);
    assert.equal(snapshot.remainingFreeConversions, 3);
  });
});

test("the same operation and completion are idempotent", async () => {
  await withBillingStore(() => {
    const identity = guestIdentity();
    const operationId = randomUUID();
    const first = reserve(identity, operationId);
    const duplicate = reserve(identity, operationId);
    assert.equal(duplicate.id, first.id);
    completeConversionAuthorization({ id: first.id, identity });
    completeConversionAuthorization({ id: first.id, identity });
    assert.equal(getBillingSnapshot(identity).usedFreeConversions, 1);
  });
});

test("four simultaneous reservations cannot exceed a three conversion allowance", async () => {
  await withBillingStore(() => {
    const identity = guestIdentity();
    const results = Array.from({ length: 4 }, () => {
      try {
        return reserve(identity, randomUUID());
      } catch (error) {
        return error;
      }
    });
    assert.equal(results.filter((value) => value.allowed).length, 3);
    assert.equal(results.filter((value) => value.status === 402).length, 1);
  });
});

test("active monthly and yearly subscriptions allow conversions without consuming free credits", async () => {
  await withBillingStore(() => {
    for (const productId of config.appleProductIds) {
      const identity = guestIdentity();
      const transaction = makeTransaction({ productId, appAccountToken: identity.appAccountToken });
      upsertSubscriptionEntitlement({ identity, transaction, status: "active" });
      const authorization = reserve(identity, randomUUID());
      assert.equal(authorization.consumesFreeCredit, false);
      completeConversionAuthorization({ id: authorization.id, identity });
      assert.equal(getBillingSnapshot(identity).usedFreeConversions, 0);
      assert.equal(getBillingSnapshot(identity).active, true);
    }
  });
});

test("expired and revoked subscriptions do not grant Pro access", async () => {
  await withBillingStore(() => {
    const expiredIdentity = guestIdentity();
    upsertSubscriptionEntitlement({
      identity: expiredIdentity,
      transaction: makeTransaction({
        appAccountToken: expiredIdentity.appAccountToken,
        expiresDate: Date.now() - 1_000
      }),
      status: "expired"
    });
    assert.equal(getBillingSnapshot(expiredIdentity).active, false);

    const revokedIdentity = guestIdentity();
    upsertSubscriptionEntitlement({
      identity: revokedIdentity,
      transaction: makeTransaction({
        appAccountToken: revokedIdentity.appAccountToken,
        revocationDate: Date.now()
      }),
      status: "revoked"
    });
    assert.equal(getBillingSnapshot(revokedIdentity).active, false);
  });
});

test("grace period grants access only until its verified grace expiration", async () => {
  await withBillingStore(() => {
    const identity = guestIdentity();
    upsertSubscriptionEntitlement({
      identity,
      transaction: makeTransaction({
        appAccountToken: identity.appAccountToken,
        expiresDate: Date.now() - 1_000
      }),
      renewal: { gracePeriodExpiresDate: Date.now() + 60_000 },
      status: "grace_period"
    });
    assert.equal(getBillingSnapshot(identity).active, true);
  });
});

test("duplicate App Store notifications are processed once", async () => {
  await withBillingStore(async () => {
    const transaction = makeTransaction();
    const notification = makeNotification(transaction, "same-notification");
    installFakeAppleAdapter({ transaction, notification });
    const first = await processAppleNotification("signed-notification");
    const second = await processAppleNotification("signed-notification");
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    const count = getAccountDatabase().prepare("SELECT COUNT(*) AS count FROM app_store_notification_events").get().count;
    assert.equal(count, 1);
  });
});

test("invalid Apple verification is rejected without creating an entitlement", async () => {
  await withBillingStore(async () => {
    setAppleStoreAdapterForTests({
      verifyTransaction() {
        throw new Error("invalid signature");
      }
    });
    const identity = guestIdentity();
    await assert.rejects(
      () => verifyTransactionAndUpdateEntitlement({ identity, signedTransactionInfo: "x".repeat(120) }),
      /invalid signature/
    );
    assert.equal(getAccountDatabase().prepare("SELECT COUNT(*) AS count FROM subscription_entitlements").get().count, 0);
  });
});

test("wrong bundle, product, and environment claims are rejected", async () => {
  await withBillingStore(async () => {
    const identity = guestIdentity();
    for (const transaction of [
      makeTransaction({ bundleId: "com.example.other" }),
      makeTransaction({ productId: "com.example.fake" }),
      makeTransaction({ environment: "Production" })
    ]) {
      installFakeAppleAdapter({ transaction });
      await assert.rejects(
        () => verifyTransactionAndUpdateEntitlement({
          identity,
          signedTransactionInfo: "x".repeat(120),
          environment: "Sandbox"
        }),
        (error) => error.status === 400
      );
    }
  });
});

test("an appAccountToken mismatch is rejected for a new purchase", async () => {
  await withBillingStore(async () => {
    const identity = guestIdentity();
    installFakeAppleAdapter({ transaction: makeTransaction({ appAccountToken: randomUUID() }) });
    await assert.rejects(
      () => verifyTransactionAndUpdateEntitlement({
        identity,
        signedTransactionInfo: "x".repeat(120),
        environment: "Sandbox"
      }),
      (error) => error.code === "APP_ACCOUNT_TOKEN_MISMATCH"
    );
  });
});

test("restore can attach a valid active entitlement to a new installation", async () => {
  await withBillingStore(async () => {
    const identity = guestIdentity();
    const transaction = makeTransaction({ appAccountToken: randomUUID() });
    installFakeAppleAdapter({ transaction });
    const snapshot = await verifyTransactionAndUpdateEntitlement({
      identity,
      signedTransactionInfo: "x".repeat(120),
      environment: "Sandbox",
      restore: true
    });
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.productId, transaction.productId);
  });
});

test("restore reports an expired subscription without granting Pro access", async () => {
  await withBillingStore(async () => {
    const identity = guestIdentity();
    const transaction = makeTransaction({
      appAccountToken: randomUUID(),
      expiresDate: Date.now() - 1_000
    });
    installFakeAppleAdapter({ transaction });
    const snapshot = await verifyTransactionAndUpdateEntitlement({
      identity,
      signedTransactionInfo: "x".repeat(120),
      environment: "Sandbox",
      restore: true
    });
    assert.equal(snapshot.active, false);
    assert.equal(snapshot.status, "expired");
  });
});

test("refund notifications revoke an existing entitlement", async () => {
  await withBillingStore(async () => {
    const identity = guestIdentity();
    const originalTransactionId = randomUUID();
    const activeTransaction = makeTransaction({
      appAccountToken: identity.appAccountToken,
      originalTransactionId
    });
    upsertSubscriptionEntitlement({ identity, transaction: activeTransaction, status: "active" });

    const refundedTransaction = makeTransaction({
      appAccountToken: identity.appAccountToken,
      originalTransactionId,
      revocationDate: Date.now()
    });
    const notification = makeNotification(refundedTransaction, {
      notificationType: "REFUND"
    });
    installFakeAppleAdapter({ transaction: refundedTransaction, notification });
    await processAppleNotification("signed-refund-notification");

    const stored = findEntitlementByOriginalTransactionId(originalTransactionId);
    assert.equal(stored.status, "refunded");
    assert.ok(stored.revoked_at);
    assert.equal(getBillingSnapshot(identity).active, false);
  });
});

test("billing retry and grace period notifications follow the verified renewal state", async () => {
  await withBillingStore(async () => {
    const retryIdentity = guestIdentity();
    const retryTransaction = makeTransaction({
      appAccountToken: retryIdentity.appAccountToken,
      expiresDate: Date.now() - 1_000
    });
    upsertSubscriptionEntitlement({ identity: retryIdentity, transaction: retryTransaction, status: "active" });
    installFakeAppleAdapter({
      transaction: retryTransaction,
      notification: makeNotification(retryTransaction, {
        notificationType: "DID_FAIL_TO_RENEW"
      }),
      renewal: { autoRenewStatus: 1 }
    });
    await processAppleNotification("signed-billing-retry-notification");
    assert.equal(getBillingSnapshot(retryIdentity).status, "billing_retry");
    assert.equal(getBillingSnapshot(retryIdentity).active, false);

    const graceIdentity = guestIdentity();
    const graceTransaction = makeTransaction({
      appAccountToken: graceIdentity.appAccountToken,
      expiresDate: Date.now() - 1_000
    });
    upsertSubscriptionEntitlement({ identity: graceIdentity, transaction: graceTransaction, status: "active" });
    installFakeAppleAdapter({
      transaction: graceTransaction,
      notification: makeNotification(graceTransaction, {
        notificationType: "DID_FAIL_TO_RENEW",
        subtype: "GRACE_PERIOD"
      }),
      renewal: {
        autoRenewStatus: 1,
        gracePeriodExpiresDate: Date.now() + 60_000
      }
    });
    await processAppleNotification("signed-grace-period-notification");
    const graceSnapshot = getBillingSnapshot(graceIdentity);
    assert.equal(graceSnapshot.status, "grace_period");
    assert.equal(graceSnapshot.active, true);
    assert.ok(graceSnapshot.gracePeriodExpiresAt);
  });
});

test("verified unknown notifications are recorded once and safely acknowledged", async () => {
  await withBillingStore(async () => {
    const notification = makeNotification(null, {
      notificationType: "FUTURE_APPLE_EVENT",
      includeTransaction: false,
      includeRenewal: false
    });
    setAppleStoreAdapterForTests({
      verifyNotification: async () => notification
    });
    const result = await processAppleNotification("signed-future-notification");
    assert.equal(result.accepted, true);
    assert.equal(result.duplicate, false);
    const stored = getAccountDatabase().prepare(`
      SELECT notification_type, processing_status
      FROM app_store_notification_events
    `).get();
    assert.equal(stored.notification_type, "FUTURE_APPLE_EVENT");
    assert.equal(stored.processing_status, "accepted_unhandled");
  });
});

test("verified unknown notifications with a transaction do not claim to be applied", async () => {
  await withBillingStore(async () => {
    const transaction = makeTransaction();
    const notification = makeNotification(transaction, {
      notificationType: "FUTURE_APPLE_EVENT"
    });
    installFakeAppleAdapter({ transaction, notification });
    const result = await processAppleNotification("signed-future-transaction-notification");
    assert.equal(result.accepted, true);
    const stored = getAccountDatabase().prepare(`
      SELECT processing_status FROM app_store_notification_events
    `).get();
    assert.equal(stored.processing_status, "accepted_unhandled");
    assert.equal(getAccountDatabase().prepare("SELECT COUNT(*) AS count FROM subscription_entitlements").get().count, 0);
  });
});

test("Apple transaction identifiers and appAccountToken format are validated", async () => {
  await withBillingStore(async () => {
    const identity = guestIdentity();
    for (const transaction of [
      makeTransaction({ transactionId: "" }),
      makeTransaction({ originalTransactionId: "" }),
      makeTransaction({ appAccountToken: "not-a-uuid" })
    ]) {
      installFakeAppleAdapter({ transaction });
      await assert.rejects(
        () => verifyTransactionAndUpdateEntitlement({
          identity,
          signedTransactionInfo: "x".repeat(120),
          environment: "Sandbox"
        }),
        (error) => error.code === "INVALID_APPLE_TRANSACTION"
      );
    }
  });
});

test("an original transaction cannot cross Apple environments", async () => {
  await withBillingStore(() => {
    const identity = guestIdentity();
    const originalTransactionId = randomUUID();
    upsertSubscriptionEntitlement({
      identity,
      transaction: makeTransaction({ originalTransactionId }),
      status: "active"
    });
    assert.throws(
      () => upsertSubscriptionEntitlement({
        identity,
        transaction: makeTransaction({ originalTransactionId, environment: "Production" }),
        status: "active"
      }),
      (error) => error.code === "PURCHASE_ENVIRONMENT_CONFLICT"
    );
  });
});

test("guest-to-account merge preserves used credits and cannot create a second allowance", async () => {
  await withBillingStore(async () => {
    const installationId = randomUUID();
    const guest = resolveBillingIdentity({ installationId });
    for (let index = 0; index < 2; index += 1) {
      const authorization = reserve(guest, randomUUID());
      completeConversionAuthorization({ id: authorization.id, identity: guest });
    }
    const account = await registerAccount(accountInput());
    const merged = resolveBillingIdentity({ user: account.user, installationId });
    assert.equal(getBillingSnapshot(merged).usedFreeConversions, 2);
    assert.equal(getBillingSnapshot(merged).remainingFreeConversions, 1);
  });
});

test("a shared installation cannot leak guest billing data into a second account", async () => {
  await withBillingStore(async () => {
    const installationId = randomUUID();
    const guest = resolveBillingIdentity({ installationId });
    const guestAuthorization = reserve(guest, randomUUID());
    completeConversionAuthorization({ id: guestAuthorization.id, identity: guest });

    const firstAccount = await registerAccount(accountInput());
    const firstIdentity = resolveBillingIdentity({ user: firstAccount.user, installationId });
    assert.equal(getBillingSnapshot(firstIdentity).usedFreeConversions, 1);

    const secondAccount = await registerAccount(accountInput());
    const secondIdentity = resolveBillingIdentity({ user: secondAccount.user, installationId });
    assert.equal(secondIdentity.installationId, null);
    assert.equal(getBillingSnapshot(secondIdentity).usedFreeConversions, 0);
    assert.equal(getBillingSnapshot(secondIdentity).remainingFreeConversions, 3);

    assert.throws(
      () => completeConversionAuthorization({ id: guestAuthorization.id, identity: secondIdentity }),
      (error) => error.code === "AUTHORIZATION_FORBIDDEN" && error.status === 403
    );
  });
});

test("account deletion anonymizes billing metadata without cancelling the Apple entitlement", async () => {
  await withBillingStore(async () => {
    const account = await registerAccount(accountInput());
    const identity = resolveBillingIdentity({ user: account.user, installationId: randomUUID() });
    const transaction = makeTransaction({ appAccountToken: identity.appAccountToken });
    upsertSubscriptionEntitlement({ identity, transaction, status: "active" });
    await deleteAccount({ userId: account.user.id, password: "SecurePass123" });
    const stored = findEntitlementByOriginalTransactionId(transaction.originalTransactionId);
    assert.equal(stored.user_id, null);
    assert.equal(stored.status, "active");
    assert.equal(stored.original_transaction_id, transaction.originalTransactionId);
  });
});

test("feature flag off preserves the existing unrestricted conversion behavior", async () => {
  await withBillingStore(() => {
    config.monetizationEnabled = false;
    const identity = guestIdentity();
    const authorization = reserve(identity, randomUUID());
    assert.equal(authorization.id, null);
    assert.equal(authorization.allowed, true);
    assert.equal(getBillingSnapshot(identity).canConvert, true);
  });
});

test("old and mismatched iOS builds fail before upload when monetization is enabled", async () => {
  await withBillingStore(() => {
    config.monetizationMinIosBuild = 120;
    for (const headers of [
      {},
      clientHeaders({ build: "119" }),
      clientHeaders({ capable: "false", build: "120" })
    ]) {
      assert.throws(
        () => assertConversionClientCompatibility(fakeRequest(headers)),
        (error) => error.status === 426 && error.code === "CLIENT_UPDATE_REQUIRED"
      );
    }

    assert.throws(
      () => assertConversionClientCompatibility(fakeRequest(clientHeaders({ build: "120" }))),
      (error) => error.status === 409 && error.code === "CONVERSION_AUTHORIZATION_REQUIRED"
    );
  });
});

test("client build metadata cannot replace a server-issued conversion authorization", async () => {
  await withBillingStore(() => {
    config.monetizationMinIosBuild = 120;
    const headers = clientHeaders({
      build: "999999",
      authorization: randomUUID(),
      installationId: randomUUID()
    });
    assert.doesNotThrow(() => assertConversionClientCompatibility(fakeRequest(headers)));
    assert.throws(
      () => authorizeBackendConversion(fakeRequest(headers)),
      (error) => error.code === "AUTHORIZATION_NOT_FOUND"
    );
  });
});

test("billing schema migration can be run repeatedly", async () => {
  await withBillingStore(() => {
    assert.doesNotThrow(() => initializeBillingStore());
    assert.doesNotThrow(() => initializeBillingStore());
  });
});

async function withBillingStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "editio-billing-test-"));
  const original = {
    databasePath: config.databasePath,
    monetizationEnabled: config.monetizationEnabled,
    freeConversionLimit: config.freeConversionLimit,
    appleIapEnvironments: config.appleIapEnvironments,
    monetizationMinIosBuild: config.monetizationMinIosBuild
  };
  try {
    config.databasePath = path.join(root, "editio.sqlite");
    config.monetizationEnabled = true;
    config.freeConversionLimit = 3;
    config.appleIapEnvironments = ["Sandbox"];
    await initializeAccountStore();
    initializeBillingStore();
    await run();
  } finally {
    resetAppleStoreAdapterForTests();
    closeAccountStore();
    Object.assign(config, original);
    await rm(root, { recursive: true, force: true });
  }
}

function guestIdentity() {
  return resolveBillingIdentity({ installationId: randomUUID() });
}

function reserve(identity, operationId) {
  return reserveConversionAuthorization({ identity, operationId, conversionType: "test" });
}

function makeTransaction(overrides = {}) {
  const transactionId = overrides.transactionId ?? randomUUID();
  return {
    bundleId: config.appleBundleId,
    productId: config.appleProductIds[0],
    transactionId,
    originalTransactionId: overrides.originalTransactionId ?? randomUUID(),
    environment: "Sandbox",
    appAccountToken: overrides.appAccountToken ?? randomUUID(),
    purchaseDate: Date.now() - 1_000,
    originalPurchaseDate: Date.now() - 1_000,
    expiresDate: Date.now() + 86_400_000,
    inAppOwnershipType: "PURCHASED",
    ...overrides
  };
}

function makeNotification(transaction, options = {}) {
  const {
    notificationUuid = randomUUID(),
    notificationType = "DID_RENEW",
    subtype,
    includeTransaction = true,
    includeRenewal = true
  } = typeof options === "string" ? { notificationUuid: options } : options;
  return {
    notification: {
      notificationUUID: notificationUuid,
      notificationType,
      ...(subtype ? { subtype } : {}),
      data: {
        environment: "Sandbox",
        ...(includeTransaction ? { signedTransactionInfo: "transaction-jws" } : {}),
        ...(includeRenewal ? { signedRenewalInfo: "renewal-jws" } : {})
      }
    },
    context: { environment: "Sandbox" }
  };
}

function installFakeAppleAdapter({ transaction, notification = null, renewal = { autoRenewStatus: 1 } }) {
  setAppleStoreAdapterForTests({
    verifyTransaction: async () => transaction,
    verifyNotification: async () => notification ?? makeNotification(transaction),
    verifyNotificationTransaction: async () => transaction,
    verifyRenewalInfo: async () => renewal
  });
}

function accountInput() {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    birthDate: "1990-12-10",
    email: `${randomUUID()}@example.com`,
    password: "SecurePass123",
    acceptedTerms: true
  };
}

function clientHeaders({ build = "120", capable = "true", authorization, installationId } = {}) {
  return {
    "x-editio-client-platform": "ios",
    "x-editio-client-build": build,
    "x-editio-billing-version": "1",
    "x-editio-monetization-capable": capable,
    ...(authorization ? { "x-editio-conversion-authorization": authorization } : {}),
    ...(installationId ? { "x-editio-installation-id": installationId } : {})
  };
}

function fakeRequest(headers) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    get(name) {
      return normalized[String(name).toLowerCase()];
    }
  };
}
