import axios from "axios";
import type { AccountUser } from "./authService";
import { getAccountSessionToken } from "./authService";
import { getBillingIdentity } from "./billingIdentity";
import { getEditioClientHeaders } from "./clientMetadata";
import { getApiBaseUrl } from "./mediaDownloaderApi";

export type BillingSnapshot = {
  monetizationEnabled: boolean;
  active: boolean;
  status: string;
  productId: string | null;
  expiresAt: string | null;
  gracePeriodExpiresAt?: string | null;
  autoRenewStatus: boolean | null;
  freeLimit: number;
  usedFreeConversions: number;
  reservedFreeConversions: number;
  remainingFreeConversions: number;
  canConvert: boolean;
  appAccountToken: string;
};

export type ConversionAuthorization = {
  id: string | null;
  operationId: string;
  allowed: boolean;
  consumesFreeCredit: boolean;
  expiresAt?: string;
  entitlement: BillingSnapshot;
};

export type BillingRequestContext = {
  installationId: string;
  authorizationId: string | null;
  sessionToken: string | null;
};

export class BillingApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null = null,
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = "BillingApiError";
  }
}

export async function getBillingSnapshot(user: AccountUser | null) {
  const request = await billingRequestIdentity(user);
  try {
    const response = await axios.get<{ success: true } & BillingSnapshot>(
      `${getApiBaseUrl()}/billing/entitlement`,
      { headers: request.headers, timeout: 12_000 }
    );
    return stripSuccess(response.data);
  } catch (error) {
    throw normalizeBillingError(error);
  }
}

export async function authorizeConversion(user: AccountUser | null, input: {
  operationId: string;
  conversionType: string;
}) {
  const request = await billingRequestIdentity(user);
  try {
    const response = await axios.post<{ success: true; authorization: ConversionAuthorization }>(
      `${getApiBaseUrl()}/billing/conversion-authorizations`,
      { ...input, installationId: request.installationId },
      { headers: request.headers, timeout: 12_000 }
    );
    return {
      authorization: response.data.authorization,
      context: {
        installationId: request.installationId,
        authorizationId: response.data.authorization.id,
        sessionToken: request.sessionToken
      } satisfies BillingRequestContext
    };
  } catch (error) {
    throw normalizeBillingError(error);
  }
}

export async function completeConversionAuthorization(
  user: AccountUser | null,
  authorizationId: string | null
) {
  if (!authorizationId) return getBillingSnapshot(user);
  const request = await billingRequestIdentity(user);
  try {
    const response = await axios.post<{ success: true; entitlement: BillingSnapshot }>(
      `${getApiBaseUrl()}/billing/conversion-authorizations/${encodeURIComponent(authorizationId)}/complete`,
      { installationId: request.installationId },
      { headers: request.headers, timeout: 12_000 }
    );
    return response.data.entitlement;
  } catch (error) {
    throw normalizeBillingError(error);
  }
}

export async function releaseConversionAuthorization(
  user: AccountUser | null,
  authorizationId: string | null
) {
  if (!authorizationId) return getBillingSnapshot(user);
  const request = await billingRequestIdentity(user);
  try {
    const response = await axios.post<{ success: true; entitlement: BillingSnapshot }>(
      `${getApiBaseUrl()}/billing/conversion-authorizations/${encodeURIComponent(authorizationId)}/release`,
      { installationId: request.installationId },
      { headers: request.headers, timeout: 12_000 }
    );
    return response.data.entitlement;
  } catch (error) {
    throw normalizeBillingError(error);
  }
}

export async function verifyAppleTransaction(user: AccountUser | null, input: {
  signedTransactionInfo: string;
  environment?: string | null;
  restore?: boolean;
}) {
  const request = await billingRequestIdentity(user);
  try {
    const response = await axios.post<{ success: true; entitlement: BillingSnapshot }>(
      `${getApiBaseUrl()}/billing/apple/transactions/verify`,
      {
        signedTransactionInfo: input.signedTransactionInfo,
        environment: normalizeAppleEnvironment(input.environment),
        restore: Boolean(input.restore),
        installationId: request.installationId
      },
      { headers: request.headers, timeout: 20_000 }
    );
    return response.data.entitlement;
  } catch (error) {
    throw normalizeBillingError(error);
  }
}

async function billingRequestIdentity(user: AccountUser | null) {
  const [{ installationId }, sessionToken] = await Promise.all([
    getBillingIdentity(user),
    getAccountSessionToken()
  ]);
  return {
    installationId,
    sessionToken,
    headers: {
      ...getEditioClientHeaders(),
      "x-editio-installation-id": installationId,
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    }
  };
}

function normalizeAppleEnvironment(environment: string | null | undefined) {
  if (!environment) return undefined;
  const normalized = environment.toLowerCase();
  if (normalized.includes("sandbox")) return "Sandbox";
  if (normalized.includes("production")) return "Production";
  if (normalized.includes("xcode")) return "Xcode";
  if (normalized.includes("local")) return "LocalTesting";
  return undefined;
}

function stripSuccess(value: { success: true } & BillingSnapshot): BillingSnapshot {
  const { success: _success, ...snapshot } = value;
  return snapshot;
}

function normalizeBillingError(error: unknown) {
  if (error instanceof BillingApiError) return error;
  if (!axios.isAxiosError(error)) {
    return new BillingApiError("UNKNOWN", "Billing request failed.");
  }
  const payload = error.response?.data as {
    code?: string;
    message?: string;
    error?: string;
    details?: unknown;
  } | undefined;
  if (!error.response) {
    return new BillingApiError(
      "NETWORK_ERROR",
      "An internet connection is required to verify your free usage allowance."
    );
  }
  return new BillingApiError(
    payload?.code ?? `HTTP_${error.response.status}`,
    payload?.message ?? payload?.error ?? "Billing request failed.",
    error.response.status,
    payload?.details ?? null
  );
}
