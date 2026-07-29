/**
 * Zenoti reports this account's sales in the center's own timezone: `sale_date` comes back as a
 * naive local datetime, and the accrual report's `start_date`/`end_date` filters are read the same
 * way - they take "YYYY-MM-DD HH:MM:SS" with no zone attached. All of this clinic's centers are in
 * Oman (Asia/Muscat), which is UTC+4 year-round with no DST, so a fixed offset is exact here and
 * no timezone database is needed.
 *
 * Every instant the sync sends to Zenoti, and every day boundary it reasons about, has to be in
 * center-local terms. Mixing the two is what previously produced pull windows that began partway
 * through a day: the window start was rewound to a *UTC* midnight and then formatted as a naive
 * string, which Zenoti read as 04:00 center-local. That left the first day of every file only
 * partly covered while still looking, from its row dates alone, like a day the file fully owned.
 */
export const CENTER_UTC_OFFSET_MS = 4 * 3_600_000;

/** Formats an instant as the center-local "YYYY-MM-DD HH:MM:SS" string the report endpoint expects. */
export function toCenterWallClock(instant) {
  return new Date(instant.getTime() + CENTER_UTC_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The instant at which a center-local day begins - the day containing `instant`, shifted by
 * `dayOffset` days (negative for earlier). Shifting the calendar day rather than subtracting
 * 24h keeps it a true day boundary.
 */
export function startOfCenterDay(instant, dayOffset = 0) {
  const local = new Date(instant.getTime() + CENTER_UTC_OFFSET_MS);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset);
  return new Date(localMidnight - CENTER_UTC_OFFSET_MS);
}

/** The instant a center-local calendar date (YYYY-MM-DD) starts, at 00:00:00 local. */
export function startOfCenterDate(dateStr) {
  const utcMidnight = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(utcMidnight)) return new Date(NaN);
  return new Date(utcMidnight - CENTER_UTC_OFFSET_MS);
}

/** The instant a center-local calendar date (YYYY-MM-DD) ends, at 23:59:59 local. */
export function endOfCenterDate(dateStr) {
  const utcEnd = Date.parse(`${dateStr}T23:59:59.000Z`);
  if (Number.isNaN(utcEnd)) return new Date(NaN);
  return new Date(utcEnd - CENTER_UTC_OFFSET_MS);
}

/** The center-local calendar date (YYYY-MM-DD) an instant falls on. */
export function toCenterDate(instant) {
  return new Date(instant.getTime() + CENTER_UTC_OFFSET_MS).toISOString().slice(0, 10);
}
