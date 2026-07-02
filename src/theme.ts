import { ColorSchemeName } from "react-native";

export type ThemeMode = "system" | "light" | "dark";

const light = {
  isDark: false,
  colors: {
    background: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceAlt: "#FAFAFA",
    text: "#262626",
    muted: "#8E8E8E",
    border: "#E0E0E0",
    primary: "#DD2A7B",
    primarySoft: "#FCE7F1",
    accent: "#8134AF",
    accentSoft: "#F2E8FA",
    success: "#22C55E",
    successSoft: "#E8F8EF",
    danger: "#E53935",
    dangerSoft: "#FFECEC",
    gradientStart: "#F58529",
    gradientMiddle: "#DD2A7B",
    gradientEnd: "#8134AF",
    onPrimary: "#ffffff"
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 20, xl: 28 },
  radius: { sm: 10, md: 16, lg: 22, xl: 30 }
};

const dark = {
  isDark: true,
  colors: {
    background: "#000000",
    surface: "#101010",
    surfaceAlt: "#181818",
    text: "#F5F5F5",
    muted: "#A8A8A8",
    border: "#2A2A2A",
    primary: "#DD2A7B",
    primarySoft: "#351324",
    accent: "#B65AD8",
    accentSoft: "#251031",
    success: "#4ADE80",
    successSoft: "#12351F",
    danger: "#FF6B6B",
    dangerSoft: "#3A1A1A",
    gradientStart: "#F58529",
    gradientMiddle: "#DD2A7B",
    gradientEnd: "#8134AF",
    onPrimary: "#FFFFFF"
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 20, xl: 28 },
  radius: { sm: 10, md: 16, lg: 22, xl: 30 }
};

export type AppTheme = typeof light;

export function getTheme(mode: ThemeMode, systemScheme: ColorSchemeName): AppTheme {
  const resolved = mode === "system" ? systemScheme : mode;
  return resolved === "dark" ? dark : light;
}
