import type { ActiveSymbol } from '@deriv/core';
import { getLastDigit, pipSizeFromPip } from '@/lib/digit-stats';
import { MARKET_SCAN_TICK_COUNT } from '@/lib/market-scanner';
import type { MarketScanCandidate } from '@/lib/market-scanner';
import type { ContractMode } from '@/lib/types';

export const EVEN_ODD_SIGNAL_WINDOW = 20;
export const EVEN_ODD_CONFIRMATION_WINDOW = 10;
export const EVEN_ODD_SIGNAL_PERCENT = 65;
export const GROUP_A_SIGNAL_WINDOW = 100;
export const GROUP_A_CONFIRMATION_WINDOW = 20;
export const GROUP_A_WIN_PERCENT = 90;
export const GROUP_A_DIFFERS_BASELINE_PERCENT = 10;
export const GROUP_B_SIGNAL_WINDOW = 100;
export const GROUP_B_BLOCK_SIZE = 20;
export const GROUP_B_BLOCK_COUNT = 5;
export const GROUP_B_REQUIRED_BLOCKS = 4;
export const GROUP_B_CONFIRMATION_WINDOW = 10;
export const GROUP_B_WIN_PERCENT = 80;

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

function matchesParityThreshold(digits: number[], parity: 'even' | 'odd'): boolean {
  const matchingDigits = digits.filter(
    (digit) => digit % 2 === (parity === 'even' ? 0 : 1)
  ).length;
  return matchingDigits * 100 >= digits.length * EVEN_ODD_SIGNAL_PERCENT;
}

function matchesEvenOddSignal(
  digits: number[],
  endIndex: number,
  parity: 'even' | 'odd'
): boolean {
  const signalWindow = digits.slice(endIndex - EVEN_ODD_SIGNAL_WINDOW, endIndex);
  const confirmationWindow = digits.slice(
    endIndex - EVEN_ODD_CONFIRMATION_WINDOW,
    endIndex
  );
  return signalWindow.length === EVEN_ODD_SIGNAL_WINDOW &&
    confirmationWindow.length === EVEN_ODD_CONFIRMATION_WINDOW &&
    matchesParityThreshold(signalWindow, parity) &&
    matchesParityThreshold(confirmationWindow, parity);
}

function countWinningDigits(
  digits: number[],
  contractOption: StrategyContractOption
): number {
  return digits.filter((digit) =>
    isWinningDigit(digit, contractOption.contractMode, contractOption.barrier)
  ).length;
}

function meetsWinFrequency(
  digits: number[],
  contractOption: StrategyContractOption,
  percent: number
): boolean {
  return digits.length > 0 &&
    countWinningDigits(digits, contractOption) * 100 >= digits.length * percent;
}

function getMostFrequentDigit(digits: number[]): number | null {
  if (digits.length === 0) return null;
  const counts = Array.from({ length: 10 }, () => 0);
  digits.forEach((digit) => {
    counts[digit] = (counts[digit] ?? 0) + 1;
  });
  return counts.reduce(
    (mostFrequent, count, digit) =>
      count > (counts[mostFrequent] ?? 0) ? digit : mostFrequent,
    0
  );
}

function matchesGroupASignal(
  digits: number[],
  endIndex: number,
  contractOption: StrategyContractOption
): boolean {
  const history = digits.slice(endIndex - GROUP_A_SIGNAL_WINDOW, endIndex);
  const confirmation = digits.slice(
    endIndex - GROUP_A_CONFIRMATION_WINDOW,
    endIndex
  );
  if (
    history.length !== GROUP_A_SIGNAL_WINDOW ||
    confirmation.length !== GROUP_A_CONFIRMATION_WINDOW
  ) {
    return false;
  }

  if (contractOption.contractMode === 'DIGITDIFF') {
    const barrier = contractOption.barrier;
    if (barrier === null) return false;
    const historyMode = getMostFrequentDigit(history);
    const confirmationMode = getMostFrequentDigit(confirmation);
    const historyCount = history.filter((digit) => digit === barrier).length;
    const confirmationCount = confirmation.filter((digit) => digit === barrier).length;
    return historyMode === barrier &&
      confirmationMode === barrier &&
      historyCount * 100 > history.length * GROUP_A_DIFFERS_BASELINE_PERCENT &&
      confirmationCount * 100 >
        confirmation.length * GROUP_A_DIFFERS_BASELINE_PERCENT;
  }

  return meetsWinFrequency(history, contractOption, GROUP_A_WIN_PERCENT) &&
    meetsWinFrequency(confirmation, contractOption, GROUP_A_WIN_PERCENT);
}

function matchesGroupBSignal(
  digits: number[],
  endIndex: number,
  contractOption: StrategyContractOption
): boolean {
  const history = digits.slice(endIndex - GROUP_B_SIGNAL_WINDOW, endIndex);
  const confirmation = digits.slice(
    endIndex - GROUP_B_CONFIRMATION_WINDOW,
    endIndex
  );
  if (
    history.length !== GROUP_B_SIGNAL_WINDOW ||
    confirmation.length !== GROUP_B_CONFIRMATION_WINDOW
  ) {
    return false;
  }

  let consistentBlocks = 0;
  for (let blockIndex = 0; blockIndex < GROUP_B_BLOCK_COUNT; blockIndex += 1) {
    const blockStart = blockIndex * GROUP_B_BLOCK_SIZE;
    const block = history.slice(blockStart, blockStart + GROUP_B_BLOCK_SIZE);
    if (meetsWinFrequency(block, contractOption, GROUP_B_WIN_PERCENT)) {
      consistentBlocks += 1;
    }
  }

  return consistentBlocks >= GROUP_B_REQUIRED_BLOCKS &&
    meetsWinFrequency(history, contractOption, GROUP_B_WIN_PERCENT) &&
    meetsWinFrequency(confirmation, contractOption, GROUP_B_WIN_PERCENT);
}

interface GroupSignalRule {
  minimumWindow: number;
  description: string;
  matchesAt: (digits: number[], endIndex: number) => boolean;
}

function getGroupSignalRule(
  contractOption: StrategyContractOption
): GroupSignalRule | null {
  if (
    contractOption.contractMode === 'DIGITEVEN' ||
    contractOption.contractMode === 'DIGITODD'
  ) {
    const parity = contractOption.contractMode === 'DIGITEVEN' ? 'even' : 'odd';
    return {
      minimumWindow: EVEN_ODD_SIGNAL_WINDOW,
      description:
        `At least ${EVEN_ODD_SIGNAL_PERCENT}% ${parity} in the last ` +
        `${EVEN_ODD_SIGNAL_WINDOW} digits, confirmed by the last ` +
        `${EVEN_ODD_CONFIRMATION_WINDOW}`,
      matchesAt: (digits, endIndex) =>
        matchesEvenOddSignal(digits, endIndex, parity),
    };
  }

  if (
    contractOption.contractMode === 'DIGITDIFF' ||
    (contractOption.contractMode === 'DIGITOVER' && contractOption.barrier === 0) ||
    (contractOption.contractMode === 'DIGITUNDER' && contractOption.barrier === 9)
  ) {
    const description = contractOption.contractMode === 'DIGITDIFF'
      ? `Differs from ${contractOption.barrier}: most frequent digit exceeds ` +
        `the ${GROUP_A_DIFFERS_BASELINE_PERCENT}% baseline and agrees in the last ` +
        `${GROUP_A_SIGNAL_WINDOW} and ` +
        `${GROUP_A_CONFIRMATION_WINDOW}`
      : `${contractOption.contractDescription}: at least ${GROUP_A_WIN_PERCENT}% ` +
        `winning digits in the last ${GROUP_A_SIGNAL_WINDOW} and ` +
        `${GROUP_A_CONFIRMATION_WINDOW}`;
    return {
      minimumWindow: GROUP_A_SIGNAL_WINDOW,
      description,
      matchesAt: (digits, endIndex) =>
        matchesGroupASignal(digits, endIndex, contractOption),
    };
  }

  if (
    (contractOption.contractMode === 'DIGITOVER' && contractOption.barrier === 1) ||
    (contractOption.contractMode === 'DIGITUNDER' && contractOption.barrier === 8)
  ) {
    return {
      minimumWindow: GROUP_B_SIGNAL_WINDOW,
      description:
        `${contractOption.contractDescription}: at least ${GROUP_B_REQUIRED_BLOCKS} of ${GROUP_B_BLOCK_COUNT} ` +
        `${GROUP_B_BLOCK_SIZE}-tick blocks, ${GROUP_B_WIN_PERCENT}% wins overall, ` +
        `and ${GROUP_B_WIN_PERCENT}% confirmation in the last ` +
        `${GROUP_B_CONFIRMATION_WINDOW}`,
      matchesAt: (digits, endIndex) =>
        matchesGroupBSignal(digits, endIndex, contractOption),
    };
  }

  return null;
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
  if (strategy.contractOptions.length === 0 || strategy.triggers.length === 0) return [];

  const pipSize = pipSizeFromPip(symbol.pip_size);
  const digits = predictionPrices.map((price) => getLastDigit(price, pipSize));
  const candidates: MarketScanCandidate[] = [];
  const addCandidate = (
    contractOption: StrategyContractOption,
    triggerDescription: string,
    ruleMatched: boolean,
    signalOutcomes: boolean[]
  ) => {
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
      triggerDescription,
      expectedReturn: null,
      scoreFactors: null,
      weightedScore: null,
    });
  };

  for (const contractOption of strategy.contractOptions) {
    const groupSignalRule = getGroupSignalRule(contractOption);
    const groupSignalMatches = groupSignalRule
      ? Array.from({ length: digits.length + 1 }, (_, endIndex) =>
          endIndex >= groupSignalRule.minimumWindow &&
          groupSignalRule.matchesAt(digits, endIndex)
        )
      : null;
    for (const trigger of strategy.triggers) {
      const triggerLength = getTriggerLength(trigger);
      const minimumWindow = Math.max(
        triggerLength,
        groupSignalRule?.minimumWindow ?? 0
      );
      if (digits.length < minimumWindow) continue;

      const matchesAt = (endIndex: number) =>
        (groupSignalMatches?.[endIndex] ?? true) &&
        triggerMatches(
          digits.slice(endIndex - triggerLength, endIndex),
          trigger,
          contractOption
        );
      const ruleMatched = matchesAt(digits.length);
      const signalOutcomes: boolean[] = [];

      for (let outcomeIndex = minimumWindow; outcomeIndex < digits.length; outcomeIndex += 1) {
        if (!matchesAt(outcomeIndex)) continue;
        signalOutcomes.push(
          isWinningDigit(digits[outcomeIndex]!, contractOption.contractMode, contractOption.barrier)
        );
      }

      addCandidate(
        contractOption,
        groupSignalRule
          ? `${groupSignalRule.description} · ${trigger.description}`
          : trigger.description,
        ruleMatched,
        signalOutcomes
      );
    }
  }

  return candidates;
}
