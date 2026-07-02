import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef } from "react";
import { Animated, DimensionValue, Easing, StyleSheet, Text, View } from "react-native";
import { AppTheme } from "../theme";

type Props = {
  label: string;
  letterText: string;
  progress: number;
  subtitle: string;
  theme: AppTheme;
};

export function ConversionLoader({ label, letterText, progress, subtitle, theme }: Props) {
  const rotate = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const percent = Math.round(clampedProgress * 100);
  const letters = useMemo(() => letterText.split(""), [letterText]);

  useEffect(() => {
    const rotationLoop = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 2100,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1050,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1050,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true
        })
      ])
    );

    rotationLoop.start();
    pulseLoop.start();
    return () => {
      rotationLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, rotate]);

  const rotation = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["90deg", "450deg"]
  });
  const haloScale = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.96, 1.04, 0.96]
  });
  const haloOpacity = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.72, 1, 0.72]
  });
  const progressWidth = useMemo<DimensionValue>(() => `${Math.max(3, percent)}%`, [percent]);

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
      <View style={styles.loaderWrap}>
        <Animated.View
          style={[
            styles.rotatingHalo,
            {
              opacity: haloOpacity,
              transform: [{ rotate: rotation }, { scale: haloScale }]
            }
          ]}
        >
          <LinearGradient
            colors={[
              "rgba(255,255,255,0.95)",
              theme.colors.gradientStart,
              theme.colors.gradientMiddle,
              theme.colors.gradientEnd
            ]}
            locations={[0, 0.32, 0.64, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.haloGradient}
          />
        </Animated.View>
        <View style={[styles.innerDisc, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.letterRow}>
            {letters.map((letter, index) => (
              <AnimatedLetter key={`${letter}-${index}`} index={index} pulse={pulse} theme={theme}>
                {letter}
              </AnimatedLetter>
            ))}
          </View>
          <Text style={[styles.percent, { color: theme.colors.text }]}>{percent}%</Text>
        </View>
      </View>

      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{subtitle}</Text>
      </View>

      <View style={[styles.track, { backgroundColor: theme.colors.border }]}>
        <View style={[styles.fillClip, { width: progressWidth }]}>
          <LinearGradient
            colors={[theme.colors.gradientStart, theme.colors.gradientMiddle, theme.colors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.fill}
          />
        </View>
      </View>
    </View>
  );
}

function AnimatedLetter({
  children,
  index,
  pulse,
  theme
}: {
  children: string;
  index: number;
  pulse: Animated.Value;
  theme: AppTheme;
}) {
  const delayed = pulse.interpolate({
    inputRange: [0, 0.12 + index * 0.055, 0.25 + index * 0.055, 1],
    outputRange: [0.42, 1, 0.68, 0.42],
    extrapolate: "clamp"
  });
  const scale = pulse.interpolate({
    inputRange: [0, 0.12 + index * 0.055, 0.25 + index * 0.055, 1],
    outputRange: [1, 1.16, 1, 1],
    extrapolate: "clamp"
  });

  return (
    <Animated.Text
      style={[
        styles.letter,
        {
          color: theme.colors.text,
          opacity: delayed,
          transform: [{ scale }]
        }
      ]}
    >
      {children}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    borderRadius: 26,
    borderWidth: 1,
    gap: 12,
    padding: 14
  },
  loaderWrap: {
    alignItems: "center",
    height: 132,
    justifyContent: "center",
    width: 132
  },
  rotatingHalo: {
    borderRadius: 999,
    height: 132,
    padding: 8,
    position: "absolute",
    width: 132
  },
  haloGradient: {
    borderRadius: 999,
    flex: 1
  },
  innerDisc: {
    alignItems: "center",
    borderRadius: 999,
    height: 102,
    justifyContent: "center",
    shadowColor: "#DD2A7B",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    width: 102
  },
  letterRow: {
    flexDirection: "row"
  },
  letter: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0
  },
  percent: {
    fontSize: 18,
    fontWeight: "900",
    marginTop: 6
  },
  copy: {
    alignItems: "center",
    gap: 3
  },
  title: {
    fontSize: 16,
    fontWeight: "900"
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "800"
  },
  track: {
    borderRadius: 999,
    height: 7,
    overflow: "hidden",
    width: "100%"
  },
  fillClip: {
    borderRadius: 999,
    height: "100%",
    minWidth: 12,
    overflow: "hidden"
  },
  fill: {
    height: "100%",
    width: "100%"
  }
});
