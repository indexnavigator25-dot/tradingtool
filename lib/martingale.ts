export type MartingaleMode = 'classic' | 'dynamic' | 'super-hybrid';

export interface MartingaleProgress {
  nextStake: number | null;
  recoveryRemaining: number;
  dynamicLossPending: boolean;
  dynamicBoostTrade: boolean;
}

export const initialMartingaleProgress: MartingaleProgress = {
  nextStake: null,
  recoveryRemaining: 0,
  dynamicLossPending: false,
  dynamicBoostTrade: false,
};

export function getNextMartingaleStake(
  baseStake: number,
  multiplier: number,
  mode: MartingaleMode,
  settledProfit: number,
  progress: MartingaleProgress
): { stake: number; progress: MartingaleProgress } {
  const boostedStake = Math.round(baseStake * multiplier * 100) / 100;

  if (mode === 'classic') {
    if (settledProfit > 0) {
      return {
        stake: baseStake,
        progress: { ...initialMartingaleProgress },
      };
    }

    const nextStake = settledProfit < 0
      ? Math.round((progress.nextStake ?? baseStake) * multiplier * 100) / 100
      : progress.nextStake ?? baseStake;
    return {
      stake: nextStake,
      progress: { ...progress, nextStake },
    };
  }

  if (mode === 'dynamic') {
    if (progress.dynamicBoostTrade) {
      return {
        stake: baseStake,
        progress: {
          ...progress,
          dynamicLossPending: settledProfit < 0,
          dynamicBoostTrade: false,
        },
      };
    }

    if (settledProfit < 0) {
      return {
        stake: baseStake,
        progress: { ...progress, dynamicLossPending: true },
      };
    }

    if (settledProfit > 0 && progress.dynamicLossPending) {
      return {
        stake: boostedStake,
        progress: { ...progress, dynamicLossPending: false, dynamicBoostTrade: true },
      };
    }

    return { stake: baseStake, progress };
  }

  const recoveryRemaining = settledProfit < 0
    ? progress.recoveryRemaining + Math.abs(settledProfit)
    : Math.max(0, progress.recoveryRemaining - settledProfit);

  return {
    stake: recoveryRemaining > 0 ? boostedStake : baseStake,
    progress: {
      ...progress,
      recoveryRemaining,
      dynamicLossPending: false,
      dynamicBoostTrade: false,
    },
  };
}
