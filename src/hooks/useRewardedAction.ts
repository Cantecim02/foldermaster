import { useCallback, useState } from "react";
import {
  requireRewardedAd,
  RewardedPlacement
} from "../services/rewardedAdService";

type Params = {
  placement: RewardedPlacement;
  openMockAd: () => void;
};

export function useRewardedAction({ placement, openMockAd }: Params) {
  const [isWaitingForAd, setIsWaitingForAd] = useState(false);

  const runAfterReward = useCallback(
    async <T>(action: () => Promise<T>) => {
      setIsWaitingForAd(true);
      try {
        await requireRewardedAd(placement, { openMockAd });
      } finally {
        setIsWaitingForAd(false);
      }

      return action();
    },
    [openMockAd, placement]
  );

  return { runAfterReward, isWaitingForAd };
}
