'use client';

import { Activity, CheckCircle2, Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import type { AutoTradingScanProgress } from '@/hooks/use-digits-trading';

interface MarketScannerNotificationProps {
  progress: AutoTradingScanProgress | null;
  status: 'idle' | 'scanning' | 'running' | 'stopping';
  onStop: () => void;
}

export function MarketScannerNotification({
  progress,
  status,
  onStop,
}: MarketScannerNotificationProps) {
  const { localize } = useAppTranslations();
  if (!progress) return null;

  const isSelected = progress.phase === 'selected';
  const isPreview = progress.phase === 'preview';
  const isEvaluating = progress.phase === 'evaluating';
  const isLiveScanning = progress.phase === 'scanning' || isEvaluating;
  const prediction = progress.prediction;
  const hasSignal = prediction?.ruleMatched ?? false;
  const resolvedHistoryMarkets =
    progress.historyLoadedMarkets + progress.historyUnavailableMarkets;
  const progressPercent = progress.totalMarkets > 0
    ? Math.min(100, (resolvedHistoryMarkets / progress.totalMarkets) * 100)
    : 0;
  const allHistoriesResolved = progress.totalMarkets > 0 &&
    resolvedHistoryMarkets >= progress.totalMarkets;
  const statusText = isSelected
    ? localize('MARKET SELECTED')
    : isPreview
      ? localize('PREVIEW ONLY · NO TRADE')
    : progress.scanOnly
      ? localize('TEST MODE · NO TRADES')
    : isEvaluating
      ? localize('RANKING ELIGIBLE MARKETS')
      : hasSignal
        ? localize('ENTRY CONDITION FOUND')
        : localize('WAITING FOR RULE');
  const predictionContractLabel = (() => {
    switch (prediction?.contractMode) {
      case 'DIGITDIFF':
        return localize('Differs');
      case 'DIGITOVER':
        return localize('Over');
      case 'DIGITUNDER':
        return localize('Under');
      case 'DIGITEVEN':
        return localize('Even');
      case 'DIGITODD':
        return localize('Odd');
      default:
        return null;
    }
  })();
  const description = isSelected
    ? localize('Starting trade')
    : isPreview
      ? localize('Scan-only mode; no trade was placed')
    : isEvaluating
      ? localize('Comparing market scores and payout')
    : allHistoriesResolved
      ? localize('Merging live ticks into rolling histories')
      : progress.historyLoadedMarkets > 0
        ? localize('Loading historical tick data')
        : localize('Connecting live feeds');
  const scoreFactors = prediction?.scoreFactors
    ? [
        { label: localize('Historical win rate (25%)'), value: prediction.scoreFactors.historicalWinRate },
        { label: localize('Recent signal accuracy (20%)'), value: prediction.scoreFactors.recentSignalAccuracy },
        { label: localize('Edge over random (20%)'), value: prediction.scoreFactors.statisticalEdge },
        { label: localize('Result consistency (15%)'), value: prediction.scoreFactors.consistency },
        { label: localize('Market suitability (10%)'), value: prediction.scoreFactors.marketSuitability },
        { label: localize('Drawdown stability (10%)'), value: prediction.scoreFactors.drawdownStability },
      ]
    : [];

  return (
    <section
      aria-label={localize('Strategy bot progress')}
      className="flex h-full min-h-0 flex-col text-foreground"
    >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/35 bg-primary/10 text-primary">
              {isSelected || isPreview ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : (
                <Radar className="market-scan-spinner h-6 w-6" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold tracking-wide">
                {localize('Strategy Bot')}
              </p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                {statusText}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isLiveScanning && (
              <span className="inline-flex items-center gap-1.5 text-[9px] font-bold tracking-wider text-emerald-500">
                <span className="relative inline-flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {localize('LIVE FEED')}
              </span>
            )}
            <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[10px] font-bold tabular-nums text-primary">
              {localize('Scan {{number}}', { number: progress.scanNumber })}
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div
            role="status"
            aria-label={localize('{{percent}} percent of market histories resolved', {
              percent: Math.round(progressPercent),
            })}
            className="flex h-[4.25rem] w-[4.25rem] shrink-0 flex-col items-center justify-center rounded-full border-2 border-primary/45 bg-primary/5 shadow-[0_0_20px_rgb(var(--primary)/0.16)]"
          >
            {isSelected ? (
              <CheckCircle2 className="h-7 w-7 text-primary" />
            ) : (
              <span className="font-mono text-3xl font-black tabular-nums text-primary">
                {String(Math.round(progressPercent)).padStart(2, '0')}
              </span>
            )}
            {!isSelected && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                {localize('Live')}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              {!isSelected && <Activity className="h-3.5 w-3.5 text-primary" />}
              <span aria-live="polite" aria-atomic="true">{description}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {localize('{{loaded}} of {{total}} market histories loaded (up to 1,000 ticks each)', {
                loaded: progress.historyLoadedMarkets,
                total: progress.totalMarkets,
              })}
            </p>
            {progress.unavailableMarkets > 0 && (
              <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {localize('{{count}} markets could not provide live tick updates', {
                  count: progress.unavailableMarkets,
                })}
              </p>
            )}
            {progress.historyUnavailableMarkets > 0 && (
              <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {localize('{{count}} histories could not be loaded; live ticks are used where available.', {
                  count: progress.historyUnavailableMarkets,
                })}
              </p>
            )}
            {isEvaluating && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {localize('{{evaluated}} evaluated · {{eligible}} eligible candidates', {
                  evaluated: progress.evaluatedCandidates,
                  eligible: progress.eligibleCandidates,
                })}
              </p>
            )}
            <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
              {localize('Bot rule: {{rule}}', { rule: progress.ruleDescription })}
            </p>
            {progress.recoveryActive && !progress.recoveryTerminal && progress.activeGroup && (
              <p className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                {localize('Recovery transition: Group {{group}} after a loss from Group {{baseGroup}} requires a matched entry, 10+ historical signals, at least 10% edge, and positive live expected return.', {
                  group: progress.activeGroup,
                  baseGroup: progress.baseGroup,
                })}
              </p>
            )}
            {progress.recoveryTerminal && (
              <p className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                {localize('Recovery is locked in Group C; it stays there and keeps the high-confidence entry filter.')}
              </p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {localize('Each scan rotates contract types and ranks rolling 1,000-tick histories within 15 seconds; recovery waits for high-confidence setups.')}
            </p>
            {progress.scanOnly && (
              <p className="mt-1 text-[11px] font-semibold text-primary">
                {localize('Test mode is read-only. Log in and start a new bot session to trade.')}
              </p>
            )}
            {progress.skippedUnfavorableCandidates > 0 && (
              <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {localize('{{count}} unfavorable setups skipped', {
                  count: progress.skippedUnfavorableCandidates,
                })}
              </p>
            )}
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={localize('Market histories')}
              aria-valuemin={0}
              aria-valuemax={Math.max(1, progress.totalMarkets)}
              aria-valuenow={resolvedHistoryMarkets}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {prediction ? (
          <div className="mt-3 space-y-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {localize(isSelected
                    ? 'Market selected after analysis'
                    : 'Best candidate after analysis')}
                </p>
                <p className="truncate text-sm font-bold" title={prediction.market}>
                  {progress.selectedMarket ?? prediction.market} · {predictionContractLabel}
                  {prediction.barrier !== null ? ` ${prediction.barrier}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-bold text-primary">
                  {prediction.weightedScore?.toFixed(1) ?? '—'}
                </p>
                <p className="text-[9px] font-medium text-muted-foreground">
                  {localize('Weighted score / 100')}
                </p>
              </div>
            </div>
            {prediction.expectedReturn !== null ? (
              <p className="text-[10px] font-medium text-muted-foreground">
                {localize('Expected return: {{amount}} USD per trade', {
                  amount: prediction.expectedReturn.toFixed(2),
                })}
              </p>
            ) : (
              <p className="text-[10px] font-medium text-muted-foreground">
                {localize('Selected by historical score; the live contract quote is checked before purchase.')}
              </p>
            )}
            {!prediction.ruleMatched && (
              <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                {localize('15-second fallback selected this setup before its entry rule matched.')}
              </p>
            )}
            {prediction.expectedReturn !== null && prediction.expectedReturn < 0 && (
              <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                {localize('The best available setup has a negative estimated return.')}
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border/70 pt-2 sm:grid-cols-3">
              {scoreFactors.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-1 text-[9px] text-muted-foreground">
                  <span>{label}</span>
                  <span className="font-mono font-semibold text-foreground">
                    {(value * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
            <p className="border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
              {localize('Entry: {{condition}}', { condition: prediction.triggerDescription })}
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
              <span>
                {localize('{{count}} historical signal outcomes from {{ticks}} ticks', {
                  count: prediction.triggerMatches,
                  ticks: prediction.sampleCount,
                })}
              </span>
              <span className={prediction.ruleMatched ? 'text-emerald-500' : 'text-amber-500'}>
                {prediction.ruleMatched
                  ? localize('Rule matched')
                  : localize('Waiting for rule')}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            {isEvaluating
              ? localize('Evaluating all market and contract directions before selecting one.')
              : localize('Analyzing rolling history; a market will be selected within 15 seconds.')}
          </div>
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3 h-8 w-full border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={onStop}
          disabled={status === 'stopping'}
        >
          {status === 'stopping'
            ? localize('Stopping...')
            : isSelected
              ? localize('Stop auto-trading')
              : localize('Stop scan')}
        </Button>
    </section>
  );
}
