'use client';

import { CheckCircle2, Radar } from 'lucide-react';
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
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {isSelected || isPreview ? (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
            ) : (
              <div className="market-scanner-radar relative grid h-12 w-12 shrink-0 place-items-center rounded-full border border-primary/40 text-primary">
                <span className="market-scanner-radar-grid" aria-hidden="true" />
                <span className="market-scanner-radar-dot" aria-hidden="true" />
                <Radar className="relative z-10 h-5 w-5" />
              </div>
            )}
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

        {prediction ? (
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
