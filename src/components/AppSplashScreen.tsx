import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
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
  const logoReveal = useRef(new Animated.Value(0)).current;
  const copyReveal = useRef(new Animated.Value(0)).current;
  const lightSweep = useRef(new Animated.Value(0)).current;
  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["8%", "100%"]
  });

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.spring(logoReveal, {
        bounciness: 5,
        speed: 15,
        toValue: 1,
        useNativeDriver: true
      }),
      Animated.sequence([
        Animated.delay(150),
        Animated.timing(copyReveal, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true
        })
      ]),
      Animated.sequence([
        Animated.delay(280),
        Animated.timing(lightSweep, {
          duration: 780,
          easing: Easing.inOut(Easing.cubic),
          toValue: 1,
          useNativeDriver: true
        })
      ])
    ]);

    animation.start();
    return () => animation.stop();
  }, [copyReveal, lightSweep, logoReveal]);

  const logoScale = logoReveal.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const logoRotate = logoReveal.interpolate({ inputRange: [0, 1], outputRange: ["-4deg", "0deg"] });
  const copyTranslateY = copyReveal.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const sweepTranslateX = lightSweep.interpolate({ inputRange: [0, 1], outputRange: [-190, 190] });
  const sweepOpacity = lightSweep.interpolate({
    inputRange: [0, 0.12, 0.78, 1],
    outputRange: [0, 0.68, 0.36, 0]
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
          <Animated.View
            style={[
              styles.logoMotion,
              {
                opacity: logoReveal,
                transform: [{ scale: logoScale }, { rotate: logoRotate }]
              }
            ]}
          >
            <View style={styles.logoOuter}>
              <View style={styles.logoInner}>
                <Image source={splashLogo} style={styles.logoImage} contentFit="contain" />
              </View>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.lightSweep,
                  {
                    opacity: sweepOpacity,
                    transform: [{ translateX: sweepTranslateX }, { rotate: "-16deg" }]
                  }
                ]}
              />
            </View>
          </Animated.View>
          <Animated.View
            style={[
              styles.copy,
              {
                opacity: copyReveal,
                transform: [{ translateY: copyTranslateY }]
              }
            ]}
          >
            <Text style={styles.name}>Editio</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            <View style={styles.loadingTrack}>
              <Animated.View style={[styles.loadingFill, { width: progressWidth }]} />
            </View>
          </Animated.View>
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
  logoMotion: {
    marginBottom: 18
  },
  logoOuter: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderColor: "rgba(255,255,255,0.36)",
    borderRadius: 44,
    borderWidth: 1,
    height: 148,
    justifyContent: "center",
    overflow: "hidden",
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
  lightSweep: {
    backgroundColor: "rgba(255,255,255,0.72)",
    height: 210,
    position: "absolute",
    width: 30
  },
  copy: {
    alignItems: "center"
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
