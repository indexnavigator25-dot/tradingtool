'use client';

import { useState } from 'react';
import { ArrowUpRight, BarChart3, Bot, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import { compileUserTradingStrategy, type StrategyCompilation } from '@/lib/user-trading-strategy';

export interface StrategyTemplate {
  id: string;
  group: 'A' | 'B' | 'C';
  name: string;
  contracts: string[];
  description: string;
}

const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 'group-a',
    group: 'A',
    name: 'Group A',
    contracts: ['Over 0', 'Under 9', 'Differs from 5'],
    description: 'over 0 or under 9 or differs from 5 after 2 consecutive losing digits',
  },
  {
    id: 'group-b',
    group: 'B',
    name: 'Group B',
    contracts: ['Over 1', 'Under 8'],
    description: 'over 1 or under 8 after 2 consecutive losing digits',
  },
  {
    id: 'group-c',
    group: 'C',
    name: 'Group C',
    contracts: ['Even', 'Odd'],
    description: 'even or odd after 2 consecutive losing digits',
  },
];

interface StrategiesLibraryProps {
  onUseTemplate: (template: StrategyTemplate) => void;
  canSave: boolean;
  storageError: string | null;
  onCreateBot: (name: string, prompt: string) => boolean;
}

export function StrategiesLibrary({
  onUseTemplate,
  canSave,
  storageError,
  onCreateBot,
}: StrategiesLibraryProps) {
  const { localize, locale } = useAppTranslations();
  const [query, setQuery] = useState('');
  const [promptFormOpen, setPromptFormOpen] = useState(false);
  const [botName, setBotName] = useState('');
  const [botPrompt, setBotPrompt] = useState('');
  const [compilation, setCompilation] = useState<StrategyCompilation | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  return (
    <section
      id="strategies-library"
      aria-labelledby="strategies-heading"
      className="mx-auto w-full max-w-[1600px] px-3 py-5 pb-24 sm:px-6 sm:py-7"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <BarChart3 className="h-3.5 w-3.5" />
            {localize('Strategy library')}
          </div>
          <h1 id="strategies-heading" className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {localize('Strategies')}
          </h1>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full shrink-0 sm:w-auto"
          aria-expanded={promptFormOpen}
          aria-controls="strategy-prompt-creator"
          onClick={() => setPromptFormOpen((open) => !open)}
        >
          <Bot />
          {localize('Create a bot with a prompt')}
        </Button>
      </header>

      {promptFormOpen && (
        <section
          id="strategy-prompt-creator"
          aria-labelledby="strategy-prompt-heading"
          className="mt-5 space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-4 sm:p-5"
        >
          <div>
            <h2 id="strategy-prompt-heading" className="text-sm font-bold text-foreground">
              {localize('Describe the bot you want')}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="prompt-bot-name" className="text-xs font-medium text-foreground">
                {localize('Bot name (optional)')}
              </label>
              <input
                id="prompt-bot-name"
                value={botName}
                onChange={(event) => {
                  setBotName(event.target.value);
                  setSavedNotice(null);
                  setSaveError(null);
                }}
                placeholder={localize('Leave blank to use the prompt')}
                maxLength={80}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="prompt-bot-description" className="text-xs font-medium text-foreground">
                {localize('Bot prompt')}
              </label>
              <textarea
                id="prompt-bot-description"
                value={botPrompt}
                onChange={(event) => {
                  setBotPrompt(event.target.value);
                  setCompilation(null);
                  setSavedNotice(null);
                  setSaveError(null);
                }}
                placeholder={localize('Example: Trade over 1 after 3 consecutive even digits')}
                rows={3}
                maxLength={500}
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {compilation?.strategy && (
            <div className="space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
              <p className="font-semibold text-foreground">{localize('Prompt ready for review')}</p>
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
            <p role="alert" className="text-xs text-destructive">
              {localize(compilation.error)}
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
              className="flex-1"
              onClick={() => {
                setCompilation(compileUserTradingStrategy(botPrompt));
                setSavedNotice(null);
                setSaveError(null);
              }}
              disabled={!botPrompt.trim()}
            >
              {localize('Review prompt')}
            </Button>
            {compilation?.strategy && (
              <Button
                type="button"
                className="flex-1"
                disabled={!canSave}
                onClick={() => {
                  const trimmedPrompt = botPrompt.trim();
                  const derivedName = trimmedPrompt.length > 80
                    ? `${trimmedPrompt.slice(0, 77).trimEnd()}...`
                    : trimmedPrompt;
                  const saved = onCreateBot(botName.trim() || derivedName, trimmedPrompt);
                  if (!saved) {
                    setSaveError(localize('The bot could not be saved. Check browser storage and try again.'));
                    return;
                  }
                  setBotName('');
                  setBotPrompt('');
                  setCompilation(null);
                  setSavedNotice(localize('Bot saved with this prompt. Find it in the Bots tab.'));
                  setSaveError(null);
                }}
              >
                {localize('Save bot')}
              </Button>
            )}
          </div>
        </section>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {STRATEGY_TEMPLATES.map((group) => (
          <article
            key={group.id}
            className="flex min-w-0 flex-col rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                  <Zap className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-foreground">{localize(group.name)}</h2>
                  <p className="text-xs text-muted-foreground">
                    {localize('{{count}} directions', { count: group.contracts.length })}
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
                {localize('Group {{group}}', { group: group.group })}
              </span>
            </div>

            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {localize('Contract directions')}
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {group.contracts.map((contract) => (
                  <li
                    key={contract}
                    className="rounded-full border border-border/80 bg-background px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {localize(contract)}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 min-h-10 text-xs leading-relaxed text-muted-foreground">
              {localize('The scanner compares these directions across markets and selects the best eligible market and contract.')}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {localize('Entry: after 2 consecutive losing digits')}
            </p>

            <Button
              type="button"
              className="mt-4 w-full"
              onClick={() => onUseTemplate(group)}
            >
              {localize('Select group')}
              <ArrowUpRight />
            </Button>
          </article>
        ))}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground sm:hidden">
        {localize('Templates do not guarantee results. Review risk before trading.')}
      </p>
    </section>
  );
}
