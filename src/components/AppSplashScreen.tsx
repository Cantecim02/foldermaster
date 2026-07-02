import { Image } from "expo-image";
import { Animated, StyleSheet, Text, View } from "react-native";
import { AppTheme } from "../theme";
import { InstagramGradient } from "./ui/InstagramGradient";

const splashLogo = require("../../assets/branding/foldermaster-launch-clean.png");

type Props = {
  opacity: Animated.Value;
  progress: Animated.Value;
  scale: Animated.Value;
  translateY: Animated.Value;
  theme: AppTheme;
  subtitle: string;
};

export function AppSplashScreen({ opacity, progress, scale, translateY, theme, subtitle }: Props) {
  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["8%", "100%"]
  });

  return (
    <Animated.View
      pointerEvents="auto"
      style={[
        styles.overlay,
        {
          opacity,
          transform: [{ scale }, { translateY }]
        }
      ]}
    >
      <InstagramGradient theme={theme} style={styles.background}>
        <View style={styles.center}>
          <View style={styles.logoOuter}>
            <View style={styles.logoInner}>
              <Image source={splashLogo} style={styles.logoImage} contentFit="contain" />
            </View>
          </View>
          <Text style={styles.name}>Editio</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <View style={styles.loadingTrack}>
            <Animated.View style={[styles.loadingFill, { width: progressWidth }]} />
          </View>
        </View>
      </InstagramGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20
  },
  background: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  center: {
    alignItems: "center"
  },
  logoOuter: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderColor: "rgba(255,255,255,0.36)",
    borderRadius: 44,
    borderWidth: 1,
    height: 148,
    justifyContent: "center",
    marginBottom: 18,
    width: 148
  },
  logoInner: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 36,
    height: 128,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: 128
  },
  logoImage: {
    borderRadius: 32,
    height: 126,
    width: 126
  },
  name: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 0
  },
  subtitle: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
    marginTop: 6,
    textTransform: "uppercase"
  },
  loadingTrack: {
    backgroundColor: "rgba(255,255,255,0.24)",
    borderRadius: 999,
    height: 5,
    marginTop: 28,
    overflow: "hidden",
    width: 172
  },
  loadingFill: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    height: "100%"
  }
});
