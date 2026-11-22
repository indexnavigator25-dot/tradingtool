'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bot, Play, Plus, Save, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import { compileUserTradingStrategy } from '@/lib/user-trading-strategy';
import type { SavedBotSettings, StrategyCompilation } from '@/lib/user-trading-strategy';
import { TRADING_DEFAULTS } from '@/lib/trading-defaults';

const SAVED_BOTS_STORAGE_KEY = 'factorpulse:saved-bots:v1';

export interface SavedBot {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  marketSymbol?: string | null;
  stake?: string;
  maximumStake?: string;
  duration?: number;
  recoveryEnabled?: boolean;
  recoveryMultiplier?: string;
  takeProfit?: string;
  stopLoss?: string;
}

export interface BotBuilderTemplate {
  name: string;
  description: string;
}

type AutoTradingStatus = 'idle' | 'scanning' | 'running' | 'stopping';

function isSavedBot(value: unknown): value is SavedBot {
  if (typeof value !== 'object' || value === null) return false;
  if (!('id' in value) || !('name' in value) || !('description' in value) || !('createdAt' in value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 80 &&
    typeof value.description === 'string' &&
    value.description.trim().length > 0 &&
    value.description.length <= 500 &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    (!('marketSymbol' in value) ||
      value.marketSymbol === null ||
      typeof value.marketSymbol === 'string') &&
    (!('stake' in value) ||
      (typeof value.stake === 'string' && Number.isFinite(Number(value.stake)) && Number(value.stake) > 0)) &&
    (!('maximumStake' in value) ||
      (typeof value.maximumStake === 'string' &&
        Number.isFinite(Number(value.maximumStake)) &&
        Number(value.maximumStake) > 0)) &&
    (!('duration' in value) ||
      (typeof value.duration === 'number' && Number.isInteger(value.duration) && value.duration > 0)) &&
    (!('recoveryEnabled' in value) || typeof value.recoveryEnabled === 'boolean') &&
    (!('recoveryMultiplier' in value) ||
      (typeof value.recoveryMultiplier === 'string' &&
        (value.recoveryMultiplier.trim() === '' ||
          (Number.isFinite(Number(value.recoveryMultiplier)) && Number(value.recoveryMultiplier) > 1)))) &&
    (!('takeProfit' in value) ||
      (typeof value.takeProfit === 'string' &&
        (value.takeProfit.trim() === '' ||
          (Number.isFinite(Number(value.takeProfit)) && Number(value.takeProfit) > 0)))) &&
    (!('stopLoss' in value) ||
      (typeof value.stopLoss === 'string' &&
        (value.stopLoss.trim() === '' ||
          (Number.isFinite(Number(value.stopLoss)) && Number(value.stopLoss) > 0))))
  );
}

function getStorageError(error: unknown): string {
  return error instanceof Error ? error.message : 'Browser storage could not be accessed.';
}

export function useSavedBots() {
  const [bots, setBots] = useState<SavedBot[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [canPersist, setCanPersist] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SAVED_BOTS_STORAGE_KEY);
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed) || !parsed.every(isSavedBot)) {
          throw new Error('Saved bot data is invalid and could not be loaded.');
        }
        setBots(parsed);
      }
      setCanPersist(true);
    } catch (error) {
      setStorageError(getStorageError(error));
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const saveBot = useCallback((
    name: string,
    description: string,
    settings?: SavedBotSettings
  ): boolean => {
    if (!isLoaded || !canPersist) return false;
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || !trimmedDescription) return false;

    const bot: SavedBot = {
      id: typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: trimmedName,
      description: trimmedDescription,
      createdAt: Date.now(),
      ...settings,
    };
    const nextBots = [bot, ...bots];
    try {
      window.localStorage.setItem(SAVED_BOTS_STORAGE_KEY, JSON.stringify(nextBots));
      setBots(nextBots);
      setStorageError(null);
      return true;
    } catch (error) {
      setStorageError(getStorageError(error));
      setCanPersist(false);
      return false;
    }
  }, [bots, canPersist, isLoaded]);

  const deleteBot = useCallback((id: string): boolean => {
    if (!isLoaded || !canPersist) return false;
    const nextBots = bots.filter((bot) => bot.id !== id);
    try {
      window.localStorage.setItem(SAVED_BOTS_STORAGE_KEY, JSON.stringify(nextBots));
      setBots(nextBots);
      setStorageError(null);
      return true;
    } catch (error) {
      setStorageError(getStorageError(error));
      setCanPersist(false);
      return false;
    }
  }, [bots, canPersist, isLoaded]);

  return { bots, isLoaded, canPersist, storageError, saveBot, deleteBot };
}

interface BotBuilderProps {
  canSave: boolean;
  disabled?: boolean;
  storageError: string | null;
  template: BotBuilderTemplate | null;
  onTemplateApplied: () => void;
  onSave: (name: string, description: string, settings?: SavedBotSettings) => boolean;
}

export function BotBuilder({
  canSave,
  disabled = false,
  storageError,
  template,
  onTemplateApplied,
  onSave,
}: BotBuilderProps) {
  const { localize } = useAppTranslations();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [compilation, setCompilation] = useState<StrategyCompilation | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setDescription(template.description);
    setCompilation(
      template.description ? compileUserTradingStrategy(template.description) : null
    );
    setSavedNotice(null);
    setSaveError(null);
    onTemplateApplied();
  }, [template, onTemplateApplied]);

  const reviewStrategy = () => {
    setCompilation(compileUserTradingStrategy(description));
    setSavedNotice(null);
    setSaveError(null);
  };

  const saveStrategy = () => {
    if (!compilation?.strategy) return;
    const saved = onSave(name, compilation.strategy.description);
    if (!saved) {
      setSaveError(localize('The bot could not be saved. Check browser storage and try again.'));
      return;
    }
    setName('');
    setDescription('');
    setCompilation(null);
    setSavedNotice(localize('Bot saved. You can run it from the Bots tab.'));
    setSaveError(null);
  };

  return (
    <section className="space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-bold text-foreground">{localize('Create a bot')}</h3>
          <p className="text-xs text-muted-foreground">
            {localize('Markets and contracts are selected from your rules.')}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="saved-bot-name" className="text-xs font-medium text-foreground">
          {localize('Bot name')}
        </label>
        <input
          id="saved-bot-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setSavedNotice(null);
            setSaveError(null);
          }}
          placeholder={localize('Example: Even digit setup')}
          maxLength={80}
          disabled={disabled}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="saved-bot-description" className="text-xs font-medium text-foreground">
          {localize('Strategy description')}
        </label>
        <textarea
          id="saved-bot-description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setCompilation(null);
            setSavedNotice(null);
            setSaveError(null);
          }}
          placeholder={localize('Example: Trade over 1 after 3 consecutive even digits')}
          rows={3}
          maxLength={500}
          disabled={disabled}
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {compilation?.strategy && (
        <div className="space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
          <p className="font-semibold text-foreground">{localize('Strategy ready for review')}</p>
          <p className="text-muted-foreground">
            {localize('Contract: {{contract}}', {
              contract: compilation.strategy.contractDescription,
            })}
          </p>
          <p className="text-muted-foreground">
            {localize('Entry: {{condition}}', {
              condition: compilation.strategy.triggers.map((trigger) => trigger.description).join(' or '),
            })}
          </p>
        </div>
      )}
      {compilation?.error && (
        <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{localize(compilation.error)}</span>
        </p>
      )}
      {storageError && (
        <p role="alert" className="text-xs text-destructive">
          {localize('Saved bots could not be stored: {{error}}', { error: storageError })}
        </p>
      )}
      {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
      {savedNotice && <p role="status" className="text-xs text-emerald-500">{savedNotice}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={reviewStrategy}
          disabled={disabled || !description.trim()}
        >
          {localize('Review strategy')}
        </Button>
        {compilation?.strategy && (
          <Button
            type="button"
            size="sm"
            className="flex-1"
            onClick={saveStrategy}
            disabled={disabled || !canSave || !name.trim()}
          >
            <Save />
            {localize('Save bot')}
          </Button>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {localize('Historical patterns do not guarantee results. Trading can lose money.')}
      </p>
    </section>
  );
}

interface SavedBotsPanelProps {
  bots: SavedBot[];
  isLoaded: boolean;
  canPersist: boolean;
  storageError: string | null;
  isAuthenticated: boolean;
  isConnected: boolean;
  status: AutoTradingStatus;
  activeBotId: string | null;
  disabled?: boolean;
  onCreateBot: () => void;
  onDeleteBot: (id: string) => boolean;
  onRunBot: (bot: SavedBot) => Promise<void>;
  onStopBot: () => void;
}

export function SavedBotsPanel({
  bots,
  isLoaded,
  canPersist,
  storageError,
  isAuthenticated,
  isConnected,
  status,
  activeBotId,
  disabled = false,
  onCreateBot,
  onDeleteBot,
  onRunBot,
  onStopBot,
}: SavedBotsPanelProps) {
  const { localize, locale } = useAppTranslations();

  return (
    <section className="space-y-4 rounded-xl border border-border/80 bg-background/70 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">{localize('Saved bots')}</h3>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onCreateBot} disabled={disabled}>
          <Plus />
          {localize('Create bot')}
        </Button>
      </div>

      {storageError && (
        <p role="alert" className="text-xs text-destructive">
          {localize('Saved bots could not be stored: {{error}}', { error: storageError })}
        </p>
      )}
      {!isAuthenticated && (
        <p className="text-xs text-muted-foreground">
          {localize('Test mode scans markets only and never places trades. Log in to run a trading bot.')}
        </p>
      )}
      {!isConnected && (
        <p className="text-xs text-muted-foreground">
          {localize('Connect to the market before running a bot.')}
        </p>
      )}
      {status !== 'idle' && !activeBotId && (
        <p role="status" className="text-xs text-muted-foreground">
          {localize('A bot session is already active. Stop it before running another.')}
        </p>
      )}

      {!isLoaded ? (
        <p role="status" className="text-sm text-muted-foreground">
          {localize('Loading saved bots...')}
        </p>
      ) : bots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{localize('No bots saved yet.')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {bots.map((bot) => {
            const active = activeBotId === bot.id && status !== 'idle';
            const canStart = isLoaded && canPersist && isConnected &&
              status === 'idle' && !disabled;
            return (
              <li
                key={bot.id}
                className="flex flex-col gap-3 rounded-lg border border-border/80 bg-card/70 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{bot.name}</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{bot.description}</p>
                  {(bot.stake || bot.maximumStake || bot.duration || bot.takeProfit || bot.stopLoss) && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {localize('Markets: all open continuous indices · Stake: {{stake}} USD · Max: {{maximumStake}} USD · Duration: {{duration}} ticks', {
                        stake: bot.stake ?? TRADING_DEFAULTS.stake,
                        maximumStake: bot.maximumStake ?? localize('No limit'),
                        duration: bot.duration ?? 2,
                      })}
                      {bot.takeProfit && ` · ${localize('TP: {{value}} USD', { value: bot.takeProfit })}`}
                      {bot.stopLoss && ` · ${localize('SL: {{value}} USD', { value: bot.stopLoss })}`}
                      {bot.recoveryEnabled !== false && ` · ${localize('Recovery: {{value}}×', {
                        value: bot.recoveryMultiplier ?? TRADING_DEFAULTS.recoveryMultiplier,
                      })}`}
                      {bot.recoveryEnabled === false && ` · ${localize('Recovery off')}`}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {localize('Saved {{date}}', {
                      date: new Intl.DateTimeFormat(locale, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(bot.createdAt),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={active ? 'destructive' : 'default'}
                    disabled={disabled || (active ? status === 'stopping' : !canStart)}
                    onClick={() => {
                      if (active) {
                        onStopBot();
                      } else {
                        void onRunBot(bot);
                      }
                    }}
                  >
                    {active ? <Square /> : <Play />}
                    {active
                      ? localize(
                          status === 'stopping'
                            ? 'Stopping...'
                            : isAuthenticated
                              ? 'Stop bot'
                              : 'Stop scan'
                        )
                      : localize(isAuthenticated ? 'Run bot' : 'Test scan')}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={localize('Delete {{name}}', { name: bot.name })}
                    title={localize('Delete {{name}}', { name: bot.name })}
                    disabled={disabled || !canPersist || active}
                    onClick={() => onDeleteBot(bot.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
