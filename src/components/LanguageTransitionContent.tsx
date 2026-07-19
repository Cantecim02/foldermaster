import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { motionDuration, motionEasing } from "../motion";
import { AppTheme } from "../theme";
import { InstagramGradient } from "./ui/InstagramGradient";

const brandVisual = require("../../assets/branding/foldermaster-launch-clean.png");

type Props = {
  progress: Animated.Value;
  subtitle: string;
  theme: AppTheme;
  title: string;
};

export function LanguageTransitionContent({ progress, subtitle, theme, title }: Props) {
  const reveal = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const revealAnimation = Animated.timing(reveal, {
      duration: motionDuration.reveal,
      easing: motionEasing.enter,
      toValue: 1,
      useNativeDriver: true
    });
    const orbitAnimation = Animated.loop(
      Animated.timing(orbit, {
        duration: 4200,
        easing: motionEasing.linear,
        toValue: 1,
        useNativeDriver: true
      })
    );
    const sweepAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          duration: 1200,
          easing: motionEasing.standard,
          toValue: 1,
          useNativeDriver: true
        }),
        Animated.delay(420)
      ])
    );
    revealAnimation.start();
    orbitAnimation.start();
    sweepAnimation.start();
    return () => {
      revealAnimation.stop();
      orbitAnimation.stop();
      sweepAnimation.stop();
    };
  }, [orbit, reveal, sweep]);

  const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["4%", "100%"] });
  const opacity = reveal.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 0, 1] });
  const translateY = reveal.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const scale = reveal.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const rotation = orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-110, 190] });

  return (
    <View style={[styles.overlay, { backgroundColor: theme.colors.background }]}>
      <Animated.View style={[styles.content, { opacity, transform: [{ translateY }] }]}>
        <Animated.View style={[styles.logoStage, { transform: [{ scale }] }]}>
          <Animated.View style={[styles.orbit, { borderColor: theme.colors.primary, transform: [{ rotate: rotation }] }]}>
            <View style={[styles.orbitDash, { backgroundColor: theme.colors.accent }]} />
            <View style={[styles.orbitDash, styles.orbitDashSecond, { backgroundColor: theme.colors.gradientStart }]} />
          </Animated.View>
          <View style={[styles.logoFrame, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Image contentFit="contain" source={brandVisual} style={styles.logo} />
            <Animated.View style={[styles.logoSweep, { transform: [{ translateX: sweepX }, { rotate: "-18deg" }] }]} />
          </View>
        </Animated.View>
        <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{subtitle}</Text>
        <View style={[styles.track, { backgroundColor: theme.colors.border }]}>
          <Animated.View style={[styles.fillClip, { width: progressWidth }]}>
            <InstagramGradient style={styles.fill} theme={theme} />
            <Animated.View style={[styles.progressSweep, { transform: [{ translateX: sweepX }, { skewX: "-18deg" }] }]} />
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  content: {
    alignItems: "center",
    width: "100%"
  },
  logoStage: {
    alignItems: "center",
    height: 150,
    justifyContent: "center",
    marginBottom: 22,
    width: 150
  },
  orbit: {
    borderRadius: 999,
    borderWidth: 1,
    height: 150,
    opacity: 0.72,
    position: "absolute",
    width: 150
  },
  orbitDash: {
    borderRadius: 3,
    height: 5,
    left: 11,
    position: "absolute",
    top: 28,
    transform: [{ rotate: "-42deg" }],
    width: 24
  },
  orbitDashSecond: {
    bottom: 24,
    left: undefined,
    right: 9,
    top: undefined
  },
  logoFrame: {
    borderRadius: 34,
    borderWidth: 1,
    height: 118,
    overflow: "hidden",
    shadowColor: "#DD2A7B",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    width: 118
  },
  logo: {
    height: "100%",
    width: "100%"
  },
  logoSweep: {
    backgroundColor: "rgba(255,255,255,0.58)",
    height: 180,
    position: "absolute",
    top: -28,
    width: 26
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0,
    textAlign: "center"
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 6,
    textAlign: "center"
  },
  track: {
    borderRadius: 999,
    height: 7,
    marginTop: 24,
    maxWidth: 280,
    overflow: "hidden",
    width: "72%"
  },
  fillClip: {
    borderRadius: 999,
    height: "100%",
    overflow: "hidden"
  },
  fill: {
    height: "100%",
    width: "100%"
  },
  progressSweep: {
    backgroundColor: "rgba(255,255,255,0.62)",
    bottom: 0,
    position: "absolute",
    top: 0,
    width: 24
  }
});
