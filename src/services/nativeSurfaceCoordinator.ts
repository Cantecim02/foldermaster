import { Platform } from "react-native";

type NativeSurfaceOptions = {
  waitBeforeOpen?: boolean;
};

let nativeSurfaceActive = false;

// iOS can reject a second picker/modal while the previous native controller is
// still completing its dismissal animation. Keep every native surface in one
// lane and give the controller a frame to settle before React Native continues.
export async function runNativeSurface<T>(
  operation: () => Promise<T>,
  options: NativeSurfaceOptions = {}
): Promise<T | null> {
  if (nativeSurfaceActive) return null;

  nativeSurfaceActive = true;
  try {
    if (options.waitBeforeOpen) {
      await waitForNativeSurfaceExit();
    }

    return await operation();
  } finally {
    await waitForNativeSurfaceExit();
    nativeSurfaceActive = false;
  }
}

export function waitForNativeSurfaceExit() {
  if (Platform.OS === "web") return Promise.resolve();

  const settleMs = Platform.OS === "ios" ? 280 : 160;
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, settleMs));
  });
}
