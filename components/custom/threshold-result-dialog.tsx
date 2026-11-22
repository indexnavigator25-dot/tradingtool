'use client';

import { CircleAlert, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import { formatSignedAmount } from '@/lib/locale-format';
import type { AutoTradingThresholdResult } from '@/hooks/use-digits-trading';

interface ThresholdResultDialogProps {
  result: AutoTradingThresholdResult | null;
  onClose: () => void;
}

export function ThresholdResultDialog({ result, onClose }: ThresholdResultDialogProps) {
  const { localize, locale } = useAppTranslations();
  const isTakeProfit = result?.outcome === 'take-profit';
  const OutcomeIcon = isTakeProfit ? Trophy : CircleAlert;
  const ProfitIcon = isTakeProfit ? TrendingUp : TrendingDown;
  const outcomeStyle = isTakeProfit ? 'profit' : 'loss';

  return (
    <Dialog
      open={result !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        overlayClassName={`threshold-result-overlay threshold-result-overlay--${outcomeStyle}`}
        className={`threshold-result-shell threshold-result-shell--${outcomeStyle} w-[calc(100%-2rem)] max-w-md overflow-visible rounded-2xl bg-card p-0 text-foreground sm:rounded-2xl`}
      >
        {result && (
          <div className="relative px-5 pb-5 pt-12 sm:px-7 sm:pb-7">
            <div className="absolute -top-10 left-1/2 -translate-x-1/2">
              <div
                className={`threshold-result-badge threshold-result-badge--${outcomeStyle} flex h-20 w-20 items-center justify-center rounded-full border-4 bg-card shadow-xl ${
                  isTakeProfit
                    ? 'border-emerald-400/80 text-emerald-400'
                    : 'border-rose-400/80 text-rose-400'
                }`}
              >
                <OutcomeIcon className="h-10 w-10" strokeWidth={2.5} />
              </div>
            </div>

            <DialogHeader className="space-y-2 text-center">
              <DialogTitle className="text-xl font-extrabold tracking-tight sm:text-2xl">
                <span className={isTakeProfit ? 'text-emerald-400' : 'text-rose-400'}>
                  {isTakeProfit ? localize('Take Profit') : localize('Stop Loss')}
                </span>{' '}
                {localize('Reached!')}
              </DialogTitle>
            </DialogHeader>

            <p
              className={`mt-2 text-center text-sm font-medium ${
                isTakeProfit ? 'text-emerald-100/80' : 'text-rose-100/80'
              }`}
            >
              {isTakeProfit
                ? localize('Your session reached its take-profit target.')
                : localize('Auto-trading stopped at its stop-loss limit.')}
            </p>

            <div
              aria-hidden="true"
              className={`threshold-outcome-visual threshold-outcome-visual--${outcomeStyle}`}
            >
              <span className="threshold-outcome-orbit threshold-outcome-orbit--outer" />
              <span className="threshold-outcome-orbit threshold-outcome-orbit--inner" />
              <div className="threshold-outcome-bars">
                {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
              </div>
              <div className="threshold-outcome-particles">
                {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
              </div>
              <ProfitIcon className="threshold-outcome-direction" />
              <span className="threshold-outcome-label">
                {localize(isTakeProfit ? 'PROFIT TARGET HIT' : 'LOSS LIMIT HIT')}
              </span>
            </div>

            <div
              className={`grid grid-cols-[auto_1px_minmax(0,1fr)_1px_minmax(0,1fr)] items-center gap-2 rounded-xl border p-3 ${
                isTakeProfit
                  ? 'border-emerald-400/30 bg-emerald-500/5'
                  : 'border-rose-400/30 bg-rose-500/5'
              }`}
            >
              <ProfitIcon
                className={`h-7 w-7 ${isTakeProfit ? 'text-emerald-400' : 'text-rose-400'}`}
              />
              <div className="h-10 w-px bg-border" />
              <div className="min-w-0 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {localize('Session P/L')}
                </p>
                <p
                  className={`truncate text-base font-extrabold tabular-nums sm:text-lg ${
                    isTakeProfit ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatSignedAmount(result.profit, locale)} USD
                </p>
              </div>
              <div className="h-10 w-px bg-border" />
              <div className="min-w-0 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {localize('Market')}
                </p>
                <p className="truncate text-sm font-bold text-foreground" title={result.market}>
                  {result.market}
                </p>
              </div>
            </div>

            <Button
              className={`mt-5 h-11 w-full rounded-xl font-bold text-white shadow-lg transition hover:brightness-110 ${
                isTakeProfit
                  ? 'bg-emerald-600 shadow-emerald-500/25 hover:bg-emerald-500'
                  : 'bg-rose-600 shadow-rose-500/25 hover:bg-rose-500'
              }`}
              onClick={onClose}
            >
              {localize('OK')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
