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
 * Resolves the [since, until] window for this run, in priority order:
 *  1. An explicit `sinceDate` (YYYY-MM-DD, from the workflow's manual "Run workflow" input) -
 *     for seeding an exact starting point, e.g. "I've manually uploaded through the 19th, only
 *     pull from the 20th onward."
 *  2. An explicit `syncBackAmount`+`syncBackUnit` - for a relative on-demand historical resync.
 *  3. Otherwise, since = the last successful run's timestamp (state file), or a 30-day default
 *     lookback the very first time this runs with no prior state.
 *
 * `until` is always `now` in every case - every run fetches through the present, so advancing
 * the watermark to `now` after a successful run is always correct regardless of which of the
 * above determined `since`.
 */
export async function resolveSyncWindow({ sinceDate, syncBackAmount, syncBackUnit, now = new Date() }) {
  if (sinceDate) {
    const since = new Date(`${sinceDate}T00:00:00Z`);
    if (Number.isNaN(since.getTime())) throw new Error(`Invalid since_date "${sinceDate}" - expected YYYY-MM-DD.`);
    return { since, until: now, mode: 'seed-from-date' };
  }

  if (syncBackAmount && syncBackUnit) {
    const ms = UNIT_TO_MS[syncBackUnit];
    if (!ms) throw new Error(`Unknown sync_back_unit "${syncBackUnit}" - expected days, months, or years.`);
    const since = new Date(now.getTime() - Number(syncBackAmount) * ms);
    return { since, until: now, mode: 'manual-backfill' };
  }

  const lastSyncedAt = await readLastSyncedAt();
  if (lastSyncedAt) {
    return { since: new Date(lastSyncedAt), until: now, mode: 'incremental' };
  }

  const since = new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * UNIT_TO_MS.days);
  return { since, until: now, mode: 'initial-default' };
}
