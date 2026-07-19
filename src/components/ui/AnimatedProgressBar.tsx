import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { motionDuration, motionEasing } from "../../motion";
import { AppTheme } from "../../theme";

type Props = {
  progress: number;
  label: string;
  theme: AppTheme;
};

export function AnimatedProgressBar({ progress, label, theme }: Props) {
  const width = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(1, progress));

  useEffect(() => {
    Animated.timing(width, {
      toValue: clamped,
      duration: motionDuration.reveal,
      easing: motionEasing.standard,
      useNativeDriver: false
    }).start();
  }, [clamped, width]);

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.timing(glow, {
        duration: motionDuration.quick,
        easing: motionEasing.enter,
        toValue: 1,
        useNativeDriver: true
      }),
      Animated.timing(glow, {
        duration: motionDuration.standard,
        easing: motionEasing.exit,
        toValue: 0,
        useNativeDriver: true
      })
    ]);
    animation.start();
    return () => animation.stop();
  }, [clamped, glow]);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.colors.muted }]}>{label}</Text>
        <Text style={[styles.percent, { color: theme.colors.text }]}>{Math.round(clamped * 100)}%</Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: theme.colors.primary,
              width: width.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"]
              })
            }
          ]}
          >
            <View style={[styles.fillAccent, { backgroundColor: theme.colors.accent }]} />
            <Animated.View style={[styles.progressGlow, { opacity: glow, transform: [{ scaleX: glow }] }]} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  label: {
    fontSize: 13,
    fontWeight: "800"
  },
  percent: {
    fontSize: 13,
    fontWeight: "900"
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
  fillAccent: {
    bottom: 0,
    opacity: 0.35,
    position: "absolute",
    right: 0,
    top: 0,
    width: 42
  },
  progressGlow: {
    backgroundColor: "rgba(255,255,255,0.5)",
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 26
  }
});
