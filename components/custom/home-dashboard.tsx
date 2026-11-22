'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActiveSymbol, AuthState, DerivAccount } from '@deriv/core';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  Plus,
  Radar,
  Radio,
  RotateCcw,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import type { SessionTransaction } from '@/hooks/use-session-transactions';
import type {
  AutoTradingScheduleProgress,
  AutoTradingScanProgress,
} from '@/hooks/use-digits-trading';
import type { SavedBot } from '@/components/strategy-builder';
import { MarketScannerNotification } from '@/components/custom/market-scanner-notification';
import { getSymbolDisplayName } from '@/lib/active-symbols-display-names';
import { formatUserTradingStrategyDescription } from '@/lib/user-trading-strategy';
import {
  formatDate,
  formatInteger,
  formatPercent,
  formatSignedAmount,
} from '@/lib/locale-format';
import { cn } from '@/lib/utils';
import { AUTO_TRADING_SCHEDULE_LIMITS } from '@/lib/trading-defaults';

type AutoTradingStatus = 'idle' | 'scanning' | 'running' | 'stopping';

interface HomeDashboardProps {
  authState: AuthState;
  activeAccount: DerivAccount | null;
  activeSymbol: ActiveSymbol | null;
  lastDigit: number | null;
  transactions: SessionTransaction[];
  savedBots: SavedBot[];
  autoTradingStatus: AutoTradingStatus;
  autoTradingScanProgress: AutoTradingScanProgress | null;
  autoTradingMarket: string | null;
  autoTradingTradeCount: number;
  tradesPerMinute: string;
  onTradesPerMinuteChange: (value: string) => void;
  runDurationHours: string;
  onRunDurationHoursChange: (value: string) => void;
  autoTradingSchedule: AutoTradingScheduleProgress | null;
  activeBotId: string | null;
  isConnected: boolean;
  onResetSession: () => void;
  onViewBots: () => void;
  onPreviewBot: (bot: SavedBot) => void;
  onStopAutoTrading: () => void;
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  valueClassName,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          {icon}
        </span>
      </div>
      <p className={cn('mt-3 truncate text-xl font-bold tabular-nums text-foreground sm:text-2xl', valueClassName)}>
        {value}
      </p>
      {detail && <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p>}
    </article>
  );
}

function formatTradeTime(timestamp: number, locale: string): string {
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function HomeDashboard({
  authState,
  activeAccount,
  activeSymbol,
  lastDigit,
  transactions,
  savedBots,
  autoTradingStatus,
  autoTradingScanProgress,
  autoTradingMarket,
  autoTradingTradeCount,
  tradesPerMinute,
  onTradesPerMinuteChange,
  runDurationHours,
  onRunDurationHoursChange,
  autoTradingSchedule,
  activeBotId,
  isConnected,
  onResetSession,
  onViewBots,
  onPreviewBot,
  onStopAutoTrading,
}: HomeDashboardProps) {
  const { localize, locale } = useAppTranslations();
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [scheduleClock, setScheduleClock] = useState(Date.now());
  useEffect(() => {
    if (!autoTradingSchedule) return;
    const updateClock = () => setScheduleClock(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [autoTradingSchedule?.deadlineAt]);
  const metrics = useMemo(() => {
    const now = new Date();
    const closedTrades = transactions.filter((trade) => trade.status === 'closed');
    const winningTrades = closedTrades.filter((trade) => trade.profit > 0).length;
    const tradesToday = transactions.filter(
      (trade) => new Date(trade.timestamp * 1000).toDateString() === now.toDateString()
    ).length;
    const sessionProfit = transactions.reduce(
      (total, trade) => total + (Number.isFinite(trade.profit) ? trade.profit : 0),
      0
    );

    return {
      closedTradeCount: closedTrades.length,
      lossTrades: closedTrades.filter((trade) => trade.profit < 0).length,
      profitTrades: winningTrades,
      sessionProfit,
      totalTrades: transactions.length,
      tradesToday,
      winRate: closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : null,
    };
  }, [transactions]);

  const allTrades = useMemo(
    () => [...transactions].sort((left, right) => right.timestamp - left.timestamp),
    [transactions]
  );
  const visibleTrades = showAllTrades ? allTrades : allTrades.slice(0, 5);
  const scheduleRemainingSeconds = autoTradingSchedule
    ? Math.max(0, Math.ceil((autoTradingSchedule.deadlineAt - scheduleClock) / 1000))
    : 0;
  const scheduleCountdown = [
    Math.floor(scheduleRemainingSeconds / 3600),
    Math.floor((scheduleRemainingSeconds % 3600) / 60),
    scheduleRemainingSeconds % 60,
  ].map((value) => String(value).padStart(2, '0')).join(':');
  const currency = transactions[0]?.currency || activeAccount?.currency || 'USD';
  const runningBots = autoTradingStatus === 'idle' ? 0 : 1;
  const activeBot = savedBots.find((bot) => bot.id === activeBotId);
  const marketName = activeSymbol
    ? getSymbolDisplayName(activeSymbol.underlying_symbol)
    : localize('Loading market');
  const isAuthenticated = authState === 'authenticated';
  const contractTypeLabels: Record<string, string> = {
    DIGITMATCH: localize('Digit Match'),
    DIGITDIFF: localize('Digit Differs'),
    DIGITOVER: localize('Digit Over'),
    DIGITUNDER: localize('Digit Under'),
    DIGITEVEN: localize('Digit Even'),
    DIGITODD: localize('Digit Odd'),
  };

  return (
    <section
      id="dashboard-overview"
      aria-labelledby="home-dashboard-title"
      className="mx-auto w-full max-w-[1280px] space-y-4 px-3 py-3 sm:space-y-5 sm:px-6 sm:py-5"
    >
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2
              id="home-dashboard-title"
              className="shrink-0 text-lg font-bold tracking-tight text-foreground sm:text-xl"
            >
              {localize('Dashboard')}
            </h2>
            <span className="hidden max-w-[180px] truncate rounded-full border border-border bg-card/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
              {activeAccount
                ? localize(activeAccount.account_type === 'demo' ? 'Demo account' : 'Real account')
                : localize('Market overview')}
              {activeAccount?.currency ? ` · ${activeAccount.currency}` : ''}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs sm:h-9 sm:px-3"
            onClick={onViewBots}
          >
            <Bot />
            {localize('Manage bots')}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 px-2.5 text-xs sm:h-9 sm:px-3"
            onClick={onViewBots}
          >
            <Plus />
            {localize('Create bot')}
          </Button>
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
            <Radio className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">
              {isConnected
                ? localize('Live market feed connected')
                : localize('Waiting for live market feed')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className={cn('h-2 w-2 rounded-full', isConnected ? 'bg-emerald-500' : 'bg-amber-500')} />
          <span className="max-w-[200px] truncate">{marketName}</span>
          <span className="text-border">·</span>
          <span>
            {localize('Last digit')} {lastDigit ?? '—'}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          icon={<Bot className="h-4 w-4" />}
          label={localize('Running bots')}
          value={formatInteger(runningBots, locale)}
          detail={activeBot?.name || localize('Saved bots: {{count}}', { count: savedBots.length })}
          valueClassName={runningBots > 0 ? 'text-emerald-500' : undefined}
        />
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          label={localize('Session P/L')}
          value={`${formatSignedAmount(metrics.sessionProfit, locale)} ${currency}`}
          valueClassName={metrics.sessionProfit > 0
            ? 'text-emerald-500'
            : metrics.sessionProfit < 0
              ? 'text-destructive'
              : undefined}
        />
        <MetricCard
          icon={<Clock3 className="h-4 w-4" />}
          label={localize('Trades today')}
          value={formatInteger(metrics.tradesToday, locale)}
          detail={localize('{{count}} trades this session', { count: transactions.length })}
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={localize('Win rate')}
          value={metrics.winRate === null ? '—' : formatPercent(metrics.winRate, 0, locale)}
          detail={metrics.closedTradeCount === 0
            ? localize('No closed trades yet')
            : localize('Based on {{count}} closed trades', { count: metrics.closedTradeCount })}
        />
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]">
        <section className="flex min-w-0 flex-col rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-foreground">{localize('Market scanner')}</h3>
            </div>
            <span className={cn(
              'shrink-0 rounded-md border px-2 py-1 text-[10px]',
              autoTradingStatus === 'idle'
                ? 'border-border bg-background/70 text-muted-foreground'
                : 'border-emerald-500/30 bg-emerald-500/10 font-semibold text-emerald-500'
            )}>
              {autoTradingStatus === 'idle'
                ? localize('Ready')
                : autoTradingStatus === 'stopping'
                  ? localize('Stopping...')
                  : autoTradingSchedule?.waitingForNextMinute
                    ? localize('Scheduled pause')
                    : autoTradingTradeCount > 0 && !autoTradingScanProgress
                      ? localize('Trade active')
                      : localize('Live')}
            </span>
          </div>

          {autoTradingStatus === 'idle' ? (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="scanner-trades-per-minute" className="text-[11px]">
                    {localize('Trades per minute')}
                  </Label>
                  <Input
                    id="scanner-trades-per-minute"
                    type="number"
                    min={AUTO_TRADING_SCHEDULE_LIMITS.minTradesPerMinute}
                    max={AUTO_TRADING_SCHEDULE_LIMITS.maxTradesPerMinute}
                    step="1"
                    value={tradesPerMinute}
                    onChange={(event) => onTradesPerMinuteChange(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scanner-run-duration" className="text-[11px]">
                    {localize('Run duration (hours)')}
                  </Label>
                  <Input
                    id="scanner-run-duration"
                    type="number"
                    min={AUTO_TRADING_SCHEDULE_LIMITS.minDurationHours}
                    max={AUTO_TRADING_SCHEDULE_LIMITS.maxDurationHours}
                    step="1"
                    value={runDurationHours}
                    onChange={(event) => onRunDurationHoursChange(event.target.value)}
                  />
                </div>
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {localize('Limit: {{min}}-{{max}} trades/minute; duration: {{minHours}}-{{maxHours}} hours. Only matching bot signals are traded.', {
                  min: AUTO_TRADING_SCHEDULE_LIMITS.minTradesPerMinute,
                  max: AUTO_TRADING_SCHEDULE_LIMITS.maxTradesPerMinute,
                  minHours: AUTO_TRADING_SCHEDULE_LIMITS.minDurationHours,
                  maxHours: AUTO_TRADING_SCHEDULE_LIMITS.maxDurationHours,
                })}
              </p>
            </div>
          ) : autoTradingScanProgress?.scanOnly ? (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-[10px] text-muted-foreground">
              <p className="font-semibold text-foreground">
                {localize('Test mode · not logged in')}
              </p>
              <p>{localize('Test mode scans markets only. Log in and start a new bot session to trade.')}</p>
            </div>
          ) : autoTradingSchedule ? (
            <div className="mt-3 space-y-1 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-[10px] text-muted-foreground">
              <p className="font-semibold text-foreground">
                {localize('{{count}} trades/minute · {{remaining}} remaining', {
                  count: autoTradingSchedule.tradesPerMinute,
                  remaining: scheduleCountdown,
                })}
              </p>
              <p>
                {localize('{{count}} of {{limit}} trade slots used this minute', {
                  count: autoTradingSchedule.tradesInCurrentMinute,
                  limit: autoTradingSchedule.tradesPerMinute,
                })}
              </p>
              {scheduleRemainingSeconds === 0 && (
                <p>{localize('Time limit reached; waiting for any open trade to settle.')}</p>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex-1">
            {autoTradingStatus !== 'idle' && autoTradingScanProgress ? (
              <MarketScannerNotification
                progress={autoTradingScanProgress}
                status={autoTradingStatus}
                onStop={onStopAutoTrading}
              />
            ) : autoTradingStatus !== 'idle' ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-primary/20 bg-primary/[0.04] px-4 py-5 text-center">
                <Radar className="market-scan-spinner h-7 w-7 text-primary" />
                <p className="mt-3 text-xs font-semibold text-foreground">
                  {autoTradingStatus === 'stopping'
                    ? localize('Stopping bot...')
                    : autoTradingSchedule?.waitingForNextMinute
                      ? localize('Waiting for next minute')
                      : autoTradingTradeCount > 0
                        ? localize('Trade in progress')
                        : localize('Connecting live feeds')}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3 h-8 border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={onStopAutoTrading}
                  disabled={autoTradingStatus === 'stopping'}
                >
                  {autoTradingStatus === 'stopping'
                    ? localize('Stopping...')
                    : localize('Stop scan')}
                </Button>
              </div>
            ) : (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border/80 px-4 py-5 text-center">
                <Radar className="h-7 w-7 text-muted-foreground/70" />
                <p className="mt-3 text-xs font-medium text-foreground">
                  {localize('Scanner is ready')}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3 h-8 px-3 text-[11px]"
                  onClick={onViewBots}
                >
                  {localize('Manage bots')}
                </Button>
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-foreground">{localize('Recent trades')}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-[11px]"
                aria-label={localize('Reset trade history and session TP/SL progress')}
                title={localize('Reset trade history and session TP/SL progress')}
                onClick={onResetSession}
                disabled={!isAuthenticated}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {localize('Reset')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 px-2 text-[11px]"
                onClick={() => setShowAllTrades((showingAll) => !showingAll)}
                aria-expanded={showAllTrades}
              >
                {localize(showAllTrades ? 'Show recent' : 'All trades')}
                {showAllTrades
                  ? <ChevronUp className="h-3.5 w-3.5" />
                  : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 border-y border-border/60 py-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {localize('Total trades')}
              </p>
              <p className="text-sm font-bold tabular-nums text-foreground">
                {formatInteger(metrics.totalTrades, locale)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {localize('Profit trades')}
              </p>
              <p className="text-sm font-bold tabular-nums text-emerald-500">
                {formatInteger(metrics.profitTrades, locale)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {localize('Losses')}
              </p>
              <p className="text-sm font-bold tabular-nums text-destructive">
                {formatInteger(metrics.lossTrades, locale)}
              </p>
            </div>
          </div>

          {visibleTrades.length > 0 ? (
            <ul className={cn(
              'mt-3 divide-y divide-border/70',
              showAllTrades && 'max-h-[520px] overflow-y-auto scroll-smooth'
            )}>
              {visibleTrades.map((trade) => (
                <li
                  key={trade.contractId}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-1"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      trade.profit >= 0
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-destructive/10 text-destructive'
                    )}>
                      {trade.profit >= 0
                        ? <ArrowUpRight className="h-4 w-4" />
                        : <ArrowDownRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {contractTypeLabels[trade.contractType] ?? trade.contractType}
                        {' · '}
                        {getSymbolDisplayName(trade.symbol)}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {trade.status === 'open' ? localize('Open') : localize('Closed')}
                        {' · '}
                        {formatTradeTime(trade.timestamp, locale)}
                        {' · '}
                        {localize('Last digit')} {trade.lastDigit ?? '—'}
                      </p>
                    </div>
                  </div>
                  <p className={cn(
                    'shrink-0 text-xs font-bold tabular-nums',
                    trade.profit > 0
                      ? 'text-emerald-500'
                      : trade.profit < 0
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  )}>
                    {formatSignedAmount(trade.profit, locale)} {trade.currency}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 flex h-44 flex-col items-center justify-center rounded-lg border border-dashed border-border/80 px-4 text-center">
              <Activity className="h-6 w-6 text-muted-foreground/70" />
              <p className="mt-2 text-xs font-medium text-foreground">
                {localize('No trades to show yet.')}
              </p>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-foreground">{localize('Your bots')}</h3>
            <p className="text-[11px] text-muted-foreground">
              {localize('{{count}} saved bots', { count: savedBots.length })}
            </p>
          </div>
        </div>

        {savedBots.length > 0 ? (
          <ul className="mt-3 divide-y divide-border/70">
            {savedBots.slice(0, 4).map((bot) => {
              const isActive = bot.id === activeBotId && autoTradingStatus !== 'idle';
              return (
                <li key={bot.id} className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                      <Bot className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">{bot.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {formatUserTradingStrategyDescription(bot.description)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn(
                      'hidden rounded-full border px-2 py-0.5 text-[10px] font-medium sm:inline',
                      isActive
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                        : 'border-border bg-background/70 text-muted-foreground'
                    )}>
                      {isActive
                        ? localize(autoTradingStatus === 'scanning' ? 'Scanning' : autoTradingStatus === 'stopping' ? 'Stopping' : 'Running')
                        : localize('Ready')}
                    </span>
                    <span className="hidden text-[10px] text-muted-foreground xl:inline">
                      {formatDate(new Date(bot.createdAt), locale)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 px-2 text-[11px]"
                      onClick={() => onPreviewBot(bot)}
                    >
                      <Eye />
                      {localize('Preview')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-3 flex flex-col items-start gap-3 rounded-lg border border-dashed border-border/80 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <Bot className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{localize('No bots saved yet.')}</p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2.5 text-xs"
              onClick={onViewBots}
            >
              <Plus />
              {localize('Create bot')}
            </Button>
          </div>
        )}
      </section>
    </section>
  );
}
