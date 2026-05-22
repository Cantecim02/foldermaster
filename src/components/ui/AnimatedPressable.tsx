import { ReactNode, useRef } from "react";
import { Animated, GestureResponderEvent, Pressable, StyleProp, ViewStyle } from "react-native";

type Props = {
  children: ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
};

export function AnimatedPressable({ children, disabled, style, onPress }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) => {
    // Small scale feedback keeps touch interactions feeling responsive without moving layout.
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 24,
      bounciness: 5
    }).start();
  };

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animateTo(0.97)}
      onPressOut={() => animateTo(1)}
    >
      <Animated.View style={[style, { opacity: disabled ? 0.55 : 1, transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
