import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
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

  useEffect(() => {
    Animated.timing(fill, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 260,
      useNativeDriver: false
    }).start();
  }, [fill, progress]);

  const width = fill.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"]
  });

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
  }
});
