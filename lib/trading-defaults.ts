export const TRADING_DEFAULTS = {
  stake: '1.67',
  duration: 1,
  takeProfit: '2',
  stopLoss: '15',
  recoveryMultiplier: '2.25',
  tradesPerMinute: 2,
  runDurationHours: 1,
} as const;

export const AUTO_TRADING_SCHEDULE_LIMITS = {
  minTradesPerMinute: 1,
  maxTradesPerMinute: 60,
  minDurationHours: 1,
  maxDurationHours: 24,
} as const;
