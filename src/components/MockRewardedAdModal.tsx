import { useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { finishMockRewardedAd } from "../services/rewardedAdService";
import { AppTheme } from "../theme";

type Props = {
  visible: boolean;
  labels: {
    title: string;
    body: string;
    seconds: string;
  };
  theme: AppTheme;
  onComplete: () => void;
};

export function MockRewardedAdModal({ visible, labels, theme, onComplete }: Props) {
  const [remaining, setRemaining] = useState(3);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    completedRef.current = false;
    setRemaining(3);
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          if (!completedRef.current) {
            completedRef.current = true;
            setTimeout(() => {
              finishMockRewardedAd();
              onComplete();
            }, 0);
          }
          return 0;
        }
        return value - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onComplete, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.title, { color: theme.colors.text }]}>{labels.title}</Text>
          <Text style={[styles.body, { color: theme.colors.muted }]}>{labels.body}</Text>
          <View style={[styles.counter, { backgroundColor: theme.colors.primarySoft }]}>
            <Text style={[styles.counterText, { color: theme.colors.primary }]}>
              {remaining} {labels.seconds}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.58)",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  card: {
    borderRadius: 8,
    gap: 14,
    maxWidth: 360,
    padding: 22,
    width: "100%"
  },
  title: {
    fontSize: 24,
    fontWeight: "900"
  },
  body: {
    fontSize: 15,
    lineHeight: 22
  },
  counter: {
    alignItems: "center",
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center"
  },
  counterText: {
    fontSize: 16,
    fontWeight: "900"
  }
});
