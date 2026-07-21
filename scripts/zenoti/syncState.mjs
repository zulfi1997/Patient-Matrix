import { readFile, writeFile } from 'node:fs/promises';

const STATE_PATH = new URL('./sync-state.json', import.meta.url);

const UNIT_TO_MS = {
  days: 86_400_000,
  months: 30 * 86_400_000, // approximate - fine for a backfill window, not for precise accounting periods
  years: 365 * 86_400_000,
};

/** Default lookback the very first time this runs, before any state file exists. */
const INITIAL_LOOKBACK_DAYS = 30;

export async function readLastSyncedAt() {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw).lastSyncedAt ?? null;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeLastSyncedAt(iso) {
  await writeFile(STATE_PATH, JSON.stringify({ lastSyncedAt: iso }, null, 2) + '\n', 'utf8');
}

/**
 * Resolves the [since, until] window for this run.
 *
 * `until` defaults to `now`, but an explicit `untilDate` (YYYY-MM-DD, end of that day) bounds a
 * resync so it stops at a fixed point instead of always reaching the present - e.g. re-checking
 * a specific past period without pulling in today's still-accumulating data. This makes that
 * run a "bounded-resync": since it doesn't reach `now`, it must NOT advance the sync watermark
 * afterward (that's reserved for runs that genuinely cover through the present), so the ongoing
 * incremental schedule continues completely unaffected by it.
 *
 * `since` is resolved in priority order:
 *  1. An explicit `sinceDate` (YYYY-MM-DD) - for seeding an exact starting point, e.g. "I've
 *     manually uploaded through the 19th, only pull from the 20th onward."
 *  2. An explicit `syncBackAmount`+`syncBackUnit`, relative to `until` (so pairing it with
 *     `untilDate` means "N units before that date", not before today).
 *  3. Otherwise, since = the last successful run's timestamp (state file), or a 30-day default
 *     lookback the very first time this runs with no prior state - `untilDate` isn't meaningful
 *     combined with this fallback, so it's rejected rather than silently ignored.
 */
export async function resolveSyncWindow({ sinceDate, untilDate, syncBackAmount, syncBackUnit, now = new Date() }) {
  const until = untilDate ? new Date(`${untilDate}T23:59:59Z`) : now;
  if (untilDate && Number.isNaN(until.getTime())) throw new Error(`Invalid until_date "${untilDate}" - expected YYYY-MM-DD.`);
  const bounded = !!untilDate;

  if (sinceDate) {
    const since = new Date(`${sinceDate}T00:00:00Z`);
    if (Number.isNaN(since.getTime())) throw new Error(`Invalid since_date "${sinceDate}" - expected YYYY-MM-DD.`);
    return { since, until, mode: bounded ? 'bounded-resync' : 'seed-from-date' };
  }

  if (syncBackAmount && syncBackUnit) {
    const ms = UNIT_TO_MS[syncBackUnit];
    if (!ms) throw new Error(`Unknown sync_back_unit "${syncBackUnit}" - expected days, months, or years.`);
    const since = new Date(until.getTime() - Number(syncBackAmount) * ms);
    return { since, until, mode: bounded ? 'bounded-resync' : 'manual-backfill' };
  }

  if (bounded) {
    throw new Error('until_date needs since_date or sync_back_amount/sync_back_unit set too - there is nothing to bound otherwise.');
  }

  const lastSyncedAt = await readLastSyncedAt();
  if (lastSyncedAt) {
    return { since: new Date(lastSyncedAt), until, mode: 'incremental' };
  }

  const since = new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * UNIT_TO_MS.days);
  return { since, until, mode: 'initial-default' };
}
