function toISODate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parses "M/D/YYYY" (the format used by Zenoti exports), Excel date serials, or Date objects. */
export function parseFlexibleDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toISODate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    // Excel serial date: days since 1899-12-30 (epoch offset 25569 = 1970-01-01).
    const utcDays = Math.floor(value - 25569);
    const d = new Date(utcDays * 86_400_000);
    return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const str = String(value).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    return toISODate(year, month, day);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parses "17 Jul 2026" style dates (used in Zenoti report title/footer text), Excel serials, or Date objects. */
export function parseTitleDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toISODate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const str = String(value).trim();
  const m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(str);
  if (m) {
    const month = MONTH_NAMES[m[2].slice(0, 3).toLowerCase()];
    if (month) return toISODate(parseInt(m[3], 10), month, parseInt(m[1], 10));
  }
  return parseFlexibleDate(value);
}

export function parseNumber(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
