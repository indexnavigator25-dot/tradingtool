'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  isDerivApiError,
  useProposal,
  useBuy,
} from '@deriv/core';
import type {
  ActiveSymbol,
  Tick,
  ProposalInfo,
  ProposalParams,
  DurationLimits,
  BuyResult,
  ProposalResponse,
  TicksHistoryResponse,
} from '@deriv/core';
import { toast } from 'sonner';
import { useBaseTrading } from '@/hooks/use-base-trading';
import type { UseBaseTradingParams } from '@/hooks/use-base-trading';
import { computeDigitStats, getLastDigit, pipSizeFromPip } from '../lib/digit-stats';
import {
  chooseBestHistoricalScanCandidate,
  getContractBarrier,
  getScannableMarkets,
  MARKET_SCAN_TIMEOUT_MS,
  MARKET_SCAN_TICK_COUNT,
  isRecoveryCandidateQualified,
  isTradingCandidateQualified,
  scoreMarketCandidate,
} from '../lib/market-scanner';
import type { MarketScanCandidate } from '../lib/market-scanner';
import type { ScoredMarketScanCandidate } from '../lib/market-scanner';
import {
  advanceStrategyRecoveryState,
  createStrategyForGroup,
  createStrategyRecoveryState,
  evaluateUserTradingStrategy,
  getStrategyGroup,
} from '../lib/user-trading-strategy';
import type {
  SavedBotSettings,
  StrategyGroup,
  StrategyRecoveryState,
  UserTradingStrategy,
} from '../lib/user-trading-strategy';
import { getNextMartingaleStake, initialMartingaleProgress } from '../lib/martingale';
import type { MartingaleMode } from '../lib/martingale';
import {
  AUTO_TRADING_SCHEDULE_LIMITS,
  TRADING_DEFAULTS,
} from '../lib/trading-defaults';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import type { ContractMode, TradeType, DigitStats, OpenPosition, ClosedPosition } from '../lib/types';

const CONTRACT_TYPES = ['DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'];

type AutoTradingStatus = 'idle' | 'scanning' | 'running' | 'stopping';
const CONTRACT_SETTLEMENT_TIMEOUT_MS = 15 * 60 * 1000;
const CONNECTION_POLL_INTERVAL_MS = 250;
const CONNECTION_LOST = Symbol('connection-lost');

export interface AutoTradingScanProgress {
  phase: 'connecting' | 'scanning' | 'evaluating' | 'preview' | 'selected';
  scanOnly: boolean;
  historyLoadedMarkets: number;
  totalMarkets: number;
  unavailableMarkets: number;
  historyUnavailableMarkets: number;
  evaluatedCandidates: number;
  eligibleCandidates: number;
  scanNumber: number;
  ruleDescription: string;
  baseGroup: StrategyGroup | null;
  activeGroup: StrategyGroup | null;
  recoveryActive: boolean;
  selectedMarket: string | null;
  selectedContractMode: Exclude<ContractMode, 'DIGITMATCH'> | null;
  estimatedWinRate: number | null;
  prediction: AutoTradingPrediction | null;
  skippedUnfavorableCandidates: number;
}

export interface AutoTradingScheduleProgress {
  tradesPerMinute: number;
  durationHours: number;
  deadlineAt: number;
  tradesInCurrentMinute: number;
  waitingForNextMinute: boolean;
  nextIntervalAt: number | null;
}

export interface AutoTradingPrediction {
  scanNumber: number;
  market: string;
  contractMode: Exclude<ContractMode, 'DIGITMATCH'>;
  barrier: number | null;
  predictedWinRate: number;
  estimatedWinRate: number;
  sampleCount: number;
  triggerMatches: number;
  triggerDescription: string;
  ruleMatched: boolean;
  expectedReturn: number | null;
  weightedScore: number | null;
  scoreFactors: MarketScanCandidate['scoreFactors'];
}

type MarketScanProgressCallback = (
  historyLoadedMarkets: number,
  totalMarkets: number,
  unavailableMarkets: number,
  historyUnavailableMarkets: number
) => void;
interface MarketScanResult {
  candidates: MarketScanCandidate[];
  historyLoadedMarkets: number;
  unavailableMarkets: number;
  historyUnavailableMarkets: number;
}
interface MarketHistoryCacheEntry {
  prices: number[];
  lastEpoch: number | null;
  lastQuote: number | null;
  historicalSeeded: boolean;
  retryAfter: number;
  lastUpdatedAt: number;
}
interface MarketHistoryRequestScheduler {
  nextRequestAt: number;
  rateLimitedUntil: number;
}

type ActiveTickSubscriber = (
  symbol: string,
  handler: (tick: Tick) => void
) => (() => void) | null;

interface ScannedMarketSelection {
  candidate: MarketScanCandidate;
  qualified: boolean;
}

function getCandidatePrediction(
  candidate: MarketScanCandidate,
  scanNumber: number
): AutoTradingPrediction {
  const historicalScore = candidate.scoreFactors
    ? null
    : scoreMarketCandidate(candidate, { askPrice: 1, payout: 1 });
  const quoteAvailable = candidate.expectedReturn !== null;
  return {
    scanNumber,
    market: candidate.symbol.underlying_symbol_name || candidate.symbol.underlying_symbol,
    contractMode: candidate.contractMode,
    barrier: candidate.barrier,
    predictedWinRate: candidate.predictedWinRate,
    estimatedWinRate: candidate.estimatedWinRate,
    sampleCount: candidate.sampleCount,
    triggerMatches: candidate.triggerMatches,
    triggerDescription: candidate.triggerDescription,
    ruleMatched: candidate.ruleMatched,
    expectedReturn: quoteAvailable ? candidate.expectedReturn : null,
    weightedScore: candidate.weightedScore ?? historicalScore?.weightedScore ?? null,
    scoreFactors: candidate.scoreFactors ?? historicalScore?.scoreFactors ?? null,
  };
}

function getScanCandidateKey(
  symbol: string,
  contractMode: ContractMode,
  barrier: number | null
): string {
  return `${symbol}:${contractMode}:${barrier ?? ''}`;
}

function isNoReturnContractError(error: unknown): boolean {
  if (!isDerivApiError(error)) return false;
  const code = error.code.replace(/[^a-z]/gi, '').toLowerCase();
  if (code.includes('noreturn') || code.includes('returnunavailable')) return true;

  return /\bcontract\b.{0,80}\b(?:offers?\s+no\s+returns?|has\s+no\s+returns?|does\s+not\s+offer\s+(?:any\s+)?returns?)\b/i
    .test(error.message);
}

async function scanMarkets(
  ws: NonNullable<UseBaseTradingParams['ws']>,
  symbols: ActiveSymbol[],
  strategy: UserTradingStrategy,
  shouldStop: () => boolean,
  subscribeToActiveTicks: ActiveTickSubscriber,
  historyCache: Map<string, MarketHistoryCacheEntry>,
  historyRequestScheduler: MarketHistoryRequestScheduler,
  onProgress: MarketScanProgressCallback
): Promise<MarketScanResult | null | typeof CONNECTION_LOST> {
  const openSymbols = Array.from(
    new Map(
      getScannableMarkets(symbols).map((symbol) => [symbol.underlying_symbol, symbol])
    ).values()
  );
  if (openSymbols.length === 0) {
    throw new Error('No open, unsuspended continuous indices are available to scan.');
  }
  const triggerLengths = strategy.triggers.map((trigger) => {
    switch (trigger.kind) {
      case 'digit':
        return 1;
      case 'sequence':
        return trigger.digits.length;
      default:
        return trigger.length;
    }
  });
  const minimumTriggerLength = triggerLengths.length > 0
    ? Math.min(...triggerLengths)
    : 1;
  const pricesBySymbol = new Map<string, number[]>();
  const lastTickBySymbol = new Map<string, string>();
  const pendingTicksBySymbol = new Map<string, Tick[]>();
  const historyTailBySymbol = new Map<string, { epoch: number | null; quote: number | null }>();

  return new Promise((resolve, reject) => {
    let finished = false;
    let availableFeeds = 0;
    const unavailableSymbols = new Set<string>();
    const historyResolvedSymbols = new Set<string>();
    const historyLoadedSymbols = new Set<string>();
    const historyUnavailableSymbols = new Set<string>();
    const liveUpdatedSymbols = new Set<string>();
    let settledSubscriptions = 0;
    let pendingSubscriptions = 0;
    let pollForStop: ReturnType<typeof setInterval> | null = null;
    let scanTimeout: ReturnType<typeof setTimeout> | null = null;
    let removeConnectionListener = () => {};
    let lastProgressKey = '';
    const activeUnsubscribers = new Set<() => void>();
    const streamUnsubscribers = new Set<() => Promise<void>>();

    const getScanResult = (): MarketScanResult => {
      const candidates: MarketScanCandidate[] = [];
      for (const symbol of openSymbols) {
        const symbolCode = symbol.underlying_symbol;
        if (!historyResolvedSymbols.has(symbolCode)) continue;
        candidates.push(
          ...evaluateUserTradingStrategy(
            symbol,
            pricesBySymbol.get(symbolCode) ?? [],
            strategy
          )
        );
      }

      return {
        candidates,
        historyLoadedMarkets: historyLoadedSymbols.size,
        unavailableMarkets: unavailableSymbols.size,
        historyUnavailableMarkets: historyUnavailableSymbols.size,
      };
    };

    const reportProgress = () => {
      const progressKey =
        `${historyLoadedSymbols.size}:${unavailableSymbols.size}:${historyUnavailableSymbols.size}`;
      if (progressKey === lastProgressKey) return;
      lastProgressKey = progressKey;
      onProgress(
        historyLoadedSymbols.size,
        openSymbols.length,
        unavailableSymbols.size,
        historyUnavailableSymbols.size
      );
    };

    const finish = (result: MarketScanResult | null | typeof CONNECTION_LOST, error?: Error) => {
      if (finished) return;
      finished = true;
      if (pollForStop) clearInterval(pollForStop);
      if (scanTimeout) clearTimeout(scanTimeout);
      removeConnectionListener();
      activeUnsubscribers.forEach((unsubscribe) => unsubscribe());
      activeUnsubscribers.clear();

      void (async () => {
        await Promise.all(
          Array.from(streamUnsubscribers, (unsubscribe) => unsubscribe())
        );
        if (error) reject(error);
        else resolve(result);
      })();
    };

    const appendLiveTick = (symbolCode: string, tick: Tick) => {
      const historyTail = historyTailBySymbol.get(symbolCode);
      if (
        historyTail &&
        historyTail.epoch !== null &&
        (
          tick.epoch < historyTail.epoch ||
          (tick.epoch === historyTail.epoch && tick.quote === historyTail.quote)
        )
      ) {
        return false;
      }

      const prices = pricesBySymbol.get(symbolCode) ?? [];
      prices.push(tick.quote);
      if (prices.length > MARKET_SCAN_TICK_COUNT) {
        prices.splice(0, prices.length - MARKET_SCAN_TICK_COUNT);
      }
      pricesBySymbol.set(symbolCode, prices);
      liveUpdatedSymbols.add(symbolCode);
      const cachedHistory = historyCache.get(symbolCode);
      historyCache.set(symbolCode, {
        prices,
        lastEpoch: tick.epoch,
        lastQuote: tick.quote,
        historicalSeeded: cachedHistory?.historicalSeeded ?? false,
        retryAfter: cachedHistory?.retryAfter ?? 0,
        lastUpdatedAt: Date.now(),
      });
      return true;
    };

    const waitForHistoryRequestSlot = async (intervalMs: number) => {
      const waitMs = Math.max(0, historyRequestScheduler.nextRequestAt - Date.now());
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      if (finished || shouldStop()) return false;
      historyRequestScheduler.nextRequestAt = Date.now() + intervalMs;
      return true;
    };

    const initializeHistory = (
      symbolCode: string,
      prices: number[],
      times: number[],
      mode: 'full' | 'incremental' | 'cached',
      retryAfter = 0
    ) => {
      if (finished || historyResolvedSymbols.has(symbolCode)) return;
      const cachedHistory = historyCache.get(symbolCode);
      let historyPrices = mode === 'full'
        ? prices.filter(Number.isFinite).slice(-MARKET_SCAN_TICK_COUNT)
        : [...(cachedHistory?.prices ?? [])];
      let lastHistoryEpoch = mode === 'full'
        ? (() => {
            const historyTimes = times.filter(Number.isFinite);
            return historyTimes[historyTimes.length - 1] ?? null;
          })()
        : cachedHistory?.lastEpoch ?? null;
      let lastHistoryQuote = historyPrices[historyPrices.length - 1] ?? null;

      if (mode === 'incremental') {
        const historyTimes = times.filter(Number.isFinite);
        const historyValues = prices.filter(Number.isFinite);
        const updateCount = Math.min(historyTimes.length, historyValues.length);
        for (let index = 0; index < updateCount; index += 1) {
          const epoch = historyTimes[index]!;
          const quote = historyValues[index]!;
          if (
            lastHistoryEpoch !== null &&
            (
              epoch < lastHistoryEpoch ||
              (epoch === lastHistoryEpoch && quote === lastHistoryQuote)
            )
          ) {
            continue;
          }
          historyPrices.push(quote);
          if (historyPrices.length > MARKET_SCAN_TICK_COUNT) {
            historyPrices.splice(0, historyPrices.length - MARKET_SCAN_TICK_COUNT);
          }
          lastHistoryEpoch = epoch;
          lastHistoryQuote = quote;
        }
      } else if (mode === 'full') {
        lastHistoryQuote = historyPrices[historyPrices.length - 1] ?? null;
      }

      const historicalSeeded = mode === 'full'
        ? historyPrices.length > 0
        : cachedHistory?.historicalSeeded ?? false;
      historyTailBySymbol.set(symbolCode, {
        epoch: lastHistoryEpoch,
        quote: lastHistoryQuote,
      });
      pricesBySymbol.set(symbolCode, historyPrices);
      historyCache.set(symbolCode, {
        prices: historyPrices,
        lastEpoch: lastHistoryEpoch,
        lastQuote: lastHistoryQuote,
        historicalSeeded,
        retryAfter: retryAfter || cachedHistory?.retryAfter || 0,
        lastUpdatedAt: mode === 'cached'
          ? cachedHistory?.lastUpdatedAt ?? Date.now()
          : Date.now(),
      });
      historyResolvedSymbols.add(symbolCode);
      if (historicalSeeded) historyLoadedSymbols.add(symbolCode);
      else historyUnavailableSymbols.add(symbolCode);

      const pendingTicks = pendingTicksBySymbol.get(symbolCode) ?? [];
      pendingTicksBySymbol.delete(symbolCode);
      pendingTicks.sort((left, right) => left.epoch - right.epoch);
      pendingTicks.forEach((tick) => appendLiveTick(symbolCode, tick));
      reportProgress();
      checkScanCompletion();
    };

    const loadHistory = async (symbolCode: string) => {
      const cachedHistory = historyCache.get(symbolCode);
      if (cachedHistory?.historicalSeeded && cachedHistory.lastEpoch === null) {
        initializeHistory(symbolCode, [], [], 'cached');
        return;
      }
      if (cachedHistory?.retryAfter && cachedHistory.retryAfter > Date.now()) {
        initializeHistory(symbolCode, [], [], 'cached', cachedHistory.retryAfter);
        return;
      }
      if (historyRequestScheduler.rateLimitedUntil > Date.now()) {
        initializeHistory(symbolCode, [], [], 'cached', historyRequestScheduler.rateLimitedUntil);
        return;
      }
      if (
        cachedHistory?.historicalSeeded &&
        Date.now() - cachedHistory.lastUpdatedAt < 3_000
      ) {
        initializeHistory(symbolCode, [], [], 'cached');
        return;
      }
      const incremental = cachedHistory?.historicalSeeded === true;
      try {
        const intervalMs = incremental ? 250 : 1000;
        if (!await waitForHistoryRequestSlot(intervalMs)) return;
        const response = await ws.send<TicksHistoryResponse>({
          ticks_history: symbolCode,
          end: 'latest',
          ...(incremental
            ? { start: (cachedHistory.lastEpoch ?? 0) + 1 }
            : { start: 1, count: MARKET_SCAN_TICK_COUNT }),
          style: 'ticks',
        });
        if (
          !response.history ||
          !Array.isArray(response.history.prices) ||
          !Array.isArray(response.history.times)
        ) {
          throw new Error('The market history response did not contain tick prices and times.');
        }
        initializeHistory(
          symbolCode,
          response.history.prices,
          response.history.times,
          incremental ? 'incremental' : 'full'
        );
      } catch (error) {
        if (finished) return;
        const fallbackCache = historyCache.get(symbolCode);
        const isRateLimited = isDerivApiError(error) &&
          /rate.?limit|ticks_history_expensive/i.test(error.code);
        const retryAfter = Date.now() + (fallbackCache?.historicalSeeded ? 5_000 : 15_000);
        if (isRateLimited) {
          historyRequestScheduler.rateLimitedUntil = retryAfter;
        }
        console.warn('[strategy bot] Could not refresh historical ticks; continuing with cached or live ticks.', {
          symbol: symbolCode,
          error,
        });
        initializeHistory(symbolCode, [], [], 'cached', retryAfter);
      }
    };

    const handleTick = (symbolCode: string, tick: Tick) => {
      if (finished) return;
      if (shouldStop()) {
        finish(getScanResult());
        return;
      }
      if (tick.symbol !== symbolCode || !Number.isFinite(tick.quote)) return;

      const tickKey = `${tick.epoch}:${tick.id}`;
      if (lastTickBySymbol.get(symbolCode) === tickKey) return;
      lastTickBySymbol.set(symbolCode, tickKey);

      if (!historyResolvedSymbols.has(symbolCode)) {
        const pendingTicks = pendingTicksBySymbol.get(symbolCode) ?? [];
        pendingTicks.push(tick);
        if (pendingTicks.length > MARKET_SCAN_TICK_COUNT) pendingTicks.shift();
        pendingTicksBySymbol.set(symbolCode, pendingTicks);
        return;
      }
      appendLiveTick(symbolCode, tick);
      reportProgress();
      checkScanCompletion();
    };

    const activeSymbols = new Set<string>();
    for (const symbol of openSymbols) {
      const unsubscribe = subscribeToActiveTicks(
        symbol.underlying_symbol,
        (tick) => handleTick(symbol.underlying_symbol, tick)
      );
      if (!unsubscribe) continue;
      activeSymbols.add(symbol.underlying_symbol);
      activeUnsubscribers.add(unsubscribe);
      availableFeeds += 1;
    }

    pendingSubscriptions = openSymbols.length - activeSymbols.size;
    const isMarketReady = (symbol: ActiveSymbol) => {
      const symbolCode = symbol.underlying_symbol;
      return historyResolvedSymbols.has(symbolCode) &&
        (
          unavailableSymbols.has(symbolCode) ||
          liveUpdatedSymbols.has(symbolCode)
        ) &&
        (
          (pricesBySymbol.get(symbolCode)?.length ?? 0) >= minimumTriggerLength
        );
    };
    const checkSubscriptionSetup = () => {
      if (
        !finished &&
        settledSubscriptions === pendingSubscriptions &&
        availableFeeds === 0
      ) {
        setTimeout(() => {
          if (!ws.isConnected) {
            finish(CONNECTION_LOST);
          }
        }, 0);
      }
    };

    const checkScanCompletion = () => {
      if (
        !finished &&
        availableFeeds > 0 &&
        openSymbols.every(isMarketReady)
      ) {
        finish(getScanResult());
      }
    };

    pollForStop = setInterval(() => {
      if (shouldStop()) finish(getScanResult());
    }, CONNECTION_POLL_INTERVAL_MS);
    scanTimeout = setTimeout(() => {
      if (!finished) {
        for (const symbol of openSymbols) {
          const symbolCode = symbol.underlying_symbol;
          if (!historyResolvedSymbols.has(symbolCode)) {
            initializeHistory(symbolCode, [], [], 'cached');
          }
          if (!liveUpdatedSymbols.has(symbolCode)) {
            unavailableSymbols.add(symbolCode);
          }
        }
        reportProgress();
        checkScanCompletion();
        if (finished) return;
        const result = getScanResult();
        if (result.candidates.length === 0) {
          finish(
            null,
            new Error('No market digit history was available to select a market within 15 seconds.')
          );
        } else {
          finish(result);
        }
      }
    }, MARKET_SCAN_TIMEOUT_MS);
    removeConnectionListener = ws.onConnectionStateChange((connected) => {
      if (!connected) finish(CONNECTION_LOST);
    });

    for (const symbol of openSymbols) {
      if (finished || activeSymbols.has(symbol.underlying_symbol)) continue;
      void ws.subscribe(
        { ticks: symbol.underlying_symbol },
        (data) => {
          const tick = data.tick as Tick | undefined;
          if (tick) handleTick(symbol.underlying_symbol, tick);
        }
      ).then(async (subscription) => {
        if (finished) {
          await subscription.unsubscribe();
          return;
        }
        streamUnsubscribers.add(subscription.unsubscribe);
        availableFeeds += 1;
        checkScanCompletion();
      }).catch((error: unknown) => {
        unavailableSymbols.add(symbol.underlying_symbol);
        console.warn('[strategy bot] Could not start a live tick feed.', {
          symbol: symbol.underlying_symbol,
          error,
        });
        if (!finished) {
          reportProgress();
          checkScanCompletion();
        }
      }).finally(() => {
        settledSubscriptions += 1;
        checkSubscriptionSetup();
      });
    }

    void (async () => {
      for (const symbol of openSymbols) {
        if (finished || shouldStop()) return;
        await loadHistory(symbol.underlying_symbol);
      }
    })();

    if (pendingSubscriptions === 0) {
      checkSubscriptionSetup();
    }
  });
}

export interface AutoTradingThresholdResult {
  outcome: 'take-profit' | 'stop-loss';
  profit: number;
  market: string;
}

async function waitForConnection(
  ws: NonNullable<UseBaseTradingParams['ws']>,
  deadline: number,
  shouldStop: () => boolean = () => false
): Promise<boolean> {
  while (!ws.isConnected) {
    if (shouldStop()) return false;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('Timed out waiting for the WebSocket connection to recover.');
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(CONNECTION_POLL_INTERVAL_MS, remaining)));
  }
  return true;
}

async function waitForContractSettlement(
  ws: NonNullable<UseBaseTradingParams['ws']>,
  contractId: number
): Promise<number> {
  const deadline = Date.now() + CONTRACT_SETTLEMENT_TIMEOUT_MS;

  while (true) {
    await waitForConnection(ws, deadline);

    let unsubscribe: () => Promise<void> = async () => {};
    let hasSubscription = false;
    let finished = false;
    let connectionDropped = false;
    let removeConnectionListener = () => {};
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const settlement = new Promise<number>((resolve, reject) => {
      void ws.subscribe(
        { proposal_open_contract: 1, contract_id: contractId },
        (data) => {
          const contract = data.proposal_open_contract as Partial<OpenPosition> | undefined;
          if (!contract) return;
          const isClosed = contract.is_sold === 1 || contract.is_expired === 1 ||
            (typeof contract.status === 'string' && contract.status !== 'open');
          if (!isClosed) return;

          const profit = Number(contract.profit);
          if (!Number.isFinite(profit)) {
            reject(new Error('The settled contract did not include a valid profit/loss value.'));
            return;
          }
          resolve(profit);
        }
      ).then((subscription) => {
        unsubscribe = subscription.unsubscribe;
        hasSubscription = true;
        if (finished) void unsubscribe();
      }).catch(reject);
    });

    const connectionLost = new Promise<typeof CONNECTION_LOST>((resolve) => {
      removeConnectionListener = ws.onConnectionStateChange((connected) => {
        if (connected) return;
        connectionDropped = true;
        resolve(CONNECTION_LOST);
      });
    });

    const remaining = deadline - Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Timed out waiting for the contract to settle. Auto-trading was stopped.')),
        Math.max(0, remaining)
      );
    });

    try {
      const result = await Promise.race([settlement, connectionLost, timeoutPromise]);
      if (result !== CONNECTION_LOST) return result;
    } catch (error) {
      if (!connectionDropped && ws.isConnected) throw error;
    } finally {
      finished = true;
      removeConnectionListener();
      if (timeout) clearTimeout(timeout);
      if (hasSubscription) await unsubscribe();
    }
  }
}

interface UseDigitsTradingReturn {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  symbols: ActiveSymbol[];
  activeSymbol: ActiveSymbol | null;
  selectSymbol: (symbol: string) => void;
  currentTick: Tick | null;
  lastDigit: number | null;
  digitStats: DigitStats;
  tradeType: TradeType;
  setTradeType: (type: TradeType) => void;
  contractMode: ContractMode;
  setContractMode: (mode: ContractMode) => void;
  selectedDigit: number | null;
  contractsAvailable: boolean;
  pipSize: number;
  stake: string;
  setStake: (value: string) => void;
  duration: number;
  setDuration: (value: number) => void;
  durationLimits: DurationLimits;
  defaultStake: number;
  proposal: ProposalInfo | null;
  isProposalLoading: boolean;
  buyContract: () => Promise<void>;
  startAutoTrading: (strategy: UserTradingStrategy, settings?: SavedBotSettings) => Promise<void>;
  isBuying: boolean;
  buyResult: BuyResult | null;
  buyError: string | null;
  clearBuyResult: () => void;
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
  sellContract: (contractId: number, bidPrice: string) => Promise<void>;
  sellingId: number | null;
  sellError: string | null;
  clearSellError: () => void;
  takeProfit: string;
  setTakeProfit: (value: string) => void;
  stopLoss: string;
  setStopLoss: (value: string) => void;
  martingaleMode: MartingaleMode;
  setMartingaleMode: (value: MartingaleMode) => void;
  martingaleValues: Record<MartingaleMode, string>;
  setMartingaleValue: (mode: MartingaleMode, value: string) => void;
  thresholdResult: AutoTradingThresholdResult | null;
  clearThresholdResult: () => void;
  resetAutoTradingSession: () => void;
  autoTradingStatus: AutoTradingStatus;
  autoTradingTradeCount: number;
  autoTradingProfit: number;
  autoTradingMarket: string | null;
  autoTradingEstimatedWinRate: number | null;
  autoTradingScanProgress: AutoTradingScanProgress | null;
  tradesPerMinute: string;
  setTradesPerMinute: (value: string) => void;
  runDurationHours: string;
  setRunDurationHours: (value: string) => void;
  autoTradingSchedule: AutoTradingScheduleProgress | null;
  stopAutoTrading: () => void;
}

export type UseDigitsTradingParams = Pick<UseBaseTradingParams, 'ws' | 'isConnected' | 'isExhausted' | 'isAuthenticated' | 'onAuthWSFailed'>;

export function useDigitsTrading({
  ws,
  isConnected,
  isExhausted,
  isAuthenticated,
  onAuthWSFailed,
}: UseDigitsTradingParams): UseDigitsTradingReturn {
  const { localize } = useAppTranslations();
  const {
    ws: tradingWs,
    isConnected: tradingIsConnected,
    isLoading,
    error,
    symbols,
    activeSymbol,
    selectSymbol,
    currentTick,
    prices,
    pipSize,
    contractsAvailable,
    durationLimits,
    defaultStake,
    openPositions,
    closedPositions,
    sellContract,
    sellingId,
    sellError,
    clearSellError,
  } = useBaseTrading({ ws, isConnected, isExhausted, isAuthenticated, onAuthWSFailed, contractTypes: CONTRACT_TYPES });

  // Digits-specific trade state
  const [tradeType, setTradeTypeRaw] = useState<TradeType>('matches-differs');
  const [contractMode, setContractModeRaw] = useState<ContractMode>('DIGITDIFF');
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [stake, setStake] = useState<string>(TRADING_DEFAULTS.stake);
  const [duration, setDuration] = useState<number>(TRADING_DEFAULTS.duration);
  const [takeProfit, setTakeProfit] = useState<string>(TRADING_DEFAULTS.takeProfit);
  const [stopLoss, setStopLoss] = useState<string>(TRADING_DEFAULTS.stopLoss);
  const [tradesPerMinute, setTradesPerMinute] = useState(
    String(TRADING_DEFAULTS.tradesPerMinute)
  );
  const [runDurationHours, setRunDurationHours] = useState(
    String(TRADING_DEFAULTS.runDurationHours)
  );
  const [martingaleMode, setMartingaleMode] = useState<MartingaleMode>('classic');
  const [martingaleValues, setMartingaleValues] = useState<Record<MartingaleMode, string>>({
    classic: TRADING_DEFAULTS.recoveryMultiplier,
    dynamic: TRADING_DEFAULTS.recoveryMultiplier,
    'super-hybrid': TRADING_DEFAULTS.recoveryMultiplier,
  });
  const [thresholdResult, setThresholdResult] = useState<AutoTradingThresholdResult | null>(null);
  const [autoTradingStatus, setAutoTradingStatus] = useState<AutoTradingStatus>('idle');
  const [autoTradingTradeCount, setAutoTradingTradeCount] = useState(0);
  const [autoTradingProfit, setAutoTradingProfit] = useState(0);
  const [autoTradingMarket, setAutoTradingMarket] = useState<string | null>(null);
  const [autoTradingEstimatedWinRate, setAutoTradingEstimatedWinRate] = useState<number | null>(null);
  const [autoTradingScanProgress, setAutoTradingScanProgress] =
    useState<AutoTradingScanProgress | null>(null);
  const [autoTradingSchedule, setAutoTradingSchedule] =
    useState<AutoTradingScheduleProgress | null>(null);
  const [strategyPredictionSeed, setStrategyPredictionSeed] = useState<{
    symbol: string;
    pipSize: number;
    prices: number[];
  } | null>(null);
  const autoSessionRef = useRef<{ stopRequested: boolean; scanOnly: boolean } | null>(null);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const autoSessionStatsRef = useRef({ profit: 0, tradeCount: 0, generation: 0 });
  const selectSymbolRef = useRef(selectSymbol);
  const activeSymbolRef = useRef(activeSymbol);
  const activeTickListenersRef = useRef(new Map<string, Set<(tick: Tick) => void>>());
  const lastForwardedTickRef = useRef<string | null>(null);
  activeSymbolRef.current = activeSymbol;

  const setContractMode = useCallback((mode: ContractMode) => {
    setContractModeRaw(mode);
    if (mode === 'DIGITOVER') {
      setSelectedDigit(1);
    } else if (mode === 'DIGITUNDER') {
      setSelectedDigit(8);
    } else {
      setSelectedDigit(null);
    }
  }, []);

  useEffect(() => {
    selectSymbolRef.current = selectSymbol;
  }, [selectSymbol]);

  const subscribeToActiveTicks = useCallback<ActiveTickSubscriber>((symbol, handler) => {
    if (activeSymbolRef.current?.underlying_symbol !== symbol) return null;

    const listeners = activeTickListenersRef.current.get(symbol) ?? new Set<(tick: Tick) => void>();
    listeners.add(handler);
    activeTickListenersRef.current.set(symbol, listeners);

    return () => {
      listeners.delete(handler);
      if (listeners.size === 0) activeTickListenersRef.current.delete(symbol);
    };
  }, []);

  useEffect(() => {
    if (!activeSymbol || !currentTick || currentTick.symbol !== activeSymbol.underlying_symbol) return;

    const tickKey = `${currentTick.symbol}:${currentTick.epoch}:${currentTick.id}`;
    if (lastForwardedTickRef.current === tickKey) return;
    lastForwardedTickRef.current = tickKey;

    activeTickListenersRef.current
      .get(currentTick.symbol)
      ?.forEach((handler) => handler(currentTick));
  }, [activeSymbol, currentTick]);

  const setMartingaleValue = useCallback((mode: MartingaleMode, value: string) => {
    setMartingaleValues((current) => ({ ...current, [mode]: value }));
  }, []);

  const clearThresholdResult = useCallback(() => {
    setThresholdResult(null);
  }, []);

  const resetAutoTradingSession = useCallback(() => {
    autoSessionStatsRef.current = {
      profit: 0,
      tradeCount: 0,
      generation: autoSessionStatsRef.current.generation + 1,
    };
    setAutoTradingTradeCount(0);
    setAutoTradingProfit(0);
    setThresholdResult(null);
  }, []);

  const stopAutoTrading = useCallback(() => {
    if (!autoSessionRef.current) return;
    autoSessionRef.current.stopRequested = true;
    setAutoTradingScanProgress(null);
    setAutoTradingStatus('stopping');
  }, []);

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
    const activeSession = autoSessionRef.current;
    if (!isAuthenticated && activeSession && !activeSession.scanOnly) {
      stopAutoTrading();
    }
  }, [isAuthenticated, stopAutoTrading]);

  // Reset contract mode to the first option of the selected trade type
  const setTradeType = useCallback((type: TradeType) => {
    setTradeTypeRaw(type);
    switch (type) {
      case 'matches-differs':
        setContractMode('DIGITDIFF');
        break;
      case 'over-under':
        setContractMode('DIGITOVER');
        break;
      case 'even-odd':
        setContractMode('DIGITEVEN');
        break;
    }
  }, [setContractMode]);

  const useStrategyPredictionSeed =
    activeSymbol?.underlying_symbol === strategyPredictionSeed?.symbol &&
    prices.length < (strategyPredictionSeed?.prices.length ?? 0);
  const predictionPrices = useMemo(
    () => useStrategyPredictionSeed
      ? [...(strategyPredictionSeed?.prices ?? []), ...prices].slice(-MARKET_SCAN_TICK_COUNT)
      : prices,
    [prices, strategyPredictionSeed, useStrategyPredictionSeed]
  );
  const predictionPipSize = useStrategyPredictionSeed && strategyPredictionSeed
    ? strategyPredictionSeed.pipSize
    : pipSize;
  const digitStats: DigitStats = useMemo(
    () => computeDigitStats(predictionPrices, predictionPipSize),
    [predictionPrices, predictionPipSize]
  );

  const lastDigit = useMemo(() => {
    if (currentTick) {
      return getLastDigit(currentTick.quote, pipSize);
    }
    if (predictionPrices.length > 0) {
      return getLastDigit(predictionPrices[predictionPrices.length - 1], predictionPipSize);
    }
    return null;
  }, [currentTick, predictionPrices, predictionPipSize]);

  const {
    buyContract: buyWithProposal,
    isBuying,
    buyResult,
    buyError,
    clearBuyResult,
  } = useBuy(tradingWs, tradingIsConnected);

  // Null out params while a buy is in-flight — forces useProposal to unsubscribe
  // the consumed proposal ID. When isBuying flips back to false, the memo returns
  // real params and useProposal re-subscribes to get a fresh proposal.
  const proposalParams: ProposalParams | null = useMemo(() => {
    if (isBuying || !activeSymbol) return null;
    if (contractMode === 'DIGITDIFF' && selectedDigit === null) return null;
    const stakeNum = parseFloat(stake);
    if (!stakeNum || stakeNum <= 0) return null;

    const barrier = getContractBarrier(contractMode, selectedDigit);

    return {
      contractType: contractMode,
      symbol: activeSymbol.underlying_symbol,
      amount: stakeNum,
      duration,
      durationUnit: 't',
      basis: 'stake' as const,
      currency: 'USD',
      ...(barrier !== undefined ? { barrier } : {}),
    };
  }, [activeSymbol, contractMode, stake, duration, selectedDigit, isBuying]);

  const { proposal } = useProposal(tradingWs, tradingIsConnected, proposalParams);

  const buyContract = useCallback(async () => {
    if (autoSessionRef.current) {
      stopAutoTrading();
      return;
    }
    if (!tradingWs?.isConnected || !proposal?.id) {
      toast.error(localize('Contract quote is not ready'), {
        description: localize('Wait for a live quote before purchasing.'),
      });
      return;
    }

    try {
      await buyWithProposal({
        id: proposal.id,
        askPrice: proposal.askPrice,
        payout: proposal.payout,
        longcode: proposal.longcode,
        minStake: proposal.minStake,
        maxPayout: proposal.maxPayout,
      });
    } catch (error) {
      toast.error(localize('Contract purchase failed'), {
        description: error instanceof Error ? error.message : localize('The purchase could not be completed.'),
      });
    }
  }, [buyWithProposal, localize, proposal, stopAutoTrading, tradingWs]);

  const startAutoTrading = useCallback(async (
    strategy: UserTradingStrategy,
    settings: SavedBotSettings = {}
  ) => {
    if (autoSessionRef.current) {
      stopAutoTrading();
      return;
    }

    const parseTarget = (value: string, label: string): number | null => {
      if (value.trim() === '') return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(localize('{{label}} must be greater than zero.', { label }));
      }
      return parsed;
    };

    let takeProfitTarget: number | null;
    let stopLossTarget: number | null;
    const parsedTradesPerMinute = Number(tradesPerMinute);
    const parsedRunDurationHours = Number(runDurationHours);
    const scanOnly = !isAuthenticated;
    const baseStake = Number(settings.stake ?? stake);
    const tradeDuration = settings.duration ?? duration;
    const recoveryEnabled = settings.recoveryEnabled === true;
    const multiplier = !recoveryEnabled
      ? 1
      : Number(settings.recoveryMultiplier ?? martingaleValues[martingaleMode]);
    try {
      takeProfitTarget = parseTarget(settings.takeProfit ?? takeProfit, localize('Take profit'));
      stopLossTarget = parseTarget(settings.stopLoss ?? stopLoss, localize('Stop loss'));
      if (!scanOnly && takeProfitTarget === null && stopLossTarget === null) {
        throw new Error(localize('Set a take-profit or stop-loss target before starting the strategy bot.'));
      }
      if (!Number.isFinite(baseStake) || baseStake <= 0) {
        throw new Error(localize('Stake must be greater than zero.'));
      }
      if (!Number.isInteger(tradeDuration) || tradeDuration < 1 || tradeDuration > 200) {
        throw new Error(localize('Duration must be between 1 and 200 ticks.'));
      }
      if (!Number.isFinite(multiplier) || multiplier < 1) {
        throw new Error(localize('Martingale multiplier must be at least 1.'));
      }
      if (!Number.isInteger(parsedTradesPerMinute) ||
        parsedTradesPerMinute < AUTO_TRADING_SCHEDULE_LIMITS.minTradesPerMinute ||
        parsedTradesPerMinute > AUTO_TRADING_SCHEDULE_LIMITS.maxTradesPerMinute) {
        throw new Error(localize('Trades per minute must be between {{min}} and {{max}}.', {
          min: AUTO_TRADING_SCHEDULE_LIMITS.minTradesPerMinute,
          max: AUTO_TRADING_SCHEDULE_LIMITS.maxTradesPerMinute,
        }));
      }
      if (!Number.isInteger(parsedRunDurationHours) ||
        parsedRunDurationHours < AUTO_TRADING_SCHEDULE_LIMITS.minDurationHours ||
        parsedRunDurationHours > AUTO_TRADING_SCHEDULE_LIMITS.maxDurationHours) {
        throw new Error(localize('Run duration must be between {{min}} and {{max}} hours.', {
          min: AUTO_TRADING_SCHEDULE_LIMITS.minDurationHours,
          max: AUTO_TRADING_SCHEDULE_LIMITS.maxDurationHours,
        }));
      }
      if (!tradingWs?.isConnected || !tradingIsConnected) {
        throw new Error(localize('Connect to the live market before starting a scanner session.'));
      }
      if (symbols.length === 0) throw new Error(localize('No markets are available to scan.'));
    } catch (error) {
      toast.error(localize('Risk settings are invalid'), {
        description: error instanceof Error ? error.message : localize('Check your risk settings and try again.'),
      });
      return;
    }

    const session = { stopRequested: false, scanOnly };
    // Keep minute limits aligned to this session's start time.
    const scheduleStartedAt = Date.now();
    const scheduleDeadlineAt = scheduleStartedAt + parsedRunDurationHours * 60 * 60 * 1000;
    autoSessionRef.current = session;
    setAutoTradingSchedule({
      tradesPerMinute: parsedTradesPerMinute,
      durationHours: parsedRunDurationHours,
      deadlineAt: scheduleDeadlineAt,
      tradesInCurrentMinute: 0,
      waitingForNextMinute: false,
      nextIntervalAt: null,
    });
    setThresholdResult(null);
    setAutoTradingStatus('scanning');
    setSelectedDigit(strategy.barrier);
    setAutoTradingTradeCount(0);
    setAutoTradingProfit(0);
    setAutoTradingMarket(null);
    setAutoTradingEstimatedWinRate(null);
    setAutoTradingScanProgress(null);

    autoSessionStatsRef.current = {
      profit: 0,
      tradeCount: 0,
      generation: autoSessionStatsRef.current.generation + 1,
    };
    let nextStake = baseStake;
    let martingaleProgress = { ...initialMartingaleProgress };
    let reachedThreshold: AutoTradingThresholdResult | null = null;
    const rejectedCandidates = new Map<string, number>();
    const skippedUnfavorableCandidates = new Set<string>();
    const marketHistoryCache = new Map<string, MarketHistoryCacheEntry>();
    const historyRequestScheduler: MarketHistoryRequestScheduler = {
      nextRequestAt: 0,
      rateLimitedUntil: 0,
    };
    if (activeSymbol && prices.length > 0) {
      const activePrices = prices.filter(Number.isFinite).slice(-MARKET_SCAN_TICK_COUNT);
      if (
        currentTick?.symbol === activeSymbol.underlying_symbol &&
        activePrices[activePrices.length - 1] !== currentTick.quote
      ) {
        activePrices.push(currentTick.quote);
        if (activePrices.length > MARKET_SCAN_TICK_COUNT) activePrices.shift();
      }
      marketHistoryCache.set(activeSymbol.underlying_symbol, {
        prices: activePrices,
        lastEpoch: currentTick?.symbol === activeSymbol.underlying_symbol
          ? currentTick.epoch
          : null,
        lastQuote: activePrices[activePrices.length - 1] ?? null,
        historicalSeeded: activePrices.length >= MARKET_SCAN_TICK_COUNT,
        retryAfter: 0,
        lastUpdatedAt: Date.now(),
      });
    }
    const baseGroup = getStrategyGroup(strategy);
    let recoveryState: StrategyRecoveryState | null = baseGroup && recoveryEnabled
      ? createStrategyRecoveryState(
          baseGroup,
          settings.recoveryGroup ?? 'auto'
        )
      : null;
    let scanNumber = 0;
    let minuteWindowIndex = 0;
    const tradesByMinute = new Map<number, number>();

    const updateMinuteWindow = () => {
      const currentMinuteWindow = Math.floor(
        (Date.now() - scheduleStartedAt) / 60_000
      );
      if (currentMinuteWindow === minuteWindowIndex) return;
      minuteWindowIndex = currentMinuteWindow;
      setAutoTradingSchedule((schedule) =>
        schedule
          ? {
              ...schedule,
              tradesInCurrentMinute: tradesByMinute.get(minuteWindowIndex) ?? 0,
            }
          : null
      );
    };

    const scheduleTicker = setInterval(updateMinuteWindow, 1000);
    const waitForScheduledSlot = async (): Promise<boolean> => {
      let waitingForNextMinute = false;
      while (!session.stopRequested) {
        const now = Date.now();
        if (now >= scheduleDeadlineAt) return false;
        updateMinuteWindow();
        const tradesThisMinute = tradesByMinute.get(minuteWindowIndex) ?? 0;
        if (tradesThisMinute < parsedTradesPerMinute) {
          if (waitingForNextMinute) {
            setAutoTradingSchedule((schedule) =>
              schedule
                ? { ...schedule, waitingForNextMinute: false, nextIntervalAt: null }
                : null
            );
          }
          return true;
        }
        const nextMinuteAt = scheduleStartedAt + (minuteWindowIndex + 1) * 60_000;
        if (!waitingForNextMinute) {
          waitingForNextMinute = true;
          setAutoTradingSchedule((schedule) =>
            schedule
              ? { ...schedule, waitingForNextMinute: true, nextIntervalAt: nextMinuteAt }
              : null
          );
        }

        const waitMs = Math.max(
          1,
          Math.min(nextMinuteAt, scheduleDeadlineAt) - Date.now()
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(CONNECTION_POLL_INTERVAL_MS, waitMs))
        );
      }
      return false;
    };

    const scanForMarket = async (): Promise<ScannedMarketSelection | null> => {
      setAutoTradingStatus('scanning');
      setAutoTradingMarket(null);
      setAutoTradingEstimatedWinRate(null);

      while (!session.stopRequested && Date.now() < scheduleDeadlineAt) {
        const connected = await waitForConnection(
          tradingWs,
          Math.min(Date.now() + CONTRACT_SETTLEMENT_TIMEOUT_MS, scheduleDeadlineAt),
          () => session.stopRequested || Date.now() >= scheduleDeadlineAt
        );
        if (!connected) {
          return null;
        }
        scanNumber += 1;
        const activeGroup = recoveryState?.activeGroup ?? baseGroup;
        const activeStrategy = activeGroup
          ? createStrategyForGroup(strategy, activeGroup)
          : strategy;
        const ruleDescription = activeGroup
          ? `Group ${activeGroup}: ${strategy.description}`
          : strategy.description;

        const eligibleMarkets = getScannableMarkets(symbols);
        if (eligibleMarkets.length === 0) {
          throw new Error(localize('No open, unsuspended continuous indices are available to scan.'));
        }
        const totalMarkets = eligibleMarkets.length;
        setAutoTradingScanProgress({
          phase: 'scanning',
          scanOnly,
          historyLoadedMarkets: 0,
          totalMarkets,
          unavailableMarkets: 0,
          historyUnavailableMarkets: 0,
          evaluatedCandidates: 0,
          eligibleCandidates: 0,
          scanNumber,
          ruleDescription,
          baseGroup: recoveryState?.baseGroup ?? null,
          activeGroup,
          recoveryActive: recoveryState?.recoveryActive ?? false,
          selectedMarket: null,
          selectedContractMode: null,
          estimatedWinRate: null,
          prediction: null,
          skippedUnfavorableCandidates: skippedUnfavorableCandidates.size,
        });

        const scanResult = await scanMarkets(
          tradingWs,
          eligibleMarkets,
          activeStrategy,
          () => session.stopRequested || Date.now() >= scheduleDeadlineAt,
          subscribeToActiveTicks,
          marketHistoryCache,
          historyRequestScheduler,
          (historyLoadedMarkets, marketCount, unavailableMarkets, historyUnavailableMarkets) => {
            setAutoTradingScanProgress((progress) =>
              progress?.phase === 'scanning'
                ? {
                    ...progress,
                    historyLoadedMarkets,
                    totalMarkets: marketCount,
                    unavailableMarkets,
                    historyUnavailableMarkets,
                  }
                : progress
            );
          }
        );
        if (session.stopRequested) return null;
        if (Date.now() >= scheduleDeadlineAt) return null;
        if (scanResult === CONNECTION_LOST) continue;
        if (!scanResult) continue;

        setAutoTradingScanProgress((progress) =>
          progress?.phase === 'scanning'
            ? {
                ...progress,
                phase: 'evaluating',
                historyLoadedMarkets: scanResult.historyLoadedMarkets,
                unavailableMarkets: scanResult.unavailableMarkets,
                historyUnavailableMarkets: scanResult.historyUnavailableMarkets,
              }
            : progress
        );

        const candidatesToEvaluate = scanResult.candidates.filter((candidate) => {
          const key = getScanCandidateKey(
            candidate.symbol.underlying_symbol,
            candidate.contractMode,
            candidate.barrier
          );
          const rejectedUntil = rejectedCandidates.get(key);
          if (rejectedUntil === undefined) return true;
          if (rejectedUntil <= Date.now()) {
            rejectedCandidates.delete(key);
            return true;
          }
          return false;
        });
        const candidatePool = candidatesToEvaluate;
        const recoveryActive = recoveryState?.recoveryActive ?? false;
        const signalCandidates = candidatePool.filter((candidate) =>
          isTradingCandidateQualified(candidate)
        );
        const recoveryCandidates = recoveryActive
          ? signalCandidates.filter((candidate) => isRecoveryCandidateQualified(candidate))
          : signalCandidates;
        const bestAvailableCandidate = recoveryCandidates.length === 0
          ? chooseBestHistoricalScanCandidate(
              candidatePool.length > 0 ? candidatePool : scanResult.candidates
            )
          : null;
        setAutoTradingScanProgress((progress) =>
          progress?.phase === 'evaluating'
            ? {
                ...progress,
                evaluatedCandidates: scanResult.candidates.length,
                eligibleCandidates: recoveryCandidates.length,
                prediction: bestAvailableCandidate
                  ? getCandidatePrediction(bestAvailableCandidate, scanNumber)
                  : null,
              }
            : progress
        );
        if (recoveryCandidates.length > 0) {
          const qualifiedCandidate =
            chooseBestHistoricalScanCandidate(recoveryCandidates);
          if (qualifiedCandidate) {
            return { candidate: qualifiedCandidate, qualified: true };
          }
        }

        const fallbackCandidate = candidatePool.length > 0
          ? chooseBestHistoricalScanCandidate(candidatePool)
          : null;
        if (fallbackCandidate) {
          return {
            candidate: fallbackCandidate,
            qualified: false,
          };
        }

        const rejectedUntil = candidatePool.length === 0
          ? Math.min(...rejectedCandidates.values())
          : Number.POSITIVE_INFINITY;
        const retryDelay = Number.isFinite(rejectedUntil)
          ? Math.max(0, rejectedUntil - Date.now())
          : Math.min(1_000, Math.max(0, scheduleDeadlineAt - Date.now()));
        if (retryDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
        continue;
      }
      return null;
    };

    const useScannedMarket = (candidate: ScoredMarketScanCandidate) => {
      const prediction = getCandidatePrediction(
        candidate,
        scanNumber
      );
      setContractMode(candidate.contractMode);
      setTradeTypeRaw(
        candidate.contractMode === 'DIGITOVER' || candidate.contractMode === 'DIGITUNDER'
          ? 'over-under'
          : candidate.contractMode === 'DIGITEVEN' || candidate.contractMode === 'DIGITODD'
            ? 'even-odd'
            : 'matches-differs'
      );
      const marketName =
        candidate.symbol.underlying_symbol_name || candidate.symbol.underlying_symbol;
      if (candidate.barrier !== null) {
        setSelectedDigit(candidate.barrier);
      } else {
        setSelectedDigit(null);
      }
      setStrategyPredictionSeed({
        symbol: candidate.symbol.underlying_symbol,
        pipSize: pipSizeFromPip(candidate.symbol.pip_size),
        prices: candidate.predictionPrices,
      });
      selectSymbolRef.current(candidate.symbol.underlying_symbol);
      setAutoTradingMarket(marketName);
      setAutoTradingEstimatedWinRate(candidate.estimatedWinRate);
      setAutoTradingScanProgress((progress) =>
        progress
          ? {
              ...progress,
              phase: 'selected',
              selectedMarket: marketName,
              selectedContractMode: candidate.contractMode,
              estimatedWinRate: candidate.estimatedWinRate,
              prediction,
            }
          : progress
      );
      setAutoTradingStatus('running');
    };

    const skipUnfavorableCandidate = (candidate: MarketScanCandidate) => {
      const candidateKey = getScanCandidateKey(
        candidate.symbol.underlying_symbol,
        candidate.contractMode,
        candidate.barrier
      );
      rejectedCandidates.set(candidateKey, Date.now() + 5000);
      skippedUnfavorableCandidates.add(candidateKey);

      setAutoTradingScanProgress((progress) =>
        progress
          ? {
              ...progress,
              skippedUnfavorableCandidates: skippedUnfavorableCandidates.size,
            }
          : progress
      );
    };

    try {
      while (!session.stopRequested) {
        const hasScheduledSlot = await waitForScheduledSlot();
        if (!hasScheduledSlot) break;
        const selection = await scanForMarket();
        if (!selection) break;
        const { candidate, qualified } = selection;
        if (Date.now() >= scheduleDeadlineAt) break;
        if (!scanOnly && !isAuthenticatedRef.current) {
          session.stopRequested = true;
          break;
        }
        if (scanOnly) {
          const marketName =
            candidate.symbol.underlying_symbol_name || candidate.symbol.underlying_symbol;
          setAutoTradingMarket(marketName);
          setAutoTradingEstimatedWinRate(candidate.estimatedWinRate);
          setAutoTradingScanProgress((progress) =>
            progress
              ? {
                  ...progress,
                  phase: 'preview',
                  selectedMarket: marketName,
                  selectedContractMode: candidate.contractMode,
                  estimatedWinRate: candidate.estimatedWinRate,
                  prediction: getCandidatePrediction(candidate, scanNumber),
                }
              : progress
          );
          await new Promise((resolve) => setTimeout(resolve, MARKET_SCAN_TIMEOUT_MS));
          if (session.stopRequested) break;
          continue;
        }
        const market = candidate.symbol;

        const connected = await waitForConnection(
          tradingWs,
          Math.min(Date.now() + CONTRACT_SETTLEMENT_TIMEOUT_MS, scheduleDeadlineAt),
          () => session.stopRequested || Date.now() >= scheduleDeadlineAt
        );
        if (!connected) break;

        const barrier = candidate.barrier ?? undefined;
        const proposalParams = {
          proposal: 1,
          amount: nextStake,
          basis: 'stake',
          contract_type: candidate.contractMode,
          currency: 'USD',
          underlying_symbol: market.underlying_symbol,
          duration: tradeDuration,
          duration_unit: 't',
          ...(barrier !== undefined ? { barrier } : {}),
        };
        let proposalResponse: ProposalResponse;
        let connectionDropped = false;
        const removeConnectionListener = tradingWs.onConnectionStateChange((isConnected) => {
          if (!isConnected) connectionDropped = true;
        });
        try {
          proposalResponse = await tradingWs.send<ProposalResponse>(proposalParams);
        } catch (error) {
          if (session.stopRequested) break;
          if (isNoReturnContractError(error)) {
            skipUnfavorableCandidate(candidate);
            continue;
          }
          if (!connectionDropped && tradingWs.isConnected) throw error;
          const reconnected = await waitForConnection(
            tradingWs,
            Math.min(Date.now() + CONTRACT_SETTLEMENT_TIMEOUT_MS, scheduleDeadlineAt),
            () => session.stopRequested || Date.now() >= scheduleDeadlineAt
          );
          if (!reconnected) {
            break;
          }
          continue;
        } finally {
          removeConnectionListener();
        }
        if (session.stopRequested) break;
        const quote = proposalResponse.proposal;
        if (!quote?.id || !Number.isFinite(quote.ask_price) || quote.ask_price <= 0) {
          throw new Error(localize('Could not get a valid proposal for the next trade.'));
        }
        if (!Number.isFinite(quote.payout) || quote.payout <= 0) {
          throw new Error(localize('The proposal did not include a valid potential payout.'));
        }
        const marketQuote = {
          askPrice: quote.ask_price,
          payout: quote.payout,
        };
        if (qualified && (
          !isTradingCandidateQualified(candidate, marketQuote) ||
          (
            recoveryState?.recoveryActive &&
            !isRecoveryCandidateQualified(candidate, marketQuote)
          )
        )) {
          skipUnfavorableCandidate(candidate);
          continue;
        }
        const refreshedCandidate = scoreMarketCandidate(candidate, marketQuote);
        if (!refreshedCandidate) {
          throw new Error(localize('The scanner could not score a valid market proposal.'));
        }
        useScannedMarket(refreshedCandidate);
        const hasPurchaseSlot = await waitForScheduledSlot();
        if (!hasPurchaseSlot) break;
        if (!tradingWs.isConnected) {
          const reconnected = await waitForConnection(
            tradingWs,
            Math.min(Date.now() + CONTRACT_SETTLEMENT_TIMEOUT_MS, scheduleDeadlineAt),
            () => session.stopRequested || Date.now() >= scheduleDeadlineAt
          );
          if (!reconnected) {
            break;
          }
          continue;
        }

        if (!isAuthenticatedRef.current) {
          session.stopRequested = true;
          break;
        }

        let connectionDroppedDuringPurchase = false;
        const removePurchaseConnectionListener = tradingWs.onConnectionStateChange((isConnected) => {
          if (!isConnected) connectionDroppedDuringPurchase = true;
        });
        let purchase: Awaited<ReturnType<typeof buyWithProposal>>;
        let purchaseError: unknown = null;
        const purchaseStartedAt = Date.now();
        try {
          purchase = await buyWithProposal({
            id: quote.id,
            askPrice: quote.ask_price,
            payout: quote.payout,
            longcode: quote.longcode,
            minStake: Number(quote.validation_params?.stake?.min ?? 0),
            maxPayout: Number(quote.validation_params?.payout?.max ?? 0),
          }, (error) => {
            purchaseError = error;
            return isNoReturnContractError(error);
          });
        } finally {
          removePurchaseConnectionListener();
        }
        if (!purchase) {
          if (isNoReturnContractError(purchaseError)) {
            skipUnfavorableCandidate(candidate);
            continue;
          }
          if (connectionDroppedDuringPurchase || !tradingWs.isConnected) {
            throw new Error(localize(
              'The connection was interrupted while confirming a purchase. Check your transactions before starting another session.'
            ));
          }
          throw new Error(localize('Trade purchase failed. Auto-trading was stopped.'));
        }
        clearBuyResult();
        setAutoTradingScanProgress(null);
        const purchaseMinute = Math.floor(
          (purchaseStartedAt - scheduleStartedAt) / 60_000
        );
        tradesByMinute.set(
          purchaseMinute,
          (tradesByMinute.get(purchaseMinute) ?? 0) + 1
        );
        updateMinuteWindow();
        setAutoTradingSchedule((schedule) =>
          schedule
            ? {
                ...schedule,
                tradesInCurrentMinute: tradesByMinute.get(minuteWindowIndex) ?? 0,
              }
            : null
        );

        const tradeGeneration = autoSessionStatsRef.current.generation;
        autoSessionStatsRef.current.tradeCount += 1;
        setAutoTradingTradeCount(autoSessionStatsRef.current.tradeCount);
        const settledProfit = await waitForContractSettlement(tradingWs, purchase.contractId);
        if (tradeGeneration === autoSessionStatsRef.current.generation) {
          autoSessionStatsRef.current.profit =
            Math.round((autoSessionStatsRef.current.profit + settledProfit) * 100) / 100;
          setAutoTradingProfit(autoSessionStatsRef.current.profit);
        }
        if (recoveryState) {
          const previousRecoveryState = recoveryState;
          recoveryState = advanceStrategyRecoveryState(recoveryState, settledProfit);
          if (
            recoveryState.activeGroup === recoveryState.baseGroup &&
            previousRecoveryState.recoveryActive
          ) {
            toast.info(localize('Recovery win: returning to Group {{group}}.', {
              group: recoveryState.baseGroup,
            }));
          } else if (recoveryState.activeGroup !== previousRecoveryState.activeGroup) {
            toast.info(localize('Recovery loss: switching to Group {{group}} contracts.', {
              group: recoveryState.activeGroup,
            }));
          }
        }
        const sessionProfit = autoSessionStatsRef.current.profit;

        if (takeProfitTarget !== null && sessionProfit >= takeProfitTarget) {
          reachedThreshold = {
            outcome: 'take-profit',
            profit: sessionProfit,
            market: market.underlying_symbol_name || market.underlying_symbol,
          };
          setThresholdResult(reachedThreshold);
          break;
        }
        if (stopLossTarget !== null && sessionProfit <= -stopLossTarget) {
          reachedThreshold = {
            outcome: 'stop-loss',
            profit: sessionProfit,
            market: market.underlying_symbol_name || market.underlying_symbol,
          };
          setThresholdResult(reachedThreshold);
          break;
        }

        const next = getNextMartingaleStake(
          baseStake,
          multiplier,
          martingaleMode,
          settledProfit,
          martingaleProgress
        );
        nextStake = next.stake;
        if (!Number.isFinite(nextStake) || nextStake <= 0) {
          throw new Error(localize('Martingale stake exceeded the supported numeric range. Auto-trading was stopped.'));
        }
        martingaleProgress = next.progress;

      }

    } catch (error) {
      const message = error instanceof Error ? error.message : localize('Auto-trading stopped unexpectedly.');
      toast.error(localize('Auto-trading stopped'), { description: message });
    } finally {
      clearInterval(scheduleTicker);
      autoSessionRef.current = null;
      setAutoTradingScanProgress(null);
      setAutoTradingSchedule(null);
      setAutoTradingStatus('idle');
    }
  }, [
    buyWithProposal,
    clearBuyResult,
    duration,
    isAuthenticated,
    localize,
    martingaleMode,
    martingaleValues,
    setContractMode,
    subscribeToActiveTicks,
    symbols,
    stake,
    stopAutoTrading,
    stopLoss,
    takeProfit,
    tradesPerMinute,
    runDurationHours,
    tradingIsConnected,
    tradingWs,
  ]);

  return {
    isConnected,
    isLoading,
    error,
    symbols,
    activeSymbol,
    selectSymbol,
    currentTick,
    lastDigit,
    digitStats,
    tradeType,
    setTradeType,
    contractMode,
    setContractMode,
    selectedDigit,
    contractsAvailable,
    pipSize,
    stake,
    setStake,
    duration,
    setDuration,
    durationLimits,
    defaultStake,
    proposal,
    isProposalLoading: isConnected && proposalParams !== null && proposal === null,
    buyContract,
    startAutoTrading,
    isBuying,
    buyResult,
    buyError,
    clearBuyResult,
    openPositions,
    closedPositions,
    sellContract,
    sellingId,
    sellError,
    clearSellError,
    takeProfit,
    setTakeProfit,
    stopLoss,
    setStopLoss,
    martingaleMode,
    setMartingaleMode,
    martingaleValues,
    setMartingaleValue,
    thresholdResult,
    clearThresholdResult,
    resetAutoTradingSession,
    autoTradingStatus,
    autoTradingTradeCount,
    autoTradingProfit,
    autoTradingMarket,
    autoTradingEstimatedWinRate,
    autoTradingScanProgress,
    tradesPerMinute,
    setTradesPerMinute,
    runDurationHours,
    setRunDurationHours,
    autoTradingSchedule,
    stopAutoTrading,
  };
}
