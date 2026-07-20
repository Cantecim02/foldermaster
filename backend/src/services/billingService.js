import { NotificationTypeV2, Subtype } from "@apple/app-store-server-library";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";
import {
  findEntitlementByOriginalTransactionId,
  getBillingSnapshot,
  markNotificationProcessed,
  recordNotification,
  upsertSubscriptionEntitlement
} from "./billingStore.js";
import {
  verifyAppleNotification,
  verifyAppleNotificationTransaction,
  verifyAppleRenewalInfo,
  verifyAppleTransaction
} from "./appleStoreService.js";

const STATUS_PRESERVING_NOTIFICATIONS = new Set([
  NotificationTypeV2.DID_CHANGE_RENEWAL_PREF,
  NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS,
  NotificationTypeV2.PRICE_INCREASE,
  NotificationTypeV2.PRICE_CHANGE,
  NotificationTypeV2.REFUND_DECLINED
]);

export async function verifyTransactionAndUpdateEntitlement({
  identity,
  signedTransactionInfo,
  environment,
  restore = false
}) {
  if (!config.monetizationEnabled) return getBillingSnapshot(identity);
  const transaction = await verifyAppleTransaction(signedTransactionInfo, environment);
  validateTransactionClaims(transaction, environment);
  if (!restore && transaction.appAccountToken && transaction.appAccountToken !== identity.appAccountToken) {
    throw new HttpError(409, "The purchase account token does not match this Editio identity.", {
      code: "APP_ACCOUNT_TOKEN_MISMATCH"
    });
  }
  const status = deriveTransactionStatus(transaction);
  upsertSubscriptionEntitlement({ identity, transaction, status });
  return getBillingSnapshot(identity);
}

export async function processAppleNotification(signedPayload) {
  if (!config.monetizationEnabled) return { accepted: true, disabled: true };
  const { notification, context } = await verifyAppleNotification(signedPayload);
  const notificationUuid = notification.notificationUUID;
  const notificationType = notification.notificationType ?? "UNKNOWN";
  const subtype = notification.subtype ?? null;
  const environment = notification.data?.environment ?? context.environment;
  if (!notificationUuid) {
    throw new HttpError(400, "Apple notification UUID is missing.", {
      code: "INVALID_APPLE_NOTIFICATION"
    });
  }

  const transaction = notification.data?.signedTransactionInfo
    ? await verifyAppleNotificationTransaction(notification.data.signedTransactionInfo, context)
    : null;
  if (transaction) validateTransactionClaims(transaction, environment);
  const renewal = notification.data?.signedRenewalInfo
    ? await verifyAppleRenewalInfo(notification.data.signedRenewalInfo, context)
    : null;
  const originalTransactionId = transaction?.originalTransactionId ?? renewal?.originalTransactionId ?? null;
  const inserted = recordNotification({
    notificationUuid,
    notificationType,
    subtype,
    environment,
    originalTransactionId,
    signedPayload
  });
  if (!inserted) return { accepted: true, duplicate: true };

  try {
    let applied = false;
    if (transaction) {
      const existing = originalTransactionId
        ? findEntitlementByOriginalTransactionId(originalTransactionId)
        : null;
      const identity = {
        userId: existing?.user_id ?? null,
        installationId: existing?.anonymous_installation_id ?? null,
        appAccountToken: transaction.appAccountToken ?? existing?.app_account_token ?? null
      };
      const status = deriveNotificationStatus({
        notificationType,
        subtype,
        transaction,
        existing
      });
      if (status) {
        upsertSubscriptionEntitlement({ identity, transaction, renewal, status });
        applied = true;
      }
    }
    markNotificationProcessed(notificationUuid, applied ? "processed" : "accepted_unhandled");
    return { accepted: true, duplicate: false };
  } catch (error) {
    markNotificationProcessed(notificationUuid, "failed");
    throw error;
  }
}

export function deriveTransactionStatus(transaction) {
  if (transaction.revocationDate) return "revoked";
  const expiresAt = Number(transaction.expiresDate ?? 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new HttpError(400, "The Apple subscription expiration date is missing.", {
      code: "INVALID_APPLE_TRANSACTION"
    });
  }
  return expiresAt > Date.now() ? "active" : "expired";
}

export function validateTransactionClaims(transaction, requestedEnvironment) {
  if (!transaction.transactionId || !transaction.originalTransactionId) {
    throw new HttpError(400, "Apple transaction identifiers are missing.", {
      code: "INVALID_APPLE_TRANSACTION"
    });
  }
  if (transaction.appAccountToken && !isUuid(transaction.appAccountToken)) {
    throw new HttpError(400, "Apple app account token is invalid.", {
      code: "INVALID_APPLE_TRANSACTION"
    });
  }
  if (transaction.bundleId !== config.appleBundleId) {
    throw new HttpError(400, "Apple transaction bundle identifier is invalid.", {
      code: "APPLE_BUNDLE_MISMATCH"
    });
  }
  if (!config.appleProductIds.includes(transaction.productId)) {
    throw new HttpError(400, "Apple transaction product is not supported.", {
      code: "APPLE_PRODUCT_MISMATCH"
    });
  }
  if (!config.appleIapEnvironments.includes(transaction.environment)) {
    throw new HttpError(400, "Apple transaction environment is not allowed.", {
      code: "APPLE_ENVIRONMENT_MISMATCH"
    });
  }
  if (requestedEnvironment && transaction.environment !== requestedEnvironment) {
    throw new HttpError(400, "Apple transaction environment does not match the request.", {
      code: "APPLE_ENVIRONMENT_MISMATCH"
    });
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function deriveNotificationStatus({ notificationType, subtype, transaction, existing }) {
  switch (notificationType) {
    case NotificationTypeV2.SUBSCRIBED:
    case NotificationTypeV2.DID_RENEW:
    case NotificationTypeV2.OFFER_REDEEMED:
    case NotificationTypeV2.RENEWAL_EXTENDED:
    case NotificationTypeV2.RENEWAL_EXTENSION:
    case NotificationTypeV2.REFUND_REVERSED:
      return deriveTransactionStatus(transaction);
    case NotificationTypeV2.EXPIRED:
    case NotificationTypeV2.GRACE_PERIOD_EXPIRED:
      return "expired";
    case NotificationTypeV2.REFUND:
      return "refunded";
    case NotificationTypeV2.REVOKE:
      return "revoked";
    case NotificationTypeV2.DID_FAIL_TO_RENEW:
      return subtype === Subtype.GRACE_PERIOD ? "grace_period" : "billing_retry";
    default:
      if (STATUS_PRESERVING_NOTIFICATIONS.has(notificationType)) {
        return existing?.status ?? deriveTransactionStatus(transaction);
      }
      return null;
  }
}
