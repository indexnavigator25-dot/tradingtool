'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, Play, Plus, RotateCcw, Settings2, Sparkles, Trash2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import { compileUserTradingStrategy } from '@/lib/user-trading-strategy';
import { TRADING_DEFAULTS } from '@/lib/trading-defaults';
import type {
  SavedBotSettings,
  StrategyContractOption,
  UserTradingStrategy,
} from '@/lib/user-trading-strategy';
import type { ContractMode } from '@/lib/types';
import type { BotBuilderTemplate, SavedBot } from './strategy-builder';

type ConditionKind = 'digit' | 'parity-run' | 'range-run' | 'sequence' | 'loss-run';
type AnalysisType = 'pattern' | 'sequence';

interface RuleCondition {
  id: number;
  kind: ConditionKind;
  digit: string;
  length: string;
  parity: 'even' | 'odd';
  range: 'high' | 'low';
  sequence: string;
}

interface QuickBotBuilderProps {
  stake: string;
  onStakeChange: (value: string) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  takeProfit: string;
  onTakeProfitChange: (value: string) => void;
  stopLoss: string;
  onStopLossChange: (value: string) => void;
  martingaleMode: string;
  martingaleMultiplier: string;
  onMartingaleMultiplierChange: (value: string) => void;
  canSave: boolean;
  storageError: string | null;
  disabled?: boolean;
  template: BotBuilderTemplate | null;
  onTemplateApplied: () => void;
  onSave: (name: string, description: string, settings: SavedBotSettings) => boolean;
  previewBot: SavedBot | null;
  canRunPreview: boolean;
  onCancelPreview: () => void;
  onRunPreview: (
    bot: SavedBot,
    description: string,
    settings: SavedBotSettings
  ) => Promise<void>;
}

function createCondition(id: number, kind: ConditionKind = 'parity-run'): RuleCondition {
  return {
    id,
    kind,
    digit: '3',
    length: '2',
    parity: 'even',
    range: 'high',
    sequence: '1, 2, 3',
  };
}

function conditionDescription(condition: RuleCondition): string {
  switch (condition.kind) {
    case 'digit':
      return `when the last digit is ${condition.digit}`;
    case 'parity-run':
      return `after ${condition.length} consecutive ${condition.parity} digits`;
    case 'range-run':
      return `after ${condition.length} consecutive ${condition.range} digits`;
    case 'sequence':
      return `after the sequence ${condition.sequence.trim()}`;
    case 'loss-run':
      return `after ${condition.length} consecutive losing digits`;
  }
}

function contractDescription(
  contractMode: Exclude<ContractMode, 'DIGITMATCH'>,
  barrier: string
): string {
  switch (contractMode) {
    case 'DIGITDIFF':
      return `differs from ${barrier}`;
    case 'DIGITOVER':
      return `over ${barrier}`;
    case 'DIGITUNDER':
      return `under ${barrier}`;
    case 'DIGITEVEN':
      return 'even';
    case 'DIGITODD':
      return 'odd';
  }
}

const CONTRACT_DIRECTION_LABELS: Record<StrategyContractOption['contractMode'], string> = {
  DIGITDIFF: 'Differs',
  DIGITOVER: 'Over',
  DIGITUNDER: 'Under',
  DIGITEVEN: 'Even',
  DIGITODD: 'Odd',
};

function normalizeBarrier(contractMode: Exclude<ContractMode, 'DIGITMATCH'>, value: number): number {
  const minimum = contractMode === 'DIGITUNDER' ? 1 : 0;
  const maximum = contractMode === 'DIGITOVER' ? 8 : 9;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function getRuleConditions(strategy: UserTradingStrategy): RuleCondition[] {
  return strategy.triggers.map((trigger, index): RuleCondition => {
    const condition = createCondition(index + 1);
    switch (trigger.kind) {
      case 'digit':
        return { ...condition, kind: 'digit', digit: String(trigger.digit) };
      case 'parity-run':
        return {
          ...condition,
          kind: 'parity-run',
          parity: trigger.parity,
          length: String(trigger.length),
        };
      case 'range-run':
        return {
          ...condition,
          kind: 'range-run',
          range: trigger.range,
          length: String(trigger.length),
        };
      case 'sequence':
        return {
          ...condition,
          kind: 'sequence',
          sequence: trigger.digits.join(', '),
        };
      case 'loss-run':
        return {
          ...condition,
          kind: 'loss-run',
          length: String(trigger.length),
        };
    }
  });
}

export function QuickBotBuilder({
  stake,
  onStakeChange,
  duration,
  onDurationChange,
  takeProfit,
  onTakeProfitChange,
  stopLoss,
  onStopLossChange,
  martingaleMode,
  martingaleMultiplier,
  onMartingaleMultiplierChange,
  canSave,
  storageError,
  disabled = false,
  template,
  onTemplateApplied,
  onSave,
  previewBot,
  canRunPreview,
  onCancelPreview,
  onRunPreview,
}: QuickBotBuilderProps) {
  const { localize } = useAppTranslations();
  const [name, setName] = useState('');
  const [analysisType, setAnalysisType] = useState<AnalysisType>('pattern');
  const [conditions, setConditions] = useState<RuleCondition[]>([createCondition(1)]);
  const [nextConditionId, setNextConditionId] = useState(2);
  const [contractMode, setContractMode] =
    useState<Exclude<ContractMode, 'DIGITMATCH'>>('DIGITOVER');
  const [barrier, setBarrier] = useState('1');
  const [contractOptions, setContractOptions] = useState<StrategyContractOption[] | null>(null);
  const [durationDraft, setDurationDraft] = useState(String(duration));
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setDurationDraft(String(duration));
  }, [duration]);

  useEffect(() => {
    if (!template) return;

    const result = compileUserTradingStrategy(template.description);
    setName(template.name);
    setSaveError(null);
    setSavedNotice(null);
    if (!result.strategy) {
      setSaveError(localize(result.error));
      onTemplateApplied();
      return;
    }

    const nextConditions = getRuleConditions(result.strategy);

    setAnalysisType(nextConditions.every((condition) => condition.kind === 'sequence')
      ? 'sequence'
      : 'pattern');
    setConditions(nextConditions);
    setNextConditionId(nextConditions.length + 1);
    setContractMode(result.strategy.contractMode);
    setBarrier(String(result.strategy.barrier ?? 1));
    setContractOptions(
      result.strategy.contractOptions.length > 1 ? result.strategy.contractOptions : null
    );
    setSavedNotice(localize('Strategy loaded from Strategies. Edit its conditions, then save the bot.'));
    onTemplateApplied();
  }, [localize, onTemplateApplied, previewBot, template]);

  useEffect(() => {
    if (!previewBot) {
      setPreviewLoaded(false);
      return;
    }

    setPreviewLoaded(false);
    const result = compileUserTradingStrategy(previewBot.description);
    setName(previewBot.name);
    setSaveError(null);
    setSavedNotice(null);
    if (!result.strategy) {
      setSaveError(localize(result.error));
      return;
    }

    const nextConditions = getRuleConditions(result.strategy);
    setAnalysisType(nextConditions.every((condition) => condition.kind === 'sequence')
      ? 'sequence'
      : 'pattern');
    setConditions(nextConditions);
    setNextConditionId(nextConditions.length + 1);
    setContractMode(result.strategy.contractMode);
    setBarrier(String(result.strategy.barrier ?? 1));
    setContractOptions(
      result.strategy.contractOptions.length > 1 ? result.strategy.contractOptions : null
    );
    setRecoveryEnabled(previewBot.recoveryEnabled ?? false);
    onStakeChange(previewBot.stake ?? TRADING_DEFAULTS.stake);
    onDurationChange(previewBot.duration ?? TRADING_DEFAULTS.duration);
    onTakeProfitChange(previewBot.takeProfit ?? TRADING_DEFAULTS.takeProfit);
    onStopLossChange(previewBot.stopLoss ?? TRADING_DEFAULTS.stopLoss);
    onMartingaleMultiplierChange(
      previewBot.recoveryMultiplier ?? TRADING_DEFAULTS.recoveryMultiplier
    );
    setPreviewLoaded(true);
    setSavedNotice(localize('Bot loaded. Adjust its inputs, then run it.'));
  }, [
    localize,
    onDurationChange,
    onMartingaleMultiplierChange,
    onStakeChange,
    onStopLossChange,
    onTakeProfitChange,
    previewBot,
  ]);

  const description = useMemo(() => {
    const contract = contractOptions
      ? contractOptions
          .map((option) => contractDescription(
            option.contractMode,
            String(option.barrier ?? 1)
          ))
          .join(' or ')
      : contractDescription(contractMode, barrier);
    const entries = conditions.map(conditionDescription);
    return `${contract} ${entries.join(' or ')}`;
  }, [barrier, conditions, contractMode, contractOptions]);
  const compilation = useMemo(
    () => compileUserTradingStrategy(description),
    [description]
  );
  const parsedDuration = Number(durationDraft);
  const isDurationDraftValid = Number.isInteger(parsedDuration) &&
    parsedDuration >= 1 &&
    parsedDuration <= 200;
  const parsedRecoveryMultiplier = Number(martingaleMultiplier);
  const isRecoveryMultiplierValid = Number.isFinite(parsedRecoveryMultiplier) &&
    parsedRecoveryMultiplier > 1;

  const updateCondition = (id: number, update: Partial<RuleCondition>) => {
    setConditions((current) => current.map((condition) =>
      condition.id === id ? { ...condition, ...update } : condition
    ));
    setSaveError(null);
    setSavedNotice(null);
  };

  const resetDraft = () => {
    setName('');
    setAnalysisType('pattern');
    setConditions([createCondition(1)]);
    setNextConditionId(2);
    setContractMode('DIGITOVER');
    setBarrier('1');
    setContractOptions(null);
    setRecoveryEnabled(false);
    setDurationDraft(String(TRADING_DEFAULTS.duration));
    onStakeChange(TRADING_DEFAULTS.stake);
    onDurationChange(TRADING_DEFAULTS.duration);
    onTakeProfitChange(TRADING_DEFAULTS.takeProfit);
    onStopLossChange(TRADING_DEFAULTS.stopLoss);
    onMartingaleMultiplierChange(TRADING_DEFAULTS.recoveryMultiplier);
    setSaveError(null);
    setSavedNotice(null);
  };

  const getValidatedSettings = (): SavedBotSettings | null => {
    if (!compilation.strategy) {
      setSaveError(localize(compilation.error));
      setSavedNotice(null);
      return null;
    }
    if (!isDurationDraftValid) {
      setSaveError(localize('Duration must be between 1 and 200 ticks.'));
      setSavedNotice(null);
      return null;
    }
    if (recoveryEnabled && !isRecoveryMultiplierValid) {
      setSaveError(localize('Recovery multiplier must be greater than 1.'));
      setSavedNotice(null);
      return null;
    }
    const initialStake = Number(stake);
    if (!Number.isFinite(initialStake) || initialStake <= 0) {
      setSaveError(localize('Stake must be greater than zero.'));
      setSavedNotice(null);
      return null;
    }
    if (!takeProfit.trim() && !stopLoss.trim()) {
      setSaveError(localize('Set a take-profit or stop-loss target before creating the bot.'));
      setSavedNotice(null);
      return null;
    }
    const riskTargets: Array<[string, string]> = [
      [localize('Take profit'), takeProfit],
      [localize('Stop loss'), stopLoss],
    ];
    for (const [label, value] of riskTargets) {
      if (value.trim() === '') continue;
      const target = Number(value);
      if (!Number.isFinite(target) || target <= 0) {
        setSaveError(localize('{{label}} must be greater than zero.', { label }));
        setSavedNotice(null);
        return null;
      }
    }

    setSaveError(null);
    setSavedNotice(null);
    return {
      stake,
      duration: parsedDuration,
      recoveryEnabled,
      recoveryMultiplier: martingaleMultiplier,
      takeProfit,
      stopLoss,
    };
  };

  const saveQuickBot = () => {
    const settings = getValidatedSettings();
    if (!settings) return;
    const saved = onSave(name, description, settings);
    if (!saved) {
      setSaveError(localize('The bot could not be saved. Check browser storage and try again.'));
      setSavedNotice(null);
      return;
    }
    setName('');
    setSaveError(null);
    setSavedNotice(localize('Quick bot saved. Run it from your saved bots below.'));
  };

  const runPreviewBot = () => {
    if (!previewBot || !previewLoaded || !canRunPreview) return;
    const settings = getValidatedSettings();
    if (!settings) return;
    void onRunPreview(previewBot, description, settings);
  };

  return (
    <section
      id="quick-bot-builder"
      className="space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-4 sm:p-5"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-bold text-foreground">
              {previewBot
                ? localize('Preview saved bot: {{name}}', { name: previewBot.name })
                : localize('Build your trading rules')}
            </h3>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (previewBot) {
              resetDraft();
              onCancelPreview();
            } else {
              resetDraft();
            }
          }}
          disabled={disabled}
        >
          {previewBot ? <X /> : <RotateCcw />}
          {localize(previewBot ? 'Cancel preview' : 'Reset')}
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(250px,0.8fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 rounded-lg border border-border/80 bg-card/70 p-3 sm:grid-cols-2 sm:p-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="quick-bot-analysis">{localize('Analysis type')}</Label>
              <select
                id="quick-bot-analysis"
                value={analysisType}
                onChange={(event) => {
                  const nextType = event.target.value as AnalysisType;
                  setAnalysisType(nextType);
                  setConditions((current) => current.map((condition) =>
                    createCondition(
                      condition.id,
                      nextType === 'sequence' ? 'sequence' : 'parity-run'
                    )
                  ));
                  setSaveError(null);
                  setSavedNotice(null);
                }}
                disabled={disabled}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="pattern">{localize('Pattern')}</option>
                <option value="sequence">{localize('Digit sequence')}</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-border/80 bg-card/70 p-3 sm:grid-cols-2 sm:p-4">
            <div className="space-y-1.5">
              <Label htmlFor="quick-bot-stake">{localize('Initial purchase · Stake')}</Label>
              <Input
                id="quick-bot-stake"
                type="number"
                min="0.35"
                step="0.01"
                value={stake}
                onChange={(event) => {
                  onStakeChange(event.target.value);
                  setSaveError(null);
                  setSavedNotice(null);
                }}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-bot-duration">{localize('Duration (ticks)')}</Label>
              <Input
                id="quick-bot-duration"
                type="number"
                min="1"
                max="200"
                step="1"
                value={durationDraft}
                onChange={(event) => {
                  const value = event.target.value;
                  setDurationDraft(value);
                  const parsed = Number(value);
                  if (value !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 200) {
                    onDurationChange(parsed);
                  }
                  setSaveError(null);
                  setSavedNotice(null);
                }}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                {localize('Entry conditions')}
              </h4>
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-primary">
                <Sparkles className="h-3 w-3" />
                {localize('AUTO PICK')}
              </span>
            </div>

            {conditions.map((condition, index) => (
              <article key={condition.id} className="space-y-3 rounded-lg border border-border/80 bg-card/70 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-xs font-semibold text-foreground">
                    {localize('Condition {{number}}', { number: index + 1 })}
                  </h5>
                  {conditions.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={localize('Remove condition {{number}}', { number: index + 1 })}
                      onClick={() => setConditions((current) => current.filter((entry) => entry.id !== condition.id))}
                      disabled={disabled}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>

                {analysisType === 'pattern' && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`quick-condition-kind-${condition.id}`}>{localize('Pattern')}</Label>
                    <select
                      id={`quick-condition-kind-${condition.id}`}
                      value={condition.kind}
                      onChange={(event) => updateCondition(condition.id, { kind: event.target.value as ConditionKind })}
                      disabled={disabled}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      <option value="digit">{localize('Last digit')}</option>
                      <option value="parity-run">{localize('Even / odd run')}</option>
                      <option value="range-run">{localize('High / low run')}</option>
                      <option value="sequence">{localize('Digit sequence')}</option>
                      <option value="loss-run">{localize('Contract-loss run')}</option>
                    </select>
                  </div>
                )}

                {condition.kind === 'digit' && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`quick-condition-digit-${condition.id}`}>{localize('Last digit is')}</Label>
                    <Input
                      id={`quick-condition-digit-${condition.id}`}
                      type="number"
                      min="0"
                      max="9"
                      step="1"
                      value={condition.digit}
                      onChange={(event) => updateCondition(condition.id, { digit: event.target.value })}
                      disabled={disabled}
                    />
                  </div>
                )}

                {(condition.kind === 'parity-run' || condition.kind === 'range-run') && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`quick-condition-value-${condition.id}`}>
                        {localize(condition.kind === 'parity-run' ? 'Parity' : 'Digit range')}
                      </Label>
                      <select
                        id={`quick-condition-value-${condition.id}`}
                        value={condition.kind === 'parity-run' ? condition.parity : condition.range}
                        onChange={(event) => updateCondition(
                          condition.id,
                          condition.kind === 'parity-run'
                            ? { parity: event.target.value as RuleCondition['parity'] }
                            : { range: event.target.value as RuleCondition['range'] }
                        )}
                        disabled={disabled}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      >
                        {condition.kind === 'parity-run' ? (
                          <>
                            <option value="even">{localize('Even')}</option>
                            <option value="odd">{localize('Odd')}</option>
                          </>
                        ) : (
                          <>
                            <option value="high">{localize('High (5-9)')}</option>
                            <option value="low">{localize('Low (0-4)')}</option>
                          </>
                        )}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`quick-condition-length-${condition.id}`}>{localize('Consecutive digits')}</Label>
                      <Input
                        id={`quick-condition-length-${condition.id}`}
                        type="number"
                        min="1"
                        max="8"
                        step="1"
                        value={condition.length}
                        onChange={(event) => updateCondition(condition.id, { length: event.target.value })}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                )}

                {condition.kind === 'loss-run' && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`quick-condition-loss-length-${condition.id}`}>
                      {localize('Consecutive losing digits')}
                    </Label>
                    <Input
                      id={`quick-condition-loss-length-${condition.id}`}
                      type="number"
                      min="1"
                      max="8"
                      step="1"
                      value={condition.length}
                      onChange={(event) => updateCondition(condition.id, { length: event.target.value })}
                      disabled={disabled}
                    />
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {localize(contractOptions
                        ? 'Losses are evaluated separately for each direction in this group.'
                        : 'Losses use this bot’s contract and barrier.')}
                    </p>
                  </div>
                )}

                {condition.kind === 'sequence' && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`quick-condition-sequence-${condition.id}`}>{localize('Digit sequence')}</Label>
                    <Input
                      id={`quick-condition-sequence-${condition.id}`}
                      value={condition.sequence}
                      onChange={(event) => updateCondition(condition.id, { sequence: event.target.value })}
                      placeholder={localize('Example: 1, 2, 3')}
                      disabled={disabled}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {localize('Enter two to five digits separated by commas.')}
                    </p>
                  </div>
                )}
              </article>
            ))}

            {conditions.length < 5 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-dashed"
                onClick={() => {
                  setConditions((current) => [
                    ...current,
                    createCondition(nextConditionId, analysisType === 'sequence' ? 'sequence' : 'parity-run'),
                  ]);
                  setNextConditionId((current) => current + 1);
                  setSaveError(null);
                }}
                disabled={disabled}
              >
                <Plus />
                {localize('Add condition')}
              </Button>
            )}

            <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-3 sm:p-4">
              <h5 className="text-xs font-semibold text-foreground">{localize('Then trade')}</h5>
              {contractOptions ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from(new Set(contractOptions.map(
                    (option) => CONTRACT_DIRECTION_LABELS[option.contractMode]
                  ))).map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-border/80 bg-background px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {localize(label)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="quick-bot-contract">{localize('Contract')}</Label>
                    <select
                      id="quick-bot-contract"
                      value={contractMode}
                      onChange={(event) => {
                        const nextMode = event.target.value as Exclude<ContractMode, 'DIGITMATCH'>;
                        setContractMode(nextMode);
                        setContractOptions(null);
                        setBarrier((current) => {
                          const parsed = Number(current);
                          return current.trim() === '' || !Number.isFinite(parsed)
                            ? current
                            : String(normalizeBarrier(nextMode, parsed));
                        });
                        setSaveError(null);
                        setSavedNotice(null);
                      }}
                      disabled={disabled}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      <option value="DIGITDIFF">{localize('Differs')}</option>
                      <option value="DIGITOVER">{localize('Over')}</option>
                      <option value="DIGITUNDER">{localize('Under')}</option>
                      <option value="DIGITEVEN">{localize('Even')}</option>
                      <option value="DIGITODD">{localize('Odd')}</option>
                    </select>
                  </div>
                  {(contractMode === 'DIGITDIFF' || contractMode === 'DIGITOVER' || contractMode === 'DIGITUNDER') && (
                    <div className="space-y-1.5">
                      <Label htmlFor="quick-bot-barrier">{localize('Digit barrier')}</Label>
                      <Input
                        id="quick-bot-barrier"
                        type="number"
                        min={contractMode === 'DIGITUNDER' ? 1 : 0}
                        max={contractMode === 'DIGITOVER' ? 8 : 9}
                        step="1"
                        value={barrier}
                        onChange={(event) => {
                          setBarrier(event.target.value);
                          setContractOptions(null);
                          setSaveError(null);
                          setSavedNotice(null);
                        }}
                        disabled={disabled}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <section className="space-y-3 rounded-lg border border-border/80 bg-card/70 p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                {localize('Risk management')}
              </h4>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="quick-bot-take-profit">{localize('Take profit')}</Label>
                <Input
                  id="quick-bot-take-profit"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={takeProfit}
                  onChange={(event) => {
                    onTakeProfitChange(event.target.value);
                    setSaveError(null);
                    setSavedNotice(null);
                  }}
                  labelRight="USD"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quick-bot-stop-loss">{localize('Stop loss')}</Label>
                <Input
                  id="quick-bot-stop-loss"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={stopLoss}
                  onChange={(event) => {
                    onStopLossChange(event.target.value);
                    setSaveError(null);
                    setSavedNotice(null);
                  }}
                  labelRight="USD"
                  disabled={disabled}
                />
              </div>
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{localize('Martingale level')}</dt>
                <dd className="font-medium capitalize text-foreground">{martingaleMode}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3 rounded-lg border border-border/80 bg-card/70 p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                {localize('Recovery options')}
              </h4>
            </div>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={recoveryEnabled}
                onChange={(event) => setRecoveryEnabled(event.target.checked)}
                disabled={disabled}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="font-medium">{localize('Enable recovery')}</span>
              </span>
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="quick-bot-recovery-multiplier">{localize('Recovery multiplier')}</Label>
              <Input
                id="quick-bot-recovery-multiplier"
                type="number"
                min="1"
                step="0.01"
                value={martingaleMultiplier}
                onChange={(event) => {
                  onMartingaleMultiplierChange(event.target.value);
                  setSaveError(null);
                  setSavedNotice(null);
                }}
                disabled={disabled || !recoveryEnabled}
              />
            </div>
          </section>

          <section className="space-y-2 rounded-lg border border-border/80 bg-card/70 p-3 sm:p-4">
            <Label htmlFor="quick-bot-name">{localize('Bot name')}</Label>
            <Input
              id="quick-bot-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaveError(null);
                setSavedNotice(null);
              }}
              maxLength={80}
              placeholder={localize('Example: Even digit setup')}
              disabled={disabled}
            />
          </section>
        </aside>
      </div>

      <div className="space-y-2 border-t border-border/70 pt-3">
        {compilation.strategy ? (
          <p className="text-xs text-muted-foreground">
            {localize('Rule preview: {{contract}} · Auto-picks the best-fit condition for every group', {
              contract: compilation.strategy.contractDescription,
            })}
          </p>
        ) : (
          <p role="alert" className="text-xs text-destructive">{localize(compilation.error)}</p>
        )}
        {storageError && (
          <p role="alert" className="text-xs text-destructive">
            {localize('Saved bots could not be stored: {{error}}', { error: storageError })}
          </p>
        )}
        {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
        {savedNotice && <p role="status" className="text-xs text-emerald-500">{savedNotice}</p>}
        {previewBot ? (
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={runPreviewBot}
            disabled={disabled || !canRunPreview || !previewLoaded || !compilation.strategy ||
              !isDurationDraftValid || (recoveryEnabled && !isRecoveryMultiplierValid)}
          >
            <Play />
            {localize('Run with changes')}
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={saveQuickBot}
            disabled={disabled || !canSave || !name.trim() || !compilation.strategy ||
              !isDurationDraftValid || (recoveryEnabled && !isRecoveryMultiplierValid)}
          >
            <Plus />
            {localize('Create Quick Bot')}
          </Button>
        )}
      </div>
    </section>
  );
}
