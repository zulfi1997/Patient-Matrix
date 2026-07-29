/** Fixed UTC offset of the clinic's centers (Oman / Asia/Muscat, UTC+4, no DST), in milliseconds. */
export const CENTER_UTC_OFFSET_MS: number;

/** Formats an instant as the center-local "YYYY-MM-DD HH:MM:SS" string Zenoti's report filters expect. */
export function toCenterWallClock(instant: Date): string;

/** The instant a center-local day begins - the day containing `instant`, shifted by `dayOffset` days. */
export function startOfCenterDay(instant: Date, dayOffset?: number): Date;

/** The instant a center-local calendar date (YYYY-MM-DD) starts, at 00:00:00 local. Invalid input yields an Invalid Date. */
export function startOfCenterDate(dateStr: string): Date;

/** The instant a center-local calendar date (YYYY-MM-DD) ends, at 23:59:59 local. Invalid input yields an Invalid Date. */
export function endOfCenterDate(dateStr: string): Date;

/** The center-local calendar date (YYYY-MM-DD) an instant falls on. */
export function toCenterDate(instant: Date): string;
