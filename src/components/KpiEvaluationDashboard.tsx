import { useCallback, useMemo } from 'react';
import type { SaleRecord } from '../types';
import { buildKpiContext, KPI_CATALOG, type KpiPoint } from '../lib/kpiCatalog';
import { toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiPicker } from './KpiPicker';
import { KpiScorecardCard } from './KpiScorecardCard';
import { KpiCorrelationMatrix } from './KpiCorrelationMatrix';
import { KpiCorrelationInsights } from './KpiCorrelationInsights';

const MONTHS_OPTIONS = [6, 12, 24, 36];
const DEFAULT_SELECTED = ['revenue-total', 'patient-new', 'patient-retention-rate', 'staff-yb111-count'];

export function KpiEvaluationDashboard({ records }: { records: SaleRecord[] }) {
  const [monthsBack, setMonthsBack] = useLocalStorageState('pm-kpi-months-back', 12);
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

  const ctx = useMemo(() => buildKpiContext(records, asOfISO, monthsBack), [records, asOfISO, monthsBack]);

  const selectedKpis = useMemo(() => KPI_CATALOG.filter((k) => selected.has(k.id)), [selected]);

  const seriesById = useMemo(() => {
    const map = new Map<string, KpiPoint[]>();
    for (const kpi of selectedKpis) {
      map.set(kpi.id, kpi.compute(ctx));
    }
    return map;
  }, [selectedKpis, ctx]);

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
            Pick any KPIs across Revenue, Patient, Staff, and Service, see them evaluated side by side over the last{' '}
            {monthsBack} months, and how they relate to each other. Data as of {asOfISO}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">History</label>
            <select
              value={monthsBack}
              onChange={(e) => setMonthsBack(Number(e.target.value))}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              {MONTHS_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  Last {m} months
                </option>
              ))}
            </select>
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
              <KpiScorecardCard key={kpi.id} kpi={kpi} points={seriesById.get(kpi.id) ?? []} />
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
