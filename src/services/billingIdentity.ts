import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { AccountUser } from "./authService";

const installationIdKey = "editio.billingInstallationId.v1";
let webInstallationId: string | null = null;

export async function getBillingInstallationId() {
  if (Platform.OS === "web") {
    webInstallationId ??= Crypto.randomUUID();
    return webInstallationId;
  }

  const existing = await SecureStore.getItemAsync(installationIdKey);
  if (existing) return existing;

  const installationId = Crypto.randomUUID();
  await SecureStore.setItemAsync(installationIdKey, installationId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
  return installationId;
}

export async function getBillingIdentity(user: AccountUser | null) {
  const installationId = await getBillingInstallationId();
  return {
    installationId,
    appAccountToken: user?.appAccountToken || installationId
  };
}
