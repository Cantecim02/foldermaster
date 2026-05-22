import { Platform } from "react-native";
import { useAdStore } from "../stores/adStore";

type MockAdController = {
  openMockAd: () => void;
};

let mockAdPromise: Promise<void> | null = null;
let completeMockAd: (() => void) | null = null;

export type RewardedPlacement = "pdf_conversion" | "media_download" | "premium_operation";

const testRewardedUnit = Platform.select({
  ios: "ca-app-pub-3940256099942544/1712485313",
  android: "ca-app-pub-3940256099942544/5224354917",
  default: ""
});

export async function requireRewardedAd(
  placement: RewardedPlacement,
  controller: MockAdController
) {
  const shouldUseMock =
    Platform.OS === "web" ||
    process.env.EXPO_PUBLIC_USE_MOCK_ADS !== "false" ||
    !process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID;

  if (shouldUseMock) {
    await showMockRewardedAd(controller);
    return;
  }

  await showAdMobRewardedAd(placement);
}

export function finishMockRewardedAd() {
  completeMockAd?.();
}

function showMockRewardedAd(controller: MockAdController) {
  const store = useAdStore.getState();
  store.setStatus("mock");
  store.setError(null);
  store.setRewardEarned(false);

  if (!mockAdPromise) {
    mockAdPromise = new Promise((resolve) => {
      completeMockAd = () => {
        useAdStore.getState().setRewardEarned(true);
        useAdStore.getState().setStatus("earned");
        resolve();
        mockAdPromise = null;
        completeMockAd = null;
      };
    });
    controller.openMockAd();
  }

  return mockAdPromise;
}

async function showAdMobRewardedAd(_placement: RewardedPlacement) {
  const store = useAdStore.getState();
  store.setStatus("loading");
  store.setError(null);
  store.setRewardEarned(false);

  try {
    const ads = await import("react-native-google-mobile-ads");
    const unitId = process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID || testRewardedUnit;
    const rewarded = ads.RewardedAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: true
    });

    await new Promise<void>((resolve, reject) => {
      let earnedReward = false;
      const unsubscribers = [
        rewarded.addAdEventListener(ads.RewardedAdEventType.LOADED, () => {
          store.setStatus("loaded");
          rewarded.show();
          store.setStatus("showing");
        }),
        rewarded.addAdEventListener(ads.RewardedAdEventType.EARNED_REWARD, () => {
          earnedReward = true;
          store.setRewardEarned(true);
          store.setStatus("earned");
        }),
        rewarded.addAdEventListener(ads.AdEventType.CLOSED, () => {
          cleanup(unsubscribers);
          store.setStatus("closed");
          if (earnedReward) resolve();
          else reject(new Error("ERR_AD_NOT_REWARDED"));
          rewarded.load();
        }),
        rewarded.addAdEventListener(ads.AdEventType.ERROR, (error) => {
          cleanup(unsubscribers);
          store.setStatus("failed");
          store.setError(error.message);
          reject(new Error("ERR_AD_FAILED"));
        })
      ];

      rewarded.load();
    });
  } catch (error) {
    store.setStatus("failed");
    store.setError(error instanceof Error ? error.message : "Ad failed");
    throw error;
  }
}

function cleanup(unsubscribers: Array<() => void>) {
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
}
