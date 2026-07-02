import { LinearGradient } from "expo-linear-gradient";
import { ReactNode } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { AppTheme } from "../../theme";

type Props = {
  children?: ReactNode;
  theme: AppTheme;
  style?: StyleProp<ViewStyle>;
};

export function InstagramGradient({ children, theme, style }: Props) {
  return (
    <LinearGradient
      colors={[
        theme.colors.gradientStart,
        theme.colors.gradientMiddle,
        theme.colors.gradientEnd
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
