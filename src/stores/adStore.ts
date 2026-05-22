import { create } from "zustand";

export type RewardedAdStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "showing"
  | "earned"
  | "closed"
  | "failed"
  | "mock";

type AdState = {
  status: RewardedAdStatus;
  lastError: string | null;
  rewardEarned: boolean;
  setStatus: (status: RewardedAdStatus) => void;
  setError: (error: string | null) => void;
  setRewardEarned: (earned: boolean) => void;
};

export const useAdStore = create<AdState>((set) => ({
  status: "idle",
  lastError: null,
  rewardEarned: false,
  setStatus: (status) => set({ status }),
  setError: (lastError) => set({ lastError }),
  setRewardEarned: (rewardEarned) => set({ rewardEarned })
}));
