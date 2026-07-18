const currencyFormatter = new Intl.NumberFormat('en-OM', {
  style: 'currency',
  currency: 'OMR',
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

const compactCurrencyFormatter = new Intl.NumberFormat('en-OM', {
  style: 'currency',
  currency: 'OMR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Abbreviated formatting (e.g. "OMR 109.4K") for headline KPI tiles, so large totals don't overflow. */
export function formatCurrencyCompact(value: number): string {
  return compactCurrencyFormatter.format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatMonthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
