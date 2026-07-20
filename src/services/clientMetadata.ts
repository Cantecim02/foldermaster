import * as Application from "expo-application";
import { Platform } from "react-native";

const billingProtocolVersion = "1";

export function getEditioClientHeaders() {
  return {
    "x-editio-client-platform": Platform.OS,
    "x-editio-client-build": Application.nativeBuildVersion ?? "0",
    "x-editio-billing-version": billingProtocolVersion,
    "x-editio-monetization-capable": String(
      process.env.EXPO_PUBLIC_MONETIZATION_ENABLED === "true" && Platform.OS === "ios"
    )
  };
}
