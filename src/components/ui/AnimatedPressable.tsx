import { ReactNode, useRef } from "react";
import { Animated, GestureResponderEvent, Pressable, StyleProp, ViewStyle } from "react-native";

type Props = {
  children: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
};

export function AnimatedPressable({ children, containerStyle, disabled, style, onPress }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) => {
    // Small scale feedback keeps touch interactions feeling responsive without moving layout.
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 28,
      bounciness: 6
    }).start();
  };

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animateTo(0.95)}
      onPressOut={() => animateTo(1)}
      style={containerStyle}
    >
      <Animated.View style={[style, { opacity: disabled ? 0.55 : 1, transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
