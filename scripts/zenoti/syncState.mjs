import { readFile, writeFile } from 'node:fs/promises';
import { endOfCenterDate, startOfCenterDate, startOfCenterDay } from './centerTime.mjs';

const STATE_PATH = new URL('./sync-state.json', import.meta.url);

const UNIT_TO_MS = {
  days: 86_400_000,
  months: 30 * 86_400_000, // approximate - fine for a backfill window, not for precise accounting periods
  years: 365 * 86_400_000,
};

/** Default lookback the very first time this runs, before any state file exists. */
const INITIAL_LOOKBACK_DAYS = 30;

/**
 * How many extra whole days before the last synced day an incremental run re-pulls. One day of
 * overlap costs almost nothing (the import replaces a day wholesale rather than appending to it)
 * and picks up invoices finalized, corrected, or voided after that day's original sync.
 */
const INCREMENTAL_OVERLAP_DAYS = 1;

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
 * Resolves the [since, until] window for this run. Every boundary is a center-local day boundary
 * (see centerTime.mjs) - never a raw timestamp partway through a day.
 *
 * That alignment matters because a sales export is treated as authoritative for the days it
 * covers (see addBatch in src/db/db.ts): importing a file that holds only part of a day would
 * discard the rest of that day. Starting from the raw watermark instant used to produce windows
 * like "28 Jul 19:55 -> 29 Jul 12:05", so every file held two half-days and none held a complete
 * one. Now every day in a window is complete except the final, still-in-progress one, which the
 * next run re-pulls in full.
 *
 * `until` defaults to `now`, but an explicit `untilDate` (YYYY-MM-DD, end of that center-local
 * day) bounds a resync so it stops at a fixed point instead of always reaching the present - e.g.
 * re-checking a specific past period without pulling in today's still-accumulating data. This
 * makes that run a "bounded-resync": since it doesn't reach `now`, it must NOT advance the sync
 * watermark afterward (that's reserved for runs that genuinely cover through the present), so the
 * ongoing incremental schedule continues completely unaffected by it.
 *
 * `since` is resolved in priority order:
 *  1. An explicit `sinceDate` (YYYY-MM-DD) - for seeding an exact starting point, e.g. "I've
 *     manually uploaded through the 19th, only pull from the 20th onward." Taken as the start of
 *     that center-local day.
 *  2. An explicit `syncBackAmount`+`syncBackUnit`, relative to `until` (so pairing it with
 *     `untilDate` means "N units before that date", not before today), rewound to the start of
 *     the center-local day it lands on.
 *  3. Otherwise, the last successful run's timestamp (state file), rewound to the start of its
 *     center-local day and then back a further INCREMENTAL_OVERLAP_DAYS; or a 30-day lookback the
 *     very first time this runs with no prior state. `untilDate` isn't meaningful combined with
 *     that first-run fallback, so it's rejected rather than silently ignored.
 */
export async function resolveSyncWindow({
  sinceDate,
  untilDate,
  syncBackAmount,
  syncBackUnit,
  now = new Date(),
  // Overrides the state file. Only tests pass it - the watermark on disk is rewritten by the
  // scheduled job, so a test that read it could not assert a fixed window.
  lastSyncedAt: lastSyncedAtOverride,
}) {
  const until = untilDate ? endOfCenterDate(untilDate) : now;
  if (untilDate && Number.isNaN(until.getTime())) throw new Error(`Invalid until_date "${untilDate}" - expected YYYY-MM-DD.`);
  const bounded = !!untilDate;

  if (sinceDate) {
    const since = startOfCenterDate(sinceDate);
    if (Number.isNaN(since.getTime())) throw new Error(`Invalid since_date "${sinceDate}" - expected YYYY-MM-DD.`);
    return { since, until, mode: bounded ? 'bounded-resync' : 'seed-from-date' };
  }

  if (syncBackAmount && syncBackUnit) {
    const ms = UNIT_TO_MS[syncBackUnit];
    if (!ms) throw new Error(`Unknown sync_back_unit "${syncBackUnit}" - expected days, months, or years.`);
    const since = startOfCenterDay(new Date(until.getTime() - Number(syncBackAmount) * ms));
    return { since, until, mode: bounded ? 'bounded-resync' : 'manual-backfill' };
  }

  if (bounded) {
    throw new Error('until_date needs since_date or sync_back_amount/sync_back_unit set too - there is nothing to bound otherwise.');
  }

  const lastSyncedAt = lastSyncedAtOverride ?? (await readLastSyncedAt());
  if (lastSyncedAt) {
    return { since: startOfCenterDay(new Date(lastSyncedAt), -INCREMENTAL_OVERLAP_DAYS), until, mode: 'incremental' };
  }

  const since = startOfCenterDay(new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * UNIT_TO_MS.days));
  return { since, until, mode: 'initial-default' };
}
