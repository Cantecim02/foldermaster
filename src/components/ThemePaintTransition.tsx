import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { AppTheme } from "../theme";

type Props = {
  label: string;
  onCovered: () => void;
  onFinished: () => void;
  targetTheme: AppTheme;
  visible: boolean;
};

export function ThemePaintTransition({ label, onCovered, onFinished, targetTheme, visible }: Props) {
  const { height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const onCoveredRef = useRef(onCovered);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onCoveredRef.current = onCovered;
    onFinishedRef.current = onFinished;
  }, [onCovered, onFinished]);

  useEffect(() => {
    if (!visible) return;

    progress.stopAnimation();
    progress.setValue(0);
    let covered = false;
    let cancelled = false;

    const animation = Animated.sequence([
      Animated.timing(progress, {
        duration: 430,
        easing: Easing.out(Easing.cubic),
        toValue: 0.5,
        useNativeDriver: true
      }),
      Animated.delay(120),
      Animated.timing(progress, {
        duration: 460,
        easing: Easing.inOut(Easing.cubic),
        toValue: 1,
        useNativeDriver: true
      })
    ]);

    const coverTimer = setTimeout(() => {
      covered = true;
      onCoveredRef.current();
    }, 430);

    animation.start(({ finished }) => {
      if (cancelled) return;
      if (!covered) onCoveredRef.current();
      if (finished) onFinishedRef.current();
    });

    return () => {
      cancelled = true;
      clearTimeout(coverTimer);
      animation.stop();
    };
  }, [progress, visible]);

  const sheetHeight = Math.max(height * 1.28, 720);
  const translateY = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [-sheetHeight, 0, sheetHeight]
  });
  const contentOpacity = progress.interpolate({
    inputRange: [0, 0.3, 0.44, 0.58, 0.78, 1],
    outputRange: [0, 0, 1, 1, 0, 0]
  });
  const contentScale = progress.interpolate({
    inputRange: [0.3, 0.5, 0.72],
    outputRange: [0.88, 1, 0.96],
    extrapolate: "clamp"
  });
  const colors = targetTheme.isDark
    ? (["#24101D", "#101014", "#000000"] as const)
    : (["#FFF4F9", "#FFFFFF", "#F6F1FA"] as const);

  return (
    <Modal
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
      transparent
      visible={visible}
    >
      <StatusBar barStyle={targetTheme.isDark ? "light-content" : "dark-content"} />
      <View accessibilityViewIsModal pointerEvents="auto" style={styles.stage}>
        <Animated.View
          style={[
            styles.paintSheet,
            {
              height: sheetHeight,
              top: (height - sheetHeight) / 2,
              transform: [{ translateY }]
            }
          ]}
        >
          <LinearGradient colors={colors} locations={[0, 0.48, 1]} style={styles.paintFill}>
            <View style={[styles.edgeAccent, { backgroundColor: targetTheme.colors.primary }]} />
            <Animated.View
              style={[
                styles.content,
                {
                  opacity: contentOpacity,
                  transform: [{ scale: contentScale }]
                }
              ]}
            >
              <View style={[styles.icon, { backgroundColor: targetTheme.colors.surface, borderColor: targetTheme.colors.border }]}>
                <Feather
                  color={targetTheme.colors.primary}
                  name={targetTheme.isDark ? "moon" : "sun"}
                  size={24}
                />
              </View>
              <Text style={[styles.label, { color: targetTheme.colors.text }]}>{label}</Text>
            </Animated.View>
          </LinearGradient>
          <View style={[styles.paintTrail, styles.paintTrailLeft, { backgroundColor: targetTheme.colors.primary }]} />
          <View style={[styles.paintTrail, styles.paintTrailRight, { backgroundColor: targetTheme.colors.accent }]} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    overflow: "hidden"
  },
  paintSheet: {
    borderBottomLeftRadius: 56,
    borderBottomRightRadius: 96,
    borderTopLeftRadius: 84,
    borderTopRightRadius: 48,
    left: 0,
    overflow: "visible",
    position: "absolute",
    right: 0
  },
  paintFill: {
    alignItems: "center",
    borderBottomLeftRadius: 56,
    borderBottomRightRadius: 96,
    borderTopLeftRadius: 84,
    borderTopRightRadius: 48,
    flex: 1,
    justifyContent: "center",
    overflow: "hidden"
  },
  edgeAccent: {
    bottom: 0,
    height: 5,
    left: 0,
    opacity: 0.92,
    position: "absolute",
    right: 0
  },
  paintTrail: {
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    bottom: -22,
    height: 28,
    opacity: 0.82,
    position: "absolute",
    width: "18%"
  },
  paintTrailLeft: {
    left: "14%"
  },
  paintTrailRight: {
    right: "9%"
  },
  content: {
    alignItems: "center",
    gap: 12
  },
  icon: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    width: 58
  },
  label: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0
  }
});
