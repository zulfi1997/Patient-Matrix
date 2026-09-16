/**
 * Calendar-month arithmetic on ISO strings.
 *
 * Kept as string work rather than Date maths wherever possible: a month key is compared and sorted
 * as text all over this app, and routing it through Date only invites a timezone to shift it by a
 * day. Date is used solely where the calendar genuinely has to be consulted, for month length.
 */

/** The first of the month a date falls in, as ISO yyyy-mm-01. */
export function monthKeyOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Whole months from one month key to another. Negative if `to` precedes `from`. */
export function monthsBetween(from: string, to: string): number {
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  return (ty - fy) * 12 + (tm - fm);
}

/** The month key `count` months after `month`. */
export function addMonths(month: string, count: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const total = y * 12 + (m - 1) + count;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`;
}

/** How many days the given month has. */
export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  // Day 0 of the following month is the last day of this one, which gets February right without
  // a leap-year rule of our own.
  return new Date(year, monthNumber, 0).getDate();
}

/** Last calendar day of the given month, ISO yyyy-mm-dd. */
export function lastDayOfMonth(month: string): string {
  return `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, '0')}`;
}
