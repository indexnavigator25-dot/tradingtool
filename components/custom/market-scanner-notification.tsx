'use client';

import { CheckCircle2, Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import type {
  AutoTradingScanProgress,
  AutoTradingScheduleProgress,
} from '@/hooks/use-digits-trading';

interface MarketScannerNotificationProps {
  progress: AutoTradingScanProgress | null;
  schedule: AutoTradingScheduleProgress | null;
  nextIntervalCountdown: string;
  nextIntervalProgress: number;
  groupName: string;
  status: 'idle' | 'scanning' | 'running' | 'stopping';
  onStop: () => void;
}

interface MarketScannerWaitingAnimationProps {
  countdown: string;
  progress: number;
  tradesUsed: number;
  tradesLimit: number;
}

export function MarketScannerWaitingAnimation({
  countdown,
  progress,
  tradesUsed,
  tradesLimit,
}: MarketScannerWaitingAnimationProps) {
  const { localize } = useAppTranslations();
  const progressPercent = Math.min(100, Math.max(0, progress));

  return (
    <div className="scanner-interval-hud relative w-full overflow-hidden rounded-xl border border-primary/40 text-left">
      <div className="scanner-interval-sheen" aria-hidden="true" />
      <div className="relative z-10 grid grid-cols-[4.5rem_1fr] items-center gap-3 p-3 sm:grid-cols-[5rem_1fr] sm:p-4">
        <div
          className="scanner-interval-orbit relative grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full sm:h-20 sm:w-20"
          style={{
            backgroundImage: `conic-gradient(from -90deg, rgb(var(--primary)) ${progressPercent}%, rgb(255 190 64 / 0.9) ${progressPercent}%, rgb(var(--primary) / 0.12) ${progressPercent}% 100%)`,
          }}
        >
          <div className="scanner-interval-clock flex h-[3.85rem] w-[3.85rem] flex-col items-center justify-center rounded-full sm:h-[4.4rem] sm:w-[4.4rem]">
            <span
              role="timer"
              aria-label={localize('Next interval in {{countdown}}', { countdown })}
              className="font-mono text-base font-black tabular-nums text-foreground sm:text-lg"
            >
              {countdown}
            </span>
            <span className="text-[8px] font-bold tracking-[0.18em] text-primary">
              {localize('MIN:SEC')}
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.2em] text-primary sm:text-xs">
              {localize('NEXT INTERVAL')}
            </p>
            <span className="scanner-interval-live shrink-0 rounded-full border border-amber-400/40 px-2 py-0.5 text-[8px] font-black tracking-widest text-amber-300">
              {localize('WAIT')}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>{localize('TRADE SLOTS')}</span>
            <span className="font-mono text-foreground">
              {tradesUsed}/{tradesLimit}
            </span>
          </div>
          <div
            className="scanner-interval-segments mt-2 flex gap-1"
            role="progressbar"
            aria-label={localize('Interval countdown progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPercent)}
          >
            {Array.from({ length: 16 }, (_, index) => (
              <span
                key={index}
                className={index < (progressPercent / 100) * 16 ? 'is-filled' : ''}
              />
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between text-[8px] font-semibold tracking-widest text-muted-foreground">
            <span>{localize('{{percent}}% COMPLETE', { percent: Math.round(progressPercent) })}</span>
            <span>{localize('SCANNER')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketScannerNotification({
  progress,
  schedule,
  nextIntervalCountdown,
  nextIntervalProgress,
  groupName,
  status,
  onStop,
}: MarketScannerNotificationProps) {
  const { localize } = useAppTranslations();
  if (!progress) return null;

  const isSelected = progress.phase === 'selected';
  const isPreview = progress.phase === 'preview';
  const isEvaluating = progress.phase === 'evaluating';
  const isWaiting = schedule?.waitingForNextMinute === true;
  const isComplete = (isSelected || isPreview) && !isWaiting;
  const isLiveScanning = (progress.phase === 'scanning' || isEvaluating) && !isWaiting;
  const prediction = progress.prediction;
  const hasSignal = prediction?.ruleMatched ?? false;
  const resolvedHistoryMarkets =
    progress.historyLoadedMarkets + progress.historyUnavailableMarkets;
  const progressPercent = progress.totalMarkets > 0
    ? Math.min(100, (resolvedHistoryMarkets / progress.totalMarkets) * 100)
    : 0;
  const showcaseProgress = isComplete
    ? 100
    : isWaiting
      ? nextIntervalProgress
      : progressPercent;
  const activeGroup = progress.activeGroup ?? progress.baseGroup;
  const showcaseGroup = activeGroup
    ? localize('Group {{group}}', { group: activeGroup })
    : groupName;
  const statusText = isWaiting
    ? localize('WAITING FOR NEXT INTERVAL')
    : isSelected
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
  const candidatePercent = progress.evaluatedCandidates > 0
    ? Math.min(100, (progress.eligibleCandidates / progress.evaluatedCandidates) * 100)
    : 0;
  const scoreFactors = prediction?.scoreFactors
    ? [
        { label: localize('Win rate'), value: prediction.scoreFactors.historicalWinRate },
        { label: localize('Recent'), value: prediction.scoreFactors.recentSignalAccuracy },
        { label: localize('Edge'), value: prediction.scoreFactors.statisticalEdge },
        { label: localize('Consistency'), value: prediction.scoreFactors.consistency },
        { label: localize('Market'), value: prediction.scoreFactors.marketSuitability },
        { label: localize('Stability'), value: prediction.scoreFactors.drawdownStability },
      ]
    : [];

  return (
    <section
      aria-label={localize('Strategy bot progress')}
      className="flex h-full min-h-0 flex-col text-foreground"
    >
        <div
          className={`scanner-showcase relative mb-3 overflow-hidden rounded-xl border ${
            isWaiting ? 'is-waiting' : isLiveScanning ? 'is-active' : ''
          }`}
        >
          <div className="scanner-showcase-stars" aria-hidden="true" />
          <div className="scanner-showcase-header">
            <div className="min-w-0">
              <p className="scanner-showcase-title">{localize('Strategy Scanner')}</p>
              <p className="scanner-showcase-status">{statusText}</p>
            </div>
            <div className="scanner-showcase-badges">
              {isLiveScanning && (
                <span className="scanner-showcase-live">
                  <span aria-hidden="true" />
                  {localize('LIVE FEED')}
                </span>
              )}
              <span className="scanner-showcase-scan">
                {localize('Scan {{number}}', { number: progress.scanNumber })}
              </span>
            </div>
          </div>

          <div className="scanner-showcase-stage" aria-hidden="true">
            <div className="scanner-showcase-brain">
              <span className="scanner-showcase-brain-glow" />
              <span className="scanner-showcase-orbit scanner-showcase-orbit-outer" />
              <span className="scanner-showcase-orbit scanner-showcase-orbit-inner" />
              <svg
                className="scanner-showcase-brain-art"
                viewBox="0 0 220 150"
                fill="none"
              >
                <path
                  className="scanner-showcase-brain-outline"
                  d="M108 27c-8-16-29-18-39-5-16-3-29 10-28 25-16 7-18 29-5 40-5 18 10 34 27 33 8 15 29 18 41 6l6-6V30l-2-3Zm4 0c8-16 29-18 39-5 16-3 29 10 28 25 16 7 18 29 5 40 5 18-10 34-27 33-8 15-29 18-41 6l-6-6V30l2-3Z"
                />
                <path className="scanner-showcase-brain-line" d="M108 29v91M70 31c-5 13 3 22 13 25m-46-9c12 0 20 9 20 20m-17 20c13-4 23 3 25 15m-4 18c8-8 19-8 28-2m33-87c5 13-3 22-13 25m46-9c-12 0-20 9-20 20m17 20c-13-4-23 3-25 15m4 18c-8-8-19-8-28-2M64 53c11 2 17 10 16 21m-18 13c10-4 19 0 23 9m70-43c-11 2-17 10-16 21m18 13c-10-4-19 0-23 9" />
                <path className="scanner-showcase-brain-network" d="m108 40-20 11 8 19-22 8 12 20-16 13m38-71 21 11-8 19 22 8-12 20 16 13m-51-51 26 1m-28 19 26 1m-26 20 26 1" />
                <g className="scanner-showcase-brain-nodes">
                  <circle cx="88" cy="51" r="2.4" /><circle cx="96" cy="70" r="2.4" />
                  <circle cx="74" cy="78" r="2.4" /><circle cx="86" cy="98" r="2.4" />
                  <circle cx="70" cy="111" r="2.4" /><circle cx="132" cy="51" r="2.4" />
                  <circle cx="124" cy="70" r="2.4" /><circle cx="146" cy="78" r="2.4" />
                  <circle cx="134" cy="98" r="2.4" /><circle cx="150" cy="111" r="2.4" />
                  <circle cx="109" cy="40" r="2.4" /><circle cx="109" cy="90" r="2.4" />
                </g>
              </svg>
            </div>
            <div
              className="scanner-showcase-radar"
              role="img"
              aria-label={localize('Scanning radar')}
            >
              <span className="scanner-showcase-radar-sweep" />
              <span className="scanner-showcase-radar-blip" />
            </div>
            <span className="scanner-showcase-data scanner-showcase-data-left">
              {localize('MARKET SCAN')}
            </span>
            <span className="scanner-showcase-data scanner-showcase-data-right">
              {localize('LIVE ANALYSIS')}
            </span>
          </div>

          <div className="scanner-showcase-group">
            <span className="scanner-showcase-chevron" aria-hidden="true">«</span>
            <div className="min-w-0 text-center">
              <span className="scanner-showcase-group-caption">
                {localize('Strategy Group')}
              </span>
              <span className="scanner-showcase-group-name">{showcaseGroup}</span>
            </div>
            <span className="scanner-showcase-chevron" aria-hidden="true">»</span>
          </div>

          <div
            className="scanner-showcase-progress"
            role="progressbar"
            aria-label={localize('Market scan progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(showcaseProgress)}
          >
            <span style={{ width: `${showcaseProgress}%` }} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[4.25rem_1fr] gap-3">
          <div
            role="status"
            aria-label={localize('{{percent}} percent of market histories resolved', {
              percent: Math.round(progressPercent),
            })}
            className="market-scanner-progress-ring h-[4.25rem] w-[4.25rem] shrink-0 rounded-full p-[3px] shadow-[0_0_20px_rgb(var(--primary)/0.2)]"
            style={{
              backgroundImage: `conic-gradient(from -90deg, rgb(var(--primary)) ${progressPercent}%, rgb(var(--primary) / 0.14) ${progressPercent}% 100%)`,
            }}
          >
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-background">
              {isComplete ? (
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
          </div>
          <div className="grid min-w-0 grid-cols-3 gap-1.5">
            {[
              {
                label: localize('Markets'),
                value: `${progress.historyLoadedMarkets}/${progress.totalMarkets}`,
                detail: localize('HISTORY'),
                percent: progressPercent,
              },
              {
                label: localize('Candidates'),
                value: `${progress.eligibleCandidates}/${progress.evaluatedCandidates}`,
                detail: localize('ELIGIBLE'),
                percent: candidatePercent,
              },
              {
                label: localize('Signals'),
                value: String(prediction?.triggerMatches ?? 0),
                detail: `${prediction?.sampleCount ?? 0} ${localize('TICKS')}`,
                percent: prediction && prediction.sampleCount > 0
                  ? Math.min(100, (prediction.triggerMatches / prediction.sampleCount) * 100)
                  : 0,
              },
            ].map((metric, index) => (
              <div
                key={metric.label}
                className="market-scanner-metric min-w-0 rounded-lg border border-primary/20 bg-background/70 p-2"
                style={{ animationDelay: `${index * 180}ms` }}
              >
                <p className="truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  {metric.label}
                </p>
                <p className="mt-1 truncate font-mono text-sm font-bold tabular-nums text-foreground transition-all duration-300">
                  {metric.value}
                </p>
                <p className="truncate text-[8px] font-semibold tracking-wider text-muted-foreground">
                  {metric.detail}
                </p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="market-scanner-meter-fill h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                    style={{ width: `${metric.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        {(progress.recoveryActive || progress.unavailableMarkets > 0 ||
          progress.historyUnavailableMarkets > 0 || progress.skippedUnfavorableCandidates > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {progress.recoveryActive && progress.activeGroup && (
              <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                {localize('RECOVERY {{group}}', { group: progress.activeGroup })}
              </span>
            )}
            {progress.unavailableMarkets > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                {localize('LIVE GAP {{count}}', { count: progress.unavailableMarkets })}
              </span>
            )}
            {progress.historyUnavailableMarkets > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                {localize('HISTORY GAP {{count}}', { count: progress.historyUnavailableMarkets })}
              </span>
            )}
            {progress.skippedUnfavorableCandidates > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                {localize('SKIPPED {{count}}', { count: progress.skippedUnfavorableCandidates })}
              </span>
            )}
          </div>
        )}

        {isWaiting ? (
          <div className="mt-3">
            <MarketScannerWaitingAnimation
              countdown={nextIntervalCountdown}
              progress={nextIntervalProgress}
              tradesUsed={schedule?.tradesInCurrentMinute ?? 0}
              tradesLimit={schedule?.tradesPerMinute ?? 0}
            />
          </div>
        ) : prediction ? (
          <div className="mt-3 space-y-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {localize(isSelected ? 'SELECTED' : 'TOP PICK')}
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
                  {localize('SCORE / 100')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                  {localize('WIN RATE')}
                </p>
                <p className="font-mono text-xs font-bold tabular-nums">
                  {(prediction.estimatedWinRate * 100).toFixed(0)}%
                </p>
              </div>
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                  {localize('RETURN')}
                </p>
                <p className={`font-mono text-xs font-bold tabular-nums ${
                  prediction.expectedReturn !== null && prediction.expectedReturn < 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-foreground'
                }`}>
                  {prediction.expectedReturn === null
                    ? '—'
                    : `${prediction.expectedReturn.toFixed(2)} USD`}
                </p>
              </div>
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                  {localize('ENTRY')}
                </p>
                <p className={`text-xs font-bold ${
                  prediction.ruleMatched ? 'text-emerald-500' : 'text-amber-500'
                }`}>
                  {prediction.ruleMatched ? localize('MATCH') : localize('WAIT')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {scoreFactors.map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border/60 bg-background/50 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1 text-[8px] text-muted-foreground">
                    <span>{label}</span>
                    <span className="font-mono font-semibold text-foreground">
                      {(value * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="market-scanner-meter-fill h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                      style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t border-border/70 pt-2 text-[9px] font-semibold text-muted-foreground">
              <span>{localize('SIGNALS {{count}}', { count: prediction.triggerMatches })}</span>
              <span>{localize('TICKS {{count}}', { count: prediction.sampleCount })}</span>
            </div>
          </div>
        ) : (
          <div
            role="status"
            aria-label={statusText}
            className={`market-scanner-waveform mt-3 flex h-12 items-end gap-1 rounded-xl border border-primary/20 bg-muted/30 px-3 py-2 ${
              isLiveScanning ? 'is-active' : ''
            }`}
          >
            {[25, 55, 35, 75, 45, 90, 50, 70, 30, 60, 40, 80].map((height, index) => (
              <span
                key={index}
                className="market-scanner-waveform-bar flex-1 rounded-t-sm bg-primary/70"
                style={{ height: `${height}%`, animationDelay: `${index * 45}ms` }}
              />
            ))}
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
