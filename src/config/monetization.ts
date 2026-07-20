import { Platform } from "react-native";

const monthlyProductId =
  process.env.EXPO_PUBLIC_EDITIO_MONTHLY_PRODUCT_ID?.trim() ||
  "com.cantecim.editio.pro.monthly";
const yearlyProductId =
  process.env.EXPO_PUBLIC_EDITIO_YEARLY_PRODUCT_ID?.trim() ||
  "com.cantecim.editio.pro.yearly";

export const monetizationConfig = Object.freeze({
  enabled: process.env.EXPO_PUBLIC_MONETIZATION_ENABLED === "true" && Platform.OS === "ios",
  platformSupported: Platform.OS === "ios",
  products: Object.freeze({
    monthly: monthlyProductId,
    yearly: yearlyProductId,
    all: Object.freeze([monthlyProductId, yearlyProductId])
  }),
  urls: Object.freeze({
    privacy: "https://editioapp.com/privacy",
    terms: "https://editioapp.com/terms"
  })
});

export type EditioPlan = "monthly" | "yearly";

export function planForProductId(productId: string | null | undefined): EditioPlan | null {
  if (productId === monetizationConfig.products.monthly) return "monthly";
  if (productId === monetizationConfig.products.yearly) return "yearly";
  return null;
}
