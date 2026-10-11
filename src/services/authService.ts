import axios from "axios";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getApiBaseUrl } from "./mediaDownloaderApi";
import { AuthApiError, normalizeAuthError } from "./authErrors";
import { registrationError, type RegistrationInput } from "./accountValidation";
export { AuthApiError } from "./authErrors";

// Same bundle ID shares Keychain: staging builds must never read/send a live token.
const sessionScope = process.env.EXPO_PUBLIC_FILE_BASKET_QA === 'true'
  ? '.qa.' + Array.from(String(getApiBaseUrl())).map(char => char.charCodeAt(0).toString(16)).join('-')
  : '';
const sessionTokenKey = `editio.accountSession${sessionScope}.v1`;
const sessionRevokedKey = `editio.accountSession.revoked${sessionScope}.v1`;
let webSessionToken: string | null = null;
let sessionSuppressed = false;
let sessionGeneration = 0;
const sessionListeners = new Set<() => void>();
export function subscribeAccountSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
function notifySessionChange() { for (const listener of sessionListeners) { try { listener(); } catch { /* UI listeners cannot prevent token cleanup. */ } } }

export type AccountDeletionResult = { serverDeleted: true; deviceCleanupPending: boolean };

export type AccountUser = {
  id: string;
  appAccountToken: string;
  username?: string;
  permissions?: { qaTester: boolean }; // Informational only; tools require a fresh server check.
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  subscriptionStatus: "free" | "premium";
  subscriptionExpireDate: string | null;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  createdAt: string;
};

export type ConversionHistoryItem = {
  id: string;
  fileName: string;
  from: string;
  to: string;
  fileSizeBytes: number;
  status: "completed" | "failed";
  createdAt: string;
};

type AuthResponse = {
  user: AccountUser;
  session: { token: string; expiresAt: string };
};

export async function getRegistrationPolicy() {
  try {
    const { data } = await axios.get<{ minimumAge: number; registrationVersion: number }>(`${getApiBaseUrl()}/auth/policy`, { timeout: 12_000 });
    if (!data || data.registrationVersion !== 2 || !Number.isInteger(data.minimumAge) || data.minimumAge < 13 || data.minimumAge > 18) throw new AuthApiError("REGISTRATION_UPDATE_REQUIRED");
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) throw new AuthApiError("REGISTRATION_UPDATE_REQUIRED");
    throw normalizeAuthError(error);
  }
}

export async function registerAccount(input: RegistrationInput) {
  const invalid = registrationError(input);
  if (invalid) throw new AuthApiError(invalid);
  try {
    const response = await axios.post<AuthResponse>(`${getApiBaseUrl()}/auth/register`, input, {
      timeout: 20_000
    });
    return await acceptAuthResponse(response.data);
  } catch (error) {
    throw normalizeAuthError(error);
  }
}

export async function loginAccount(email: string, password: string) {
  try {
    const response = await axios.post<AuthResponse>(`${getApiBaseUrl()}/auth/login`, { email, password }, {
      timeout: 20_000
    });
    return await acceptAuthResponse(response.data);
  } catch (error) {
    throw normalizeAuthError(error);
  }
}

export async function restoreAccountSession() {
  const generation = sessionGeneration;
  const token = await readSessionToken();
  if (!token) return null;

  try {
    const response = await axios.get<{ user: AccountUser }>(`${getApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 12_000
    });
    return generation === sessionGeneration && !sessionSuppressed ? response.data.user : null;
  } catch (error) {
    if (generation !== sessionGeneration) return null;
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      await clearSessionToken().catch(() => {}); // Remote session is invalid even if device cleanup fails.
      return null;
    }
    throw normalizeAuthError(error);
  }
}

export async function logoutAccount() {
  notifySessionChange(); // Close live tools before the network round trip or secure cleanup.
  try {
    const token = await readSessionToken();
    if (token) {
      await axios.post(`${getApiBaseUrl()}/auth/logout`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 12_000
      });
    }
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      throw normalizeAuthError(error);
    }
  } finally {
    await clearSessionToken();
  }
}

export async function deleteAccount(password: string) {
  const token = await readSessionToken();
  if (!token) throw new AuthApiError("AUTH_REQUIRED", "Authentication is required.");

  try {
    const response = await axios.delete(`${getApiBaseUrl()}/auth/account`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { password },
      timeout: 20_000
    });
    if (response.status !== 204) throw new AuthApiError("AUTH_INVALID_RESPONSE");
  } catch (error) {
    const normalized = normalizeAuthError(error);
    if (normalized.code === "NETWORK_ERROR" || normalized.code === "TIMEOUT") {
      throw new AuthApiError("ACCOUNT_DELETE_UNCONFIRMED");
    }
    throw normalized;
  }
  // A confirmed server deletion stays successful even if Keychain cleanup fails.
  let deviceCleanupPending = false;
  try { await clearSessionToken(); } catch { deviceCleanupPending = true; }
  return { serverDeleted: true, deviceCleanupPending } satisfies AccountDeletionResult;
}

export async function listConversionHistory(limit = 30) {
  const token = await readSessionToken();
  if (!token) throw new AuthApiError("AUTH_REQUIRED", "Authentication is required.");

  try {
    const response = await axios.get<{ success: true; items: ConversionHistoryItem[] }>(
      `${getApiBaseUrl()}/conversion-history`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: Math.max(1, Math.min(100, Math.trunc(limit))) },
        timeout: 12_000
      }
    );
    return response.data.items;
  } catch (error) {
    throw normalizeAuthError(error);
  }
}

export async function recordConversionHistory(input: {
  fileName: string;
  from: string;
  to: string;
  fileSizeBytes: number;
  status: "completed" | "failed";
}) {
  const token = await readSessionToken();
  if (!token) return null;

  try {
    const response = await axios.post<{ success: true; item: ConversionHistoryItem }>(
      `${getApiBaseUrl()}/conversion-history`,
      input,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 12_000
      }
    );
    return response.data.item;
  } catch (error) {
    throw normalizeAuthError(error);
  }
}

async function saveSessionToken(token: string) {
  sessionGeneration += 1;
  notifySessionChange();
  if (Platform.OS === "web") {
    webSessionToken = token;
    sessionSuppressed = false;
    return;
  }
  try {
    sessionSuppressed = true;
    await AsyncStorage.setItem(sessionRevokedKey, "true");
    await SecureStore.setItemAsync(sessionTokenKey, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    await AsyncStorage.removeItem(sessionRevokedKey);
    sessionSuppressed = false;
  } catch { throw new AuthApiError("SESSION_STORAGE_ERROR"); }
}

async function readSessionToken() {
  const generation = sessionGeneration;
  if (sessionSuppressed) return null;
  if (Platform.OS === "web") return webSessionToken;
  try {
    // This nonsecret tombstone survives restarts independently of Keychain deletion.
    if (await AsyncStorage.getItem(sessionRevokedKey) === "true") return null;
    const token = await SecureStore.getItemAsync(sessionTokenKey);
    return generation === sessionGeneration && !sessionSuppressed ? token : null;
  }
  catch { throw new AuthApiError("SESSION_STORAGE_ERROR"); }
}

export async function getAccountSessionToken() {
  return readSessionToken();
}

async function clearSessionToken() {
  sessionGeneration += 1;
  sessionSuppressed = true;
  notifySessionChange();
  if (Platform.OS === "web") {
    webSessionToken = null;
    return;
  }
  // Block reads immediately; attempt both persistence mechanisms independently.
  try { await AsyncStorage.setItem(sessionRevokedKey, "true"); } catch { /* Server deletion still invalidates the token remotely. */ }
  try { await SecureStore.deleteItemAsync(sessionTokenKey); }
  catch { throw new AuthApiError("SESSION_STORAGE_ERROR"); }
}


async function acceptAuthResponse(data: AuthResponse) {
  if (!data?.user || typeof data.user.id !== "string" || typeof data.user.email !== "string" ||
      typeof data.session?.token !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(data.session.token) ||
      !Number.isFinite(Date.parse(data.session.expiresAt))) throw new AuthApiError("AUTH_INVALID_RESPONSE");
  try { await saveSessionToken(data.session.token); }
  catch (error) {
    // A server session must not stay usable just because secure persistence failed.
    try { await axios.post(`${getApiBaseUrl()}/auth/logout`, undefined, { headers: { Authorization: `Bearer ${data.session.token}` }, timeout: 5_000 }); } catch { /* Remote expiry remains the fallback; never log credentials. */ }
    throw error;
  }
  return data.user;
}
