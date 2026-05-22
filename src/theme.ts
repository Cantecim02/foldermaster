import { ColorSchemeName } from "react-native";

export type ThemeMode = "system" | "light" | "dark";

const light = {
  isDark: false,
  colors: {
    background: "#f7fafc",
    surface: "#ffffff",
    surfaceAlt: "#eef3f8",
    text: "#101828",
    muted: "#667085",
    border: "#cfd8e3",
    primary: "#2563eb",
    primarySoft: "#dbeafe",
    accent: "#0fbc8f",
    accentSoft: "#d1fae5",
    success: "#079455",
    danger: "#dc2626",
    dangerSoft: "#fee2e2",
    onPrimary: "#ffffff"
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 22, xl: 28 },
  radius: { sm: 10, md: 14, lg: 18, xl: 24 }
};

const dark = {
  isDark: true,
  colors: {
    background: "#080f1f",
    surface: "#111827",
    surfaceAlt: "#1f2937",
    text: "#f8fafc",
    muted: "#a7b2c3",
    border: "#334155",
    primary: "#38bdf8",
    primarySoft: "#0c3047",
    accent: "#34d399",
    accentSoft: "#0f3b31",
    success: "#32d583",
    danger: "#ff6b6b",
    dangerSoft: "#3b1822",
    onPrimary: "#04111f"
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 22, xl: 28 },
  radius: { sm: 10, md: 14, lg: 18, xl: 24 }
};

export type AppTheme = typeof light;

export function getTheme(mode: ThemeMode, systemScheme: ColorSchemeName): AppTheme {
  const resolved = mode === "system" ? systemScheme : mode;
  return resolved === "dark" ? dark : light;
}
