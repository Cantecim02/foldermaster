import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { motionDuration, motionEasing } from "../motion";
import { AppTheme } from "../theme";
import { InstagramGradient } from "./ui/InstagramGradient";

type Props = {
  progress: number;
  label: string;
  theme: AppTheme;
};

export function ProgressBar({ progress, label, theme }: Props) {
  const percent = Math.round(progress * 100);
  const fill = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fill, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: motionDuration.reveal,
      easing: motionEasing.standard,
      useNativeDriver: false
    }).start();
  }, [fill, progress]);

  useEffect(() => {
    if (progress <= 0 || progress >= 1) {
      shimmer.stopAnimation();
      shimmer.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          duration: 1100,
          easing: motionEasing.standard,
          toValue: 1,
          useNativeDriver: true
        }),
        Animated.delay(320)
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [progress, shimmer]);

  const width = fill.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"]
  });
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-54, 360] });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: theme.colors.muted }]}>{label}</Text>
        <Text style={[styles.percent, { color: theme.colors.text }]}>{percent}%</Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
        <Animated.View
          style={[
            styles.fill,
            { width }
          ]}
        >
          <InstagramGradient theme={theme} style={styles.gradientFill} />
          <Animated.View style={[styles.shimmer, { transform: [{ translateX: shimmerX }, { skewX: "-18deg" }] }]} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  label: {
    fontSize: 13,
    fontWeight: "800"
  },
  percent: {
    fontSize: 13,
    fontWeight: "800"
  },
  track: {
    borderRadius: 999,
    borderWidth: 1,
    height: 12,
    overflow: "hidden"
  },
  fill: {
    borderRadius: 999,
    height: "100%",
    overflow: "hidden"
  },
  gradientFill: {
    height: "100%",
    width: "100%"
  },
  shimmer: {
    backgroundColor: "rgba(255,255,255,0.55)",
    bottom: 0,
    position: "absolute",
    top: 0,
    width: 34
  }
});
