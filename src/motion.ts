import { Easing } from "react-native";

export const motionDuration = {
  instant: 140,
  quick: 220,
  standard: 340,
  reveal: 460,
  ambient: 2200
} as const;

export const motionEasing = {
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  exit: Easing.bezier(0.7, 0, 0.84, 0),
  standard: Easing.bezier(0.2, 0.8, 0.2, 1),
  linear: Easing.linear
} as const;

export const motionSpring = {
  damping: 20,
  mass: 0.82,
  stiffness: 240
} as const;

// Native Modal remains mounted while MotionModal plays its exit animation.
// Waiting for that exit before opening another modal prevents iOS from
// dropping the next modal or native share sheet.
export const modalExitWaitMs = motionDuration.quick + 80;

export function waitForModalExit() {
  return new Promise<void>((resolve) => setTimeout(resolve, modalExitWaitMs));
}
