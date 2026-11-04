import type { Errand } from './types';

/**
 * The shortlists this browser has already paid for.
 *
 * The server keeps errands in memory, which is fine until it does not: the free
 * instance sleeps after fifteen minutes and every deploy replaces it, so a
 * shortlist that cost a Channel3 search and two model calls is gone by the time
 * the shopper reloads the page they are looking at. The id is in the URL and
 * answers 404.
 *
 * So the browser keeps its own copy. It is the same JSON the server sent, which
 * makes a reload free and instant, and it survives restarts the server cannot.
 * It is deliberately not a sync: one browser, one machine, no account.
 */
const KEY = 'errand.history.v1';

/** Ten shortlists is a few hundred KB and more than a session uses. */
const KEEP = 10;

export type HistoryEntry = {
  id: string;
  sentence: string;
  at: string;
  rows: number;
  clears: number;
};

type Stored = { index: HistoryEntry[] };

const read = (): Stored => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Stored) : undefined;
    return Array.isArray(parsed?.index) ? { index: parsed.index } : { index: [] };
  } catch {
    // A corrupt or disabled store is an empty history, never an error on screen.
    return { index: [] };
  }
};

const bodyKey = (id: string) => `${KEY}.${id}`;

/** Newest first. Empty when storage is unavailable, which is a valid state. */
export const listHistory = (): HistoryEntry[] => read().index;

export function loadErrand(id: string): Errand | undefined {
  try {
    const raw = localStorage.getItem(bodyKey(id));
    return raw ? (JSON.parse(raw) as Errand) : undefined;
  } catch {
    return undefined;
  }
}

export function saveErrand(errand: Errand): void {
  const clears = errand.rows.filter(
    (r) => r.marks.length > 0 && r.marks.every((m) => m.holds === 'yes'),
  ).length;
  const entry: HistoryEntry = {
    id: errand.id,
    sentence: errand.sentence,
    at: errand.createdAt,
    rows: errand.rows.length,
    clears,
  };

  const index = [entry, ...read().index.filter((e) => e.id !== errand.id)];
  const dropped = index.splice(KEEP);

  const write = () => {
    for (const old of dropped) localStorage.removeItem(bodyKey(old.id));
    localStorage.setItem(bodyKey(errand.id), JSON.stringify(errand));
    localStorage.setItem(KEY, JSON.stringify({ index }));
  };

  try {
    write();
  } catch {
    // Out of quota, or a private window that refuses to store. Drop the oldest
    // bodies and try once more; if it still fails the history is simply not
    // kept, which must never cost the shopper the shortlist on screen.
    try {
      for (const old of index.slice(1)) localStorage.removeItem(bodyKey(old.id));
      localStorage.setItem(bodyKey(errand.id), JSON.stringify(errand));
      localStorage.setItem(KEY, JSON.stringify({ index: [entry] }));
    } catch {
      /* no history this time */
    }
  }
}

export function forgetHistory(): void {
  try {
    for (const e of read().index) localStorage.removeItem(bodyKey(e.id));
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
