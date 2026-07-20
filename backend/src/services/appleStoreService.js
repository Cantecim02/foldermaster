import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier
} from "@apple/app-store-server-library";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";

let contextsPromise;
let testAdapter;

export function setAppleStoreAdapterForTests(adapter) {
  testAdapter = adapter;
}

export function resetAppleStoreAdapterForTests() {
  testAdapter = undefined;
  contextsPromise = undefined;
}

export async function initializeAppleStoreService() {
  await getContexts();
}

export async function verifyAppleTransaction(signedTransactionInfo, environmentHint) {
  if (testAdapter?.verifyTransaction) {
    return testAdapter.verifyTransaction(signedTransactionInfo, environmentHint);
  }

  const contexts = prioritizeContexts(await getContexts(), environmentHint);
  let lastError;
  for (const context of contexts) {
    try {
      let transaction = await context.verifier.verifyAndDecodeTransaction(signedTransactionInfo);
      validateDecodedTransaction(transaction, context.environment);

      if (context.client && transaction.transactionId) {
        const authoritative = await context.client.getTransactionInfo(String(transaction.transactionId));
        if (authoritative?.signedTransactionInfo) {
          transaction = await context.verifier.verifyAndDecodeTransaction(authoritative.signedTransactionInfo);
          validateDecodedTransaction(transaction, context.environment);
        }
      }
      return transaction;
    } catch (error) {
      lastError = error;
    }
  }
  throw appleVerificationError(lastError);
}

export async function verifyAppleNotification(signedPayload) {
  if (testAdapter?.verifyNotification) {
    return testAdapter.verifyNotification(signedPayload);
  }

  let lastError;
  for (const context of await getContexts()) {
    try {
      const notification = await context.verifier.verifyAndDecodeNotification(signedPayload);
      return { notification, context };
    } catch (error) {
      lastError = error;
    }
  }
  throw appleVerificationError(lastError);
}

export async function verifyAppleNotificationTransaction(signedTransactionInfo, context) {
  if (testAdapter?.verifyNotificationTransaction) {
    return testAdapter.verifyNotificationTransaction(signedTransactionInfo, context?.environment);
  }
  const transaction = await context.verifier.verifyAndDecodeTransaction(signedTransactionInfo);
  validateDecodedTransaction(transaction, context.environment);
  return transaction;
}

export async function verifyAppleRenewalInfo(signedRenewalInfo, context) {
  if (testAdapter?.verifyRenewalInfo) {
    return testAdapter.verifyRenewalInfo(signedRenewalInfo, context?.environment);
  }
  return context.verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo);
}

async function getContexts() {
  if (!contextsPromise) contextsPromise = createContexts();
  return contextsPromise;
}

async function createContexts() {
  if (!config.monetizationEnabled) return [];
  const certificates = await readAppleRootCertificates();
  const signingKey = await readSigningKey();

  return config.appleIapEnvironments.map((environmentName) => {
    const environment = mapEnvironment(environmentName);
    const appAppleId = environment === Environment.PRODUCTION ? config.appleAppId : undefined;
    const verifier = new SignedDataVerifier(
      certificates,
      environment === Environment.PRODUCTION || environment === Environment.SANDBOX,
      environment,
      config.appleBundleId,
      appAppleId
    );
    const supportsApi = environment === Environment.PRODUCTION || environment === Environment.SANDBOX;
    const client = supportsApi && signingKey && config.appleIapKeyId && config.appleIapIssuerId
      ? new AppStoreServerAPIClient(
          signingKey,
          config.appleIapKeyId,
          config.appleIapIssuerId,
          config.appleBundleId,
          environment
        )
      : null;
    return { environment, verifier, client };
  });
}

async function readAppleRootCertificates() {
  if (!config.appleRootCaDirectory) {
    if (config.appleIapEnvironments.every((value) => value === "Xcode" || value === "LocalTesting")) {
      return [];
    }
    throw new Error("APPLE_ROOT_CA_DIRECTORY is required for Apple transaction verification.");
  }
  const entries = await readdir(config.appleRootCaDirectory, { withFileTypes: true });
  const certificatePaths = entries
    .filter((entry) => entry.isFile() && /\.(cer|der)$/i.test(entry.name))
    .map((entry) => path.join(config.appleRootCaDirectory, entry.name));
  if (certificatePaths.length === 0) {
    throw new Error("APPLE_ROOT_CA_DIRECTORY does not contain a DER-encoded .cer or .der certificate.");
  }
  return Promise.all(certificatePaths.map((filePath) => readFile(filePath)));
}

async function readSigningKey() {
  if (!config.appleIapPrivateKeyPath) return null;
  if (config.isProduction) {
    const metadata = await stat(config.appleIapPrivateKeyPath);
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error("APPLE_IAP_PRIVATE_KEY_PATH must not be readable by group or other users.");
    }
  }
  return readFile(config.appleIapPrivateKeyPath, "utf8");
}

function validateDecodedTransaction(transaction, expectedEnvironment) {
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
  if (transaction.environment !== expectedEnvironment) {
    throw new HttpError(400, "Apple transaction environment is invalid.", {
      code: "APPLE_ENVIRONMENT_MISMATCH"
    });
  }
  if (!transaction.transactionId || !transaction.originalTransactionId) {
    throw new HttpError(400, "Apple transaction identifiers are missing.", {
      code: "INVALID_APPLE_TRANSACTION"
    });
  }
}

function prioritizeContexts(contexts, environmentHint) {
  if (!environmentHint) return contexts;
  return [...contexts].sort((left, right) => {
    const leftMatches = left.environment === environmentHint ? 1 : 0;
    const rightMatches = right.environment === environmentHint ? 1 : 0;
    return rightMatches - leftMatches;
  });
}

function mapEnvironment(value) {
  const mapping = {
    Production: Environment.PRODUCTION,
    Sandbox: Environment.SANDBOX,
    Xcode: Environment.XCODE,
    LocalTesting: Environment.LOCAL_TESTING
  };
  return mapping[value];
}

function appleVerificationError(error) {
  if (error instanceof HttpError) return error;
  return new HttpError(400, "Apple could not verify this purchase.", {
    code: "APPLE_VERIFICATION_FAILED",
    cause: error
  });
}
