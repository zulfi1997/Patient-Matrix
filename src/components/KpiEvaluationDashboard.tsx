import { useCallback, useMemo } from 'react';
import type { SaleRecord } from '../types';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import {
  computeKpiMonthlySeries,
  computeKpiPeriodValue,
  KPI_CATALOG,
  type KpiPeriodValue,
  type KpiPoint,
} from '../lib/kpiCatalog';
import type { ProviderGroup } from '../lib/conversionMetrics';
import { summarizePatients, type DateRange } from '../lib/metrics';
import { toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { PeriodPresetSelect } from './PeriodPresetSelect';
import { KpiPicker } from './KpiPicker';
import { KpiScorecardCard } from './KpiScorecardCard';
import { KpiCorrelationMatrix } from './KpiCorrelationMatrix';
import { KpiCorrelationInsights } from './KpiCorrelationInsights';

// The sparkline/correlation view stays on a fixed rolling window regardless of the period
// selector, same as the Dashboard's own trend charts vs. its period-scoped KPI cards.
const TREND_MONTHS_BACK = 12;
const DEFAULT_SELECTED = ['revenue-total', 'patient-new', 'patient-retention-rate', 'staff-yb111-count'];

export function KpiEvaluationDashboard({ records, providerGroups }: { records: SaleRecord[]; providerGroups: ProviderGroup[] }) {
  const [preset, setPreset] = useLocalStorageState<PresetKey>('pm-kpi-preset', 'last30');
  const [customRange, setCustomRange] = useLocalStorageState<DateRange>('pm-kpi-custom-range', {
    start: toISODate(new Date(Date.now() - 29 * 86_400_000)),
    end: toISODate(new Date()),
  });
  const [selectedIds, setSelectedIds] = useLocalStorageState<string[]>('pm-kpi-selected', DEFAULT_SELECTED);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = useCallback(
    (id: string) => {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    },
    [setSelectedIds],
  );

  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);

  const range: DateRange = useMemo(() => resolvePreset(preset, asOfISO, customRange), [preset, asOfISO, customRange]);
  const patients = useMemo(() => summarizePatients(records), [records]);

  const selectedKpis = useMemo(() => KPI_CATALOG.filter((k) => selected.has(k.id)), [selected]);

  const periodValueById = useMemo(() => {
    const map = new Map<string, KpiPeriodValue>();
    for (const kpi of selectedKpis) {
      map.set(kpi.id, computeKpiPeriodValue(kpi, records, patients, range, asOfISO, providerGroups));
    }
    return map;
  }, [selectedKpis, records, patients, range, asOfISO, providerGroups]);

  const seriesById = useMemo(() => {
    const map = new Map<string, KpiPoint[]>();
    for (const kpi of selectedKpis) {
      map.set(kpi.id, computeKpiMonthlySeries(kpi, records, patients, asOfISO, TREND_MONTHS_BACK, providerGroups));
    }
    return map;
  }, [selectedKpis, records, patients, asOfISO, providerGroups]);

  const periodLabel = `${PRESET_LABELS[preset]} (${range.start} to ${range.end})`;

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold text-zinc-900">Patient Matrix — KPI Evaluation Report</h1>
        <p className="text-xs text-zinc-500">Generated {new Date().toLocaleString('en-GB')}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 print:hidden">KPI Evaluation</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Pick any KPIs across Revenue, Patient, Staff, and Service. Scorecards show {periodLabel}, compared with
            the equivalent prior period; trends and relationships below are always the last {TREND_MONTHS_BACK}{' '}
            months. Data as of {asOfISO}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <PeriodPresetSelect
              preset={preset}
              onPresetChange={setPreset}
              customRange={customRange}
              onCustomRangeChange={setCustomRange}
            />
          </div>
          <button
            onClick={() => window.print()}
            className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Export / Print Dashboard
          </button>
        </div>
      </div>

      <KpiPicker selected={selected} onToggle={toggle} />

      {selectedKpis.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Select one or more KPIs above to see them evaluated here.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {selectedKpis.map((kpi) => (
              <KpiScorecardCard
                key={kpi.id}
                kpi={kpi}
                periodValue={periodValueById.get(kpi.id)!}
                series={seriesById.get(kpi.id) ?? []}
              />
            ))}
          </div>

          {selectedKpis.length >= 2 && (
            <>
              <KpiCorrelationInsights selected={selectedKpis} seriesById={seriesById} />
              <KpiCorrelationMatrix selected={selectedKpis} seriesById={seriesById} />
            </>
          )}
        </>
      )}
    </div>
  );
}
