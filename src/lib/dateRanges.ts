import type { DateRange } from './metrics';
import { toISODate } from './format';

export type PresetKey = 'last30' | 'thisMonth' | 'lastMonth' | 'last90' | 'thisQuarter' | 'ytd' | 'custom';

export const PRESET_LABELS: Record<PresetKey, string> = {
  last30: 'Last 30 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  last90: 'Last 90 days',
  thisQuarter: 'This quarter',
  ytd: 'Year to date',
  custom: 'Custom range',
};

export function resolvePreset(preset: PresetKey, asOfISO: string, custom?: DateRange): DateRange {
  const asOf = new Date(`${asOfISO}T00:00:00`);
  const y = asOf.getFullYear();
  const m = asOf.getMonth();

  switch (preset) {
    case 'last30': {
      const start = new Date(asOf);
      start.setDate(start.getDate() - 29);
      return { start: toISODate(start), end: asOfISO };
    }
    case 'last90': {
      const start = new Date(asOf);
      start.setDate(start.getDate() - 89);
      return { start: toISODate(start), end: asOfISO };
    }
    case 'thisMonth':
      return { start: toISODate(new Date(y, m, 1)), end: asOfISO };
    case 'lastMonth': {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      return { start: toISODate(start), end: toISODate(end) };
    }
    case 'thisQuarter': {
      const qStartMonth = Math.floor(m / 3) * 3;
      return { start: toISODate(new Date(y, qStartMonth, 1)), end: asOfISO };
    }
    case 'ytd':
      return { start: toISODate(new Date(y, 0, 1)), end: asOfISO };
    case 'custom':
      return custom ?? { start: asOfISO, end: asOfISO };
  }
}
