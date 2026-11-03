import { config } from '../config.js';

/**
 * Counts what the model has cost this process and refuses once a ceiling is
 * reached. Interlock shipped without this and a reviewer found that anyone
 * holding the demo URL could spend the whole allowance; here the ceiling exists
 * before the first route does.
 *
 * Deliberately not a rolling window: money, unlike a rate limit, should not
 * refill on its own.
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

export type Usage = { prompt_tokens?: number; completion_tokens?: number };

export const costOf = (model: string, usage: Usage): number => {
  const p = PRICE_PER_MTOK[model] ?? DEAREST;
  return (
    ((usage.prompt_tokens ?? 0) * p.in + (usage.completion_tokens ?? 0) * p.out) / 1_000_000
  );
};

export const record = (model: string, usage: Usage): number => {
  const cost = costOf(model, usage);
  spentUsd += cost;
  calls += 1;
  return cost;
};

export const budgetLeft = (): number => config.ai.spendBudgetUsd - spentUsd;

export const assertBudget = (): void => {
  if (budgetLeft() <= 0) {
    throw Object.assign(
      new Error(
        `the model budget for this deployment is spent ($${config.ai.spendBudgetUsd.toFixed(2)})`,
      ),
      { code: 'ai_budget_spent' as const },
    );
  }
};

export const meterState = () => ({
  spentUsd: Number(spentUsd.toFixed(4)),
  spendBudgetUsd: config.ai.spendBudgetUsd,
  modelCalls: calls,
});

/** Only for tests. */
export const resetMeter = (): void => {
  spentUsd = 0;
  calls = 0;
};
