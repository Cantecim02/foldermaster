import { ReactNode, useRef } from "react";
import { Animated, GestureResponderEvent, Pressable, StyleProp, ViewStyle } from "react-native";
import { motionSpring } from "../../motion";

type Props = {
  children: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
};

export function AnimatedPressable({ children, containerStyle, disabled, style, onPress }: Props) {
  const pressed = useRef(new Animated.Value(0)).current;

  const animateTo = (value: number) => {
    pressed.stopAnimation();
    Animated.spring(pressed, {
      ...motionSpring,
      toValue: value,
      useNativeDriver: true
    }).start();
  };

  const scale = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] });
  const translateY = pressed.interpolate({ inputRange: [0, 1], outputRange: [0, 1.5] });
  const opacity = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animateTo(0.95)}
      onPressOut={() => animateTo(1)}
      style={containerStyle}
    >
      <Animated.View
        style={[
          style,
          {
            opacity: disabled ? 0.55 : opacity,
            transform: [{ translateY }, { scale }]
          }
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
