import { ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  ModalProps,
  StyleSheet
} from "react-native";
import { motionDuration, motionEasing } from "../../motion";

type MotionVariant = "dialog" | "fade" | "fullscreen" | "sheet";

type Props = {
  children: ReactNode;
  onRequestClose?: () => void;
  variant?: MotionVariant;
  visible: boolean;
} & Pick<
  ModalProps,
  "presentationStyle" | "statusBarTranslucent" | "supportedOrientations" | "transparent"
>;

export function MotionModal({
  children,
  onRequestClose,
  presentationStyle,
  statusBarTranslucent,
  supportedOrientations,
  transparent = true,
  variant = "dialog",
  visible
}: Props) {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    progress.stopAnimation();

    if (visible) {
      setMounted(true);
      progress.setValue(0);
      const frame = requestAnimationFrame(() => {
        Animated.timing(progress, {
          duration: variant === "fullscreen" ? motionDuration.reveal : motionDuration.standard,
          easing: motionEasing.enter,
          toValue: 1,
          useNativeDriver: true
        }).start();
      });
      return () => cancelAnimationFrame(frame);
    }

    if (!mounted) return;
    Animated.timing(progress, {
      duration: motionDuration.quick,
      easing: motionEasing.exit,
      toValue: 0,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [mounted, progress, variant, visible]);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [variant === "sheet" ? 72 : variant === "fullscreen" ? 10 : 18, 0]
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [variant === "dialog" ? 0.94 : variant === "fullscreen" ? 1.018 : 0.985, 1]
  });

  return (
    <Modal
      animationType="none"
      onRequestClose={onRequestClose}
      presentationStyle={presentationStyle}
      statusBarTranslucent={statusBarTranslucent}
      supportedOrientations={supportedOrientations}
      transparent={transparent}
      visible={mounted}
    >
      <Animated.View
        style={[
          styles.stage,
          {
            opacity: progress,
            transform: variant === "fade" ? undefined : [{ translateY }, { scale }]
          }
        ]}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1
  }
});
