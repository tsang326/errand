import { config } from '../config.js';

/**
 * Counts what the model has cost and refuses once the day's ceiling is reached,
 * so anyone holding the public URL can spend at most one day's allowance.
 *
 * Per UTC day, not per process. A per-process count reset on every restart, and
 * a free instance that sleeps after 15 idle minutes restarts often; a process
 * that never sleeps would have made the same figure a ceiling for the whole
 * month instead. A calendar day is neither.
 */
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  // USD per million tokens, gpt-4.1 list price at the time of writing. A model
  // that is not listed is metered at the most expensive known rate rather than
  // at zero, so an unknown model cannot spend silently.
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
};

const DEAREST = { in: 2.0, out: 8.0 };

let spentUsd = 0;
let calls = 0;
let day = '';

const today = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** Starts a fresh count when the UTC date has moved on since the last call. */
const roll = (now = Date.now()): void => {
  const d = today(now);
  if (d !== day) {
    day = d;
    spentUsd = 0;
    calls = 0;
  }
};

export type Usage = { prompt_tokens?: number; completion_tokens?: number };

export const costOf = (model: string, usage: Usage): number => {
  const p = PRICE_PER_MTOK[model] ?? DEAREST;
  return (
    ((usage.prompt_tokens ?? 0) * p.in + (usage.completion_tokens ?? 0) * p.out) / 1_000_000
  );
};

export const record = (model: string, usage: Usage, now = Date.now()): number => {
  roll(now);
  const cost = costOf(model, usage);
  spentUsd += cost;
  calls += 1;
  return cost;
};

export const budgetLeft = (now = Date.now()): number => {
  roll(now);
  return config.ai.spendBudgetUsd - spentUsd;
};

export const assertBudget = (now = Date.now()): void => {
  if (budgetLeft(now) <= 0) {
    throw Object.assign(
      new Error(
        `today's model budget for this demo is spent ($${config.ai.spendBudgetUsd.toFixed(2)}); it resets at 00:00 UTC`,
      ),
      { code: 'ai_budget_spent' as const },
    );
  }
};

export const meterState = () => (roll(), {
  day,
  spentUsd: Number(spentUsd.toFixed(4)),
  spendBudgetUsd: config.ai.spendBudgetUsd,
  modelCalls: calls,
});

/** Only for tests. */
export const resetMeter = (): void => {
  spentUsd = 0;
  calls = 0;
  day = '';
};
