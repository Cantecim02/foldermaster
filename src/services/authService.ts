import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getApiBaseUrl } from "./mediaDownloaderApi";

const sessionTokenKey = "editio.accountSession.v1";
let webSessionToken: string | null = null;

export type AccountUser = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  createdAt: string;
};

type AuthResponse = {
  user: AccountUser;
  session: { token: string; expiresAt: string };
};

export class AuthApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AuthApiError";
  }
}

export async function registerAccount(input: {
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  password: string;
  acceptedTerms: true;
}) {
  try {
    const response = await axios.post<AuthResponse>(`${getApiBaseUrl()}/auth/register`, input, {
      timeout: 20_000
    });
    await saveSessionToken(response.data.session.token);
    return response.data.user;
  } catch (error) {
    throw normalizeAuthError(error);
  }
}

export async function loginAccount(email: string, password: string) {
  try {
    const response = await axios.post<AuthResponse>(`${getApiBaseUrl()}/auth/login`, { email, password }, {
      timeout: 20_000
    });
    await saveSessionToken(response.data.session.token);
    return response.data.user;
  } catch (error) {
    throw normalizeAuthError(error);
  }
}

export async function restoreAccountSession() {
  const token = await readSessionToken();
  if (!token) return null;

  try {
    const response = await axios.get<{ user: AccountUser }>(`${getApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 12_000
    });
    return response.data.user;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      await clearSessionToken();
      return null;
    }
    throw normalizeAuthError(error);
  }
}

export async function logoutAccount() {
  const token = await readSessionToken();
  try {
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
    await axios.delete(`${getApiBaseUrl()}/auth/account`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { password },
      timeout: 20_000
    });
    await clearSessionToken();
  } catch (error) {
    throw normalizeAuthError(error);
  }
}

async function saveSessionToken(token: string) {
  if (Platform.OS === "web") {
    webSessionToken = token;
    return;
  }
  await SecureStore.setItemAsync(sessionTokenKey, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

async function readSessionToken() {
  if (Platform.OS === "web") return webSessionToken;
  return SecureStore.getItemAsync(sessionTokenKey);
}

async function clearSessionToken() {
  if (Platform.OS === "web") {
    webSessionToken = null;
    return;
  }
  await SecureStore.deleteItemAsync(sessionTokenKey);
}

function normalizeAuthError(error: unknown) {
  if (error instanceof AuthApiError) return error;
  if (!axios.isAxiosError(error)) return new AuthApiError("UNKNOWN", "Account request failed.");

  const payload = error.response?.data as { code?: string; message?: string; error?: string } | undefined;
  if (!error.response) return new AuthApiError("NETWORK_ERROR", "Account service is unavailable.");
  return new AuthApiError(
    payload?.code ?? `HTTP_${error.response.status}`,
    payload?.message ?? payload?.error ?? "Account request failed."
  );
}
