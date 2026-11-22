import { isContinuousIndexSymbol } from '@deriv/core';
import type { ActiveSymbol } from '@deriv/core';
import type { ContractMode } from '@/lib/types';

export const MARKET_SCAN_TICK_COUNT = 1000;
export const MARKET_SCAN_TIMEOUT_MS = 15_000;

export interface MarketScanScoreFactors {
  historicalWinRate: number;
  recentSignalAccuracy: number;
  statisticalEdge: number;
  consistency: number;
  marketSuitability: number;
  drawdownStability: number;
}

export interface MarketScanQuote {
  askPrice: number;
  payout: number;
}

export interface MarketScanCandidate {
  symbol: ActiveSymbol;
  contractMode: Exclude<ContractMode, 'DIGITMATCH'>;
  barrier: number | null;
  predictionPrices: number[];
  observedDigits: number[];
  signalOutcomes: boolean[];
  estimatedWinRate: number;
  predictedWinRate: number;
  ruleMatched: boolean;
  sampleCount: number;
  triggerMatches: number;
  triggerDescription: string;
  expectedReturn: number | null;
  scoreFactors: MarketScanScoreFactors | null;
  weightedScore: number | null;
}

export type ScoredMarketScanCandidate = MarketScanCandidate & {
  expectedReturn: number;
  scoreFactors: MarketScanScoreFactors;
  weightedScore: number;
};

export function getScannableMarkets(symbols: ActiveSymbol[]): ActiveSymbol[] {
  return symbols.filter(
    (symbol) =>
      symbol.exchange_is_open === 1 &&
      symbol.is_trading_suspended === 0 &&
      isContinuousIndexSymbol(symbol)
  );
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function getRandomWinRate(candidate: MarketScanCandidate): number {
  switch (candidate.contractMode) {
    case 'DIGITDIFF':
      return 0.9;
    case 'DIGITOVER':
      return (9 - (candidate.barrier ?? 1)) / 10;
    case 'DIGITUNDER':
      return (candidate.barrier ?? 8) / 10;
    case 'DIGITEVEN':
    case 'DIGITODD':
      return 0.5;
  }
}

function getConsistencyScore(outcomes: boolean[]): number {
  if (outcomes.length < 2) return 0;

  const windowCount = Math.min(4, outcomes.length);
  const windowRates = Array.from({ length: windowCount }, (_, windowIndex) => {
    const start = Math.floor((windowIndex * outcomes.length) / windowCount);
    const end = Math.floor(((windowIndex + 1) * outcomes.length) / windowCount);
    const window = outcomes.slice(start, end);
    return window.filter(Boolean).length / window.length;
  });
  const mean = windowRates.reduce((sum, rate) => sum + rate, 0) / windowRates.length;
  const variance = windowRates.reduce(
    (sum, rate) => sum + (rate - mean) ** 2,
    0
  ) / windowRates.length;

  return clamp(1 - 2 * Math.sqrt(variance));
}

function getMarketSuitabilityScore(digits: number[]): number {
  const midpoint = Math.floor(digits.length / 2);
  if (midpoint === 0 || midpoint === digits.length) return 0;

  const getDistribution = (sample: number[]) => {
    const counts = Array.from({ length: 10 }, () => 0);
    sample.forEach((digit) => {
      counts[digit] = (counts[digit] ?? 0) + 1;
    });
    return counts.map((count) => count / sample.length);
  };
  const earlierDistribution = getDistribution(digits.slice(0, midpoint));
  const recentDistribution = getDistribution(digits.slice(midpoint));
  const totalVariationDistance = earlierDistribution.reduce(
    (distance, probability, digit) =>
      distance + Math.abs(probability - (recentDistribution[digit] ?? 0)),
    0
  ) / 2;

  return clamp(1 - totalVariationDistance);
}

export function scoreMarketCandidate(
  candidate: MarketScanCandidate,
  quote: MarketScanQuote
): ScoredMarketScanCandidate | null {
  if (
    !Number.isFinite(quote.askPrice) ||
    quote.askPrice <= 0 ||
    !Number.isFinite(quote.payout) ||
    quote.payout <= 0
  ) {
    return null;
  }

  const wins = candidate.signalOutcomes.filter(Boolean).length;
  const historicalWinRate = candidate.signalOutcomes.length > 0
    ? wins / candidate.signalOutcomes.length
    : candidate.predictedWinRate;
  const recentOutcomes = candidate.signalOutcomes.slice(-5);
  const recentSignalAccuracy = recentOutcomes.length > 0
    ? recentOutcomes.filter(Boolean).length / recentOutcomes.length
    : historicalWinRate;
  const randomWinRate = getRandomWinRate(candidate);
  const statisticalEdge = clamp(
    (historicalWinRate - randomWinRate) / (1 - randomWinRate)
  );
  const drawdown = candidate.signalOutcomes.reduce(
    (state, won) => {
      const balance = state.balance + (won ? quote.payout - quote.askPrice : -quote.askPrice);
      const peak = Math.max(state.peak, balance);
      return {
        balance,
        peak,
        maximumDrawdown: Math.max(state.maximumDrawdown, peak - balance),
      };
    },
    { balance: 0, peak: 0, maximumDrawdown: 0 }
  );
  const drawdownStability = candidate.signalOutcomes.length > 0
    ? clamp(
        1 - drawdown.maximumDrawdown /
          (quote.askPrice * candidate.signalOutcomes.length)
      )
    : 0.5;
  const scoreFactors: MarketScanScoreFactors = {
    historicalWinRate,
    recentSignalAccuracy,
    statisticalEdge,
    consistency: getConsistencyScore(candidate.signalOutcomes),
    marketSuitability: getMarketSuitabilityScore(candidate.observedDigits),
    drawdownStability,
  };
  const weightedScore = (
    scoreFactors.historicalWinRate * 25 +
    scoreFactors.recentSignalAccuracy * 20 +
    scoreFactors.statisticalEdge * 20 +
    scoreFactors.consistency * 15 +
    scoreFactors.marketSuitability * 10 +
    scoreFactors.drawdownStability * 10
  );

  return {
    ...candidate,
    expectedReturn: candidate.predictedWinRate * quote.payout - quote.askPrice,
    scoreFactors,
    weightedScore,
  };
}

export const RECOVERY_MIN_SIGNAL_COUNT = 10;
export const RECOVERY_MIN_STATISTICAL_EDGE = 0.1;

export function isRecoveryCandidateQualified(
  candidate: MarketScanCandidate,
  quote?: MarketScanQuote
): boolean {
  if (!candidate.ruleMatched || candidate.triggerMatches < RECOVERY_MIN_SIGNAL_COUNT) {
    return false;
  }

  const score = scoreMarketCandidate(
    candidate,
    quote ?? { askPrice: 1, payout: 1 }
  );
  return score !== null &&
    score.scoreFactors.statisticalEdge >= RECOVERY_MIN_STATISTICAL_EDGE &&
    (quote === undefined || score.expectedReturn > 0);
}

export function rankMarketScanCandidates(
  candidates: MarketScanCandidate[]
): ScoredMarketScanCandidate[] {
  return candidates
    .filter(
      (candidate): candidate is ScoredMarketScanCandidate =>
        candidate.ruleMatched &&
        candidate.expectedReturn !== null &&
        candidate.expectedReturn >= 0 &&
        candidate.weightedScore !== null
    )
    .sort(
      (left, right) =>
        (right.weightedScore ?? 0) - (left.weightedScore ?? 0) ||
        (right.expectedReturn ?? 0) - (left.expectedReturn ?? 0) ||
        right.estimatedWinRate - left.estimatedWinRate ||
        left.symbol.underlying_symbol.localeCompare(right.symbol.underlying_symbol)
    );
}

export function chooseBestScanCandidate(
  candidates: MarketScanCandidate[]
): ScoredMarketScanCandidate | null {
  return rankMarketScanCandidates(candidates)[0] ?? null;
}

export function rankHistoricalScanCandidates(
  candidates: MarketScanCandidate[]
): MarketScanCandidate[] {
  const scoredCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreMarketCandidate(candidate, { askPrice: 1, payout: 1 }),
    }))
    .filter(
      (entry): entry is {
        candidate: MarketScanCandidate;
        score: ScoredMarketScanCandidate;
      } => entry.score !== null
    );

  return scoredCandidates
    .sort(
      (left, right) =>
        Number(right.candidate.ruleMatched) - Number(left.candidate.ruleMatched) ||
        right.score.weightedScore - left.score.weightedScore ||
        right.candidate.estimatedWinRate - left.candidate.estimatedWinRate ||
        right.candidate.triggerMatches - left.candidate.triggerMatches ||
        left.candidate.symbol.underlying_symbol.localeCompare(right.candidate.symbol.underlying_symbol) ||
        left.candidate.contractMode.localeCompare(right.candidate.contractMode) ||
        (left.candidate.barrier ?? -1) - (right.candidate.barrier ?? -1)
    )
    .map(({ candidate }) => candidate);
}

export function chooseBestHistoricalScanCandidate(
  candidates: MarketScanCandidate[]
): MarketScanCandidate | null {
  return rankHistoricalScanCandidates(candidates)[0] ?? null;
}

export function chooseNextHistoricalScanCandidate(
  candidates: MarketScanCandidate[],
  contractModeOrder: readonly MarketScanCandidate['contractMode'][],
  startIndex: number
): MarketScanCandidate | null {
  const rankedCandidates = rankHistoricalScanCandidates(candidates);
  if (rankedCandidates.length === 0) return null;

  const uniqueContractModes = Array.from(new Set(contractModeOrder));
  if (uniqueContractModes.length === 0) return rankedCandidates[0] ?? null;

  const firstIndex =
    ((Math.trunc(startIndex) % uniqueContractModes.length) + uniqueContractModes.length) %
    uniqueContractModes.length;

  for (let offset = 0; offset < uniqueContractModes.length; offset += 1) {
    const contractMode =
      uniqueContractModes[(firstIndex + offset) % uniqueContractModes.length];
    const candidate = rankedCandidates.find((entry) => entry.contractMode === contractMode);
    if (candidate) return candidate;
  }

  return rankedCandidates[0] ?? null;
}

export function getContractBarrier(
  contractMode: ContractMode,
  selectedDigit: number | null
): number | undefined {
  switch (contractMode) {
    case 'DIGITDIFF':
      return selectedDigit ?? undefined;
    case 'DIGITOVER':
      return selectedDigit ?? 1;
    case 'DIGITUNDER':
      return selectedDigit ?? 8;
    default:
      return undefined;
  }
}
