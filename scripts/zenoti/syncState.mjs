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
 * Resolves the [since, until] window for this run:
 *  - an explicit `syncBackAmount`+`syncBackUnit` (from the workflow's manual "Run workflow"
 *    inputs) always wins, for on-demand historical resyncs;
 *  - otherwise, since = the last successful run's timestamp (state file), or a 30-day
 *    default lookback the very first time this runs with no prior state.
 */
export async function resolveSyncWindow({ syncBackAmount, syncBackUnit, now = new Date() }) {
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
