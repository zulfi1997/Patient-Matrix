import { describe, expect, it } from 'vitest';
import { resolveSyncWindow } from './syncState.mjs';
import { endOfCenterDate, startOfCenterDate, startOfCenterDay, toCenterDate, toCenterWallClock } from './centerTime.mjs';

/** What the report endpoint actually receives - it reads these as center-local time. */
const sent = (instant) => toCenterWallClock(instant);

/** The scheduled run: 08:05 UTC = 12:05 Oman. */
const NOW = new Date('2026-07-30T08:05:00Z');
const base = { sinceDate: null, untilDate: null, syncBackAmount: null, syncBackUnit: null, now: NOW };

describe('centerTime', () => {
  it('formats an instant as center-local wall clock, not UTC', () => {
    expect(toCenterWallClock(new Date('2026-07-28T20:00:00Z'))).toBe('2026-07-29 00:00:00');
  });

  it('maps a center-local date to the instant that day starts', () => {
    // 01 Jul 00:00 Oman is 30 Jun 20:00 UTC - not 01 Jul 00:00 UTC, which is 04:00 Oman.
    expect(startOfCenterDate('2026-07-01').toISOString()).toBe('2026-06-30T20:00:00.000Z');
    expect(sent(startOfCenterDate('2026-07-01'))).toBe('2026-07-01 00:00:00');
  });

  it('maps a center-local date to the instant that day ends', () => {
    expect(sent(endOfCenterDate('2026-07-28'))).toBe('2026-07-28 23:59:59');
  });

  it('truncates an instant to the start of its center-local day', () => {
    // 19:34 Oman on the 29th belongs to the 29th, so its day starts at 29 Jul 00:00 local.
    expect(sent(startOfCenterDay(new Date('2026-07-29T15:34:40Z')))).toBe('2026-07-29 00:00:00');
  });

  it('shifts by whole calendar days, including across a month boundary', () => {
    expect(sent(startOfCenterDay(new Date('2026-08-01T10:00:00Z'), -1))).toBe('2026-07-31 00:00:00');
    expect(sent(startOfCenterDay(new Date('2026-07-29T15:34:40Z'), -1))).toBe('2026-07-28 00:00:00');
  });

  it('reports the center-local date an instant falls on', () => {
    // 21:00 UTC on the 28th is already the 29th in Oman.
    expect(toCenterDate(new Date('2026-07-28T21:00:00Z'))).toBe('2026-07-29');
  });

  it('returns an Invalid Date for a malformed date rather than a wrong one', () => {
    expect(Number.isNaN(startOfCenterDate('not-a-date').getTime())).toBe(true);
    expect(Number.isNaN(endOfCenterDate('2026-13-99').getTime())).toBe(true);
  });
});

describe('resolveSyncWindow', () => {
  it('opens an incremental window exactly at a center-local midnight', async () => {
    // The regression this guards: using the raw watermark instant produced a window starting
    // 19:55 Oman, so every file held two half-days and none held a complete one.
    const w = await resolveSyncWindow({ ...base, lastSyncedAt: '2026-07-29T15:34:40.289Z' });
    expect(sent(w.since)).toMatch(/ 00:00:00$/);
  });

  it('re-pulls one whole day before the watermark day', async () => {
    const w = await resolveSyncWindow({ ...base, lastSyncedAt: '2026-07-29T15:34:40.289Z' });
    expect(sent(w.since)).toBe('2026-07-28 00:00:00');
    expect(w.mode).toBe('incremental');
  });

  it('fully covers the day the watermark falls on', async () => {
    const w = await resolveSyncWindow({ ...base, lastSyncedAt: '2026-07-29T15:34:40.289Z' });
    expect(w.since.getTime()).toBeLessThanOrEqual(startOfCenterDate('2026-07-29').getTime());
  });

  it('still opens on a day boundary when the watermark is near midnight', async () => {
    // 21:00 UTC is already the next day in Oman; the window must not slip a day either way.
    const w = await resolveSyncWindow({ ...base, lastSyncedAt: '2026-07-28T21:00:00.000Z' });
    expect(sent(w.since)).toBe('2026-07-28 00:00:00');
  });

  it('maps since_date and until_date to exact center-local day edges', async () => {
    const w = await resolveSyncWindow({ ...base, sinceDate: '2026-07-01', untilDate: '2026-07-28' });
    expect(sent(w.since)).toBe('2026-07-01 00:00:00');
    expect(sent(w.until)).toBe('2026-07-28 23:59:59');
    expect(toCenterDate(w.since)).toBe('2026-07-01');
    expect(toCenterDate(w.until)).toBe('2026-07-28');
  });

  it('marks a bounded resync so it cannot advance the watermark', async () => {
    const w = await resolveSyncWindow({ ...base, sinceDate: '2026-07-01', untilDate: '2026-07-28' });
    expect(w.mode).toBe('bounded-resync');
  });

  it('treats since_date without until_date as seeding through the present', async () => {
    const w = await resolveSyncWindow({ ...base, sinceDate: '2026-07-20' });
    expect(w.mode).toBe('seed-from-date');
    expect(w.until).toBe(NOW);
  });

  it('aligns a relative backfill to a day boundary too', async () => {
    const w = await resolveSyncWindow({ ...base, syncBackAmount: '7', syncBackUnit: 'days' });
    expect(sent(w.since)).toMatch(/ 00:00:00$/);
    expect(w.mode).toBe('manual-backfill');
  });

  it('rejects a malformed since_date instead of silently pulling the wrong window', async () => {
    await expect(resolveSyncWindow({ ...base, sinceDate: 'yesterday' })).rejects.toThrow(/since_date/);
  });

  it('rejects until_date with nothing to bound', async () => {
    await expect(resolveSyncWindow({ ...base, untilDate: '2026-07-28' })).rejects.toThrow(/nothing to bound/);
  });

  it('rejects an unknown sync_back_unit', async () => {
    await expect(resolveSyncWindow({ ...base, syncBackAmount: '3', syncBackUnit: 'fortnights' })).rejects.toThrow(
      /sync_back_unit/,
    );
  });
});
