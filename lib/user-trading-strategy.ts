import type { ActiveSymbol } from '@deriv/core';
import { getLastDigit, pipSizeFromPip } from '@/lib/digit-stats';
import { MARKET_SCAN_TICK_COUNT } from '@/lib/market-scanner';
import type { MarketScanCandidate } from '@/lib/market-scanner';
import type { ContractMode } from '@/lib/types';

type DigitTrigger =
  | { kind: 'digit'; digit: number; description: string }
  | { kind: 'sequence'; digits: number[]; description: string }
  | { kind: 'parity-run'; parity: 'even' | 'odd'; length: number; description: string }
  | { kind: 'range-run'; range: 'high' | 'low'; length: number; description: string }
  | { kind: 'loss-run'; length: number; description: string };

export interface StrategyContractOption {
  contractMode: Exclude<ContractMode, 'DIGITMATCH'>;
  barrier: number | null;
  contractDescription: string;
}

export interface UserTradingStrategy {
  contractMode: Exclude<ContractMode, 'DIGITMATCH'>;
  barrier: number | null;
  contractOptions: StrategyContractOption[];
  triggers: DigitTrigger[];
  description: string;
  contractDescription: string;
}

export type StrategyGroup = 'A' | 'B' | 'C';

export interface StrategyRecoveryState {
  baseGroup: StrategyGroup;
  activeGroup: StrategyGroup;
  recoveryActive: boolean;
}

export interface SavedBotSettings {
  marketSymbol?: string | null;
  stake?: string;
  duration?: number;
  recoveryEnabled?: boolean;
  recoveryMultiplier?: string;
  takeProfit?: string;
  stopLoss?: string;
}

export type StrategyCompilation =
  | { strategy: UserTradingStrategy; error: null }
  | { strategy: null; error: string };

export function formatUserTradingStrategyDescription(description: string): string {
  return description
    .replace(/\b(?:differs?|different)\s+(?:from\s+)?[0-9]\b/gi, 'differs (0-9)')
    .replace(/\s+and\s+/gi, ' or ');
}

export function getStrategyGroup(strategy: UserTradingStrategy): StrategyGroup | null {
  const contractModes = new Set(strategy.contractOptions.map((option) => option.contractMode));
  if (contractModes.has('DIGITDIFF')) return 'A';
  if (contractModes.has('DIGITEVEN') || contractModes.has('DIGITODD')) return 'C';
  if (contractModes.has('DIGITOVER') || contractModes.has('DIGITUNDER')) return 'B';
  return null;
}

export function createStrategyForGroup(
  strategy: UserTradingStrategy,
  group: StrategyGroup
): UserTradingStrategy {
  const contractOptions: StrategyContractOption[] = group === 'A'
    ? [
        { contractMode: 'DIGITOVER', barrier: 0, contractDescription: 'Over 0' },
        { contractMode: 'DIGITUNDER', barrier: 9, contractDescription: 'Under 9' },
        ...Array.from({ length: 10 }, (_, barrier) => ({
          contractMode: 'DIGITDIFF' as const,
          barrier,
          contractDescription: `Differs from ${barrier}`,
        })),
      ]
    : group === 'B'
      ? [
          { contractMode: 'DIGITOVER', barrier: 1, contractDescription: 'Over 1' },
          { contractMode: 'DIGITUNDER', barrier: 8, contractDescription: 'Under 8' },
        ]
      : [
          { contractMode: 'DIGITEVEN', barrier: null, contractDescription: 'Even' },
          { contractMode: 'DIGITODD', barrier: null, contractDescription: 'Odd' },
        ];
  const firstOption = contractOptions[0]!;
  const contractDescription = Array.from(new Set(contractOptions.map((option) =>
    option.contractMode === 'DIGITDIFF' ? 'Differs (0-9)' : option.contractDescription
  ))).join(' or ');

  return {
    ...strategy,
    contractMode: firstOption.contractMode,
    barrier: firstOption.barrier,
    contractOptions,
    contractDescription,
  };
}

export function createStrategyRecoveryState(baseGroup: StrategyGroup): StrategyRecoveryState {
  return {
    baseGroup,
    activeGroup: baseGroup,
    recoveryActive: false,
  };
}

export function advanceStrategyRecoveryState(
  state: StrategyRecoveryState,
  settledProfit: number
): StrategyRecoveryState {
  if (state.baseGroup === 'C' || !Number.isFinite(settledProfit) || settledProfit === 0) {
    return state;
  }

  if (settledProfit > 0) {
    return state.recoveryActive
      ? { ...state, activeGroup: state.baseGroup, recoveryActive: false }
      : state;
  }

  if (state.activeGroup === 'A') {
    return { ...state, activeGroup: 'B', recoveryActive: true };
  }
  return { ...state, activeGroup: 'C', recoveryActive: true };
}

function compileTrigger(condition: string): DigitTrigger | null {
  const lossRunMatch = condition.match(
    /\b(\d+)\s+consecutive\s+losing\s+digits?\b/
  );
  if (lossRunMatch?.[1]) {
    const length = Number(lossRunMatch[1]);
    if (length >= 1 && length <= 8) {
      return {
        kind: 'loss-run',
        length,
        description: `after ${length} consecutive losing digits`,
      };
    }
  }

  const sequenceMatch = condition.match(
    /\b(?:last\s+)?(?:digit\s+)?(?:sequence\s+)?(\d(?:\s*(?:,|then)\s*\d){1,4})\b/
  );
  if (sequenceMatch?.[1]) {
    const digits = sequenceMatch[1].match(/\d/g)?.map(Number) ?? [];
    if (digits.length >= 2 && digits.length <= 5) {
      return {
        kind: 'sequence',
        digits,
        description: `after the sequence ${digits.join(', ')}`,
      };
    }
  }

  const digitMatch = condition.match(/\b(?:last\s+)?digit\s+(?:is|equals?)\s+([0-9])\b/);
  if (digitMatch?.[1]) {
    const digit = Number(digitMatch[1]);
    return { kind: 'digit', digit, description: `when the last digit is ${digit}` };
  }

  const singleParityMatch = condition.match(
    /\b(?:last\s+)?digit\s+(?:is|equals?)\s+(even|odd)\b/
  );
  if (singleParityMatch?.[1]) {
    const parity = singleParityMatch[1] as 'even' | 'odd';
    return {
      kind: 'parity-run',
      parity,
      length: 1,
      description: `when the last digit is ${parity}`,
    };
  }

  const singleRangeMatch = condition.match(
    /\b(?:last\s+)?digit\s+(?:is|equals?)\s+(high|low)\b/
  );
  if (singleRangeMatch?.[1]) {
    const range = singleRangeMatch[1] as 'high' | 'low';
    return {
      kind: 'range-run',
      range,
      length: 1,
      description: `when the last digit is ${range}`,
    };
  }

  const parityRunMatch = condition.match(
    /\b(?:last\s+)?(\d+)\s+consecutive\s+(even|odd)\s+digits?\b/
  ) ?? condition.match(/\blast\s+(\d+)\s+digits?\s+(?:are|all)\s+(even|odd)\b/);
  if (parityRunMatch?.[1] && parityRunMatch[2]) {
    const length = Number(parityRunMatch[1]);
    if (length >= 1 && length <= 8) {
      const parity = parityRunMatch[2] as 'even' | 'odd';
      return {
        kind: 'parity-run',
        parity,
        length,
        description: `after ${length} consecutive ${parity} digits`,
      };
    }
  }

  const rangeRunMatch = condition.match(
    /\b(?:last\s+)?(\d+)\s+consecutive\s+(high|low)\s+digits?\b/
  );
  if (rangeRunMatch?.[1] && rangeRunMatch[2]) {
    const length = Number(rangeRunMatch[1]);
    if (length >= 1 && length <= 8) {
      const range = rangeRunMatch[2] as 'high' | 'low';
      return {
        kind: 'range-run',
        range,
        length,
        description: `after ${length} consecutive ${range} digits`,
      };
    }
  }

  return null;
}

export function compileUserTradingStrategy(description: string): StrategyCompilation {
  const normalized = description.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { strategy: null, error: 'Describe a contract and an entry condition first.' };
  }

  const conditionStart = normalized.search(/\b(?:when|after)\b/i);
  if (conditionStart < 0) {
    return {
      strategy: null,
      error: 'Include an entry condition using “when” or “after”.',
    };
  }

  const contractText = normalized.slice(0, conditionStart).toLowerCase();
  const conditionText = normalized.slice(conditionStart).toLowerCase();
  const contractOptions: StrategyContractOption[] = [];
  const addContractOption = (option: StrategyContractOption) => {
    if (!contractOptions.some(
      (candidate) =>
        candidate.contractMode === option.contractMode &&
        candidate.barrier === option.barrier
    )) {
      contractOptions.push(option);
    }
  };
  const addDiffersOptions = () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      addContractOption({
        contractMode: 'DIGITDIFF',
        barrier: digit,
        contractDescription: `Differs from ${digit}`,
      });
    }
  };
  if (/\b(?:differs?|different)\s+\(0-9\)/i.test(contractText)) {
    addDiffersOptions();
  }
  const contractPattern =
    /\b(?:differs?|different)\s+(?:from\s+)?([0-9])\b|\b(?:over|above|greater\s+than)\s+([0-8])\b|\b(?:under|below|less\s+than)\s+([1-9])\b|\b(even|odd)\b/gi;
  for (const match of contractText.matchAll(contractPattern)) {
    if (match[1]) {
      addDiffersOptions();
    } else if (match[2]) {
      addContractOption({
        contractMode: 'DIGITOVER',
        barrier: Number(match[2]),
        contractDescription: `Over ${match[2]}`,
      });
    } else if (match[3]) {
      addContractOption({
        contractMode: 'DIGITUNDER',
        barrier: Number(match[3]),
        contractDescription: `Under ${match[3]}`,
      });
    } else if (match[4]) {
      const contractMode = match[4] === 'even' ? 'DIGITEVEN' : 'DIGITODD';
      addContractOption({
        contractMode,
        barrier: null,
        contractDescription: match[4] === 'even' ? 'Even' : 'Odd',
      });
    }
  }

  if (contractOptions.length === 0) {
    return {
      strategy: null,
      error: 'Specify a contract such as “differs from 5”, “over 1”, “under 8”, “even”, or “odd”.',
    };
  }
  const { contractMode, barrier } = contractOptions[0]!;
  const contractDescription = Array.from(new Set(contractOptions.map((option) =>
    option.contractMode === 'DIGITDIFF'
      ? 'Differs (0-9)'
      : option.contractDescription
  )))
    .join(' / ');

  const triggerParts = conditionText.split(/\s+(?:and|or)\s+/i);
  const triggers = triggerParts.map(compileTrigger);
  if (triggers.length === 0 || triggers.some((trigger) => trigger === null)) {
    return {
      strategy: null,
      error: 'Entry condition not recognized. Use a last digit, digit sequence, or consecutive winning/losing, even/odd, or high/low digits.',
    };
  }

  return {
    strategy: {
      contractMode,
      barrier,
      contractOptions,
      triggers: triggers.filter((trigger): trigger is DigitTrigger => trigger !== null),
      description: formatUserTradingStrategyDescription(normalized),
      contractDescription,
    },
    error: null,
  };
}

function getTriggerLength(trigger: DigitTrigger): number {
  switch (trigger.kind) {
    case 'digit':
      return 1;
    case 'sequence':
      return trigger.digits.length;
    case 'parity-run':
    case 'range-run':
    case 'loss-run':
      return trigger.length;
  }
}

function triggerMatches(
  digits: number[],
  trigger: DigitTrigger,
  contractOption: StrategyContractOption
): boolean {
  switch (trigger.kind) {
    case 'digit':
      return digits.length === 1 && digits[0] === trigger.digit;
    case 'sequence':
      return digits.length === trigger.digits.length &&
        trigger.digits.every((digit, index) => digits[index] === digit);
    case 'parity-run':
      return digits.length === trigger.length && digits.every(
        (digit) => digit % 2 === (trigger.parity === 'even' ? 0 : 1)
      );
    case 'range-run':
      return digits.length === trigger.length && digits.every(
        (digit) => trigger.range === 'high' ? digit >= 5 : digit <= 4
      );
    case 'loss-run':
      return digits.length === trigger.length && digits.every(
        (digit) => !isWinningDigit(digit, contractOption.contractMode, contractOption.barrier)
      );
  }
}

function isWinningDigit(
  digit: number,
  contractMode: StrategyContractOption['contractMode'],
  barrier: number | null
): boolean {
  switch (contractMode) {
    case 'DIGITDIFF':
      return digit !== barrier;
    case 'DIGITOVER':
      return digit > (barrier ?? 1);
    case 'DIGITUNDER':
      return digit < (barrier ?? 8);
    case 'DIGITEVEN':
      return digit % 2 === 0;
    case 'DIGITODD':
      return digit % 2 !== 0;
  }
}

function getWilsonLowerBound(wins: number, sampleCount: number): number {
  const z = 1.6448536269514722;
  const observedRate = wins / sampleCount;
  const denominator = 1 + z ** 2 / sampleCount;
  const center = observedRate + z ** 2 / (2 * sampleCount);
  const margin = z * Math.sqrt(
    (observedRate * (1 - observedRate) + z ** 2 / (4 * sampleCount)) / sampleCount
  );
  return (center - margin) / denominator;
}

export function evaluateUserTradingStrategy(
  symbol: ActiveSymbol,
  prices: number[],
  strategy: UserTradingStrategy
): MarketScanCandidate[] {
  const predictionPrices = prices
    .filter(Number.isFinite)
    .slice(-MARKET_SCAN_TICK_COUNT);
  if (strategy.triggers.length === 0 || strategy.contractOptions.length === 0) return [];

  const pipSize = pipSizeFromPip(symbol.pip_size);
  const digits = predictionPrices.map((price) => getLastDigit(price, pipSize));
  const candidates: MarketScanCandidate[] = [];

  for (const contractOption of strategy.contractOptions) {
    for (const trigger of strategy.triggers) {
      const triggerLength = getTriggerLength(trigger);
      if (digits.length < triggerLength) continue;

      const matchesAt = (endIndex: number) =>
        triggerMatches(
          digits.slice(endIndex - triggerLength, endIndex),
          trigger,
          contractOption
        );
      const ruleMatched = matchesAt(digits.length);
      const signalOutcomes: boolean[] = [];

      for (let outcomeIndex = triggerLength; outcomeIndex < digits.length; outcomeIndex += 1) {
        if (!matchesAt(outcomeIndex)) continue;
        signalOutcomes.push(
          isWinningDigit(digits[outcomeIndex]!, contractOption.contractMode, contractOption.barrier)
        );
      }

      const wins = signalOutcomes.filter(Boolean).length;
      const predictedWinRate = (wins + 1) / (signalOutcomes.length + 2);

      candidates.push({
        symbol,
        contractMode: contractOption.contractMode,
        barrier: contractOption.barrier,
        predictionPrices,
        observedDigits: digits,
        signalOutcomes,
        predictedWinRate,
        estimatedWinRate: signalOutcomes.length > 0
          ? getWilsonLowerBound(wins, signalOutcomes.length)
          : predictedWinRate,
        ruleMatched,
        sampleCount: predictionPrices.length,
        triggerMatches: signalOutcomes.length,
        triggerDescription: trigger.description,
        expectedReturn: null,
        scoreFactors: null,
        weightedScore: null,
      });
    }
  }

  return candidates;
}
