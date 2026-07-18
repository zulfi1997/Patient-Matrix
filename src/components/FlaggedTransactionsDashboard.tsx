import { useMemo } from 'react';
import type { SaleRecord } from '../types';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import {
  computeFlaggedByService,
  computeFlaggedByStaff,
  computeFlaggedMonthlyTrend,
  computeFlaggedSummary,
  computeFlaggedTransactions,
  type DateRange,
} from '../lib/metrics';
import { formatCurrency, formatCurrencyCompact, formatNumber, toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { PeriodPresetSelect } from './PeriodPresetSelect';
import { FlaggedTrendChart } from './FlaggedTrendChart';
import { FlaggedBreakdownTable } from './FlaggedBreakdownTable';
import { FlaggedTransactionsTable } from './FlaggedTransactionsTable';

const TREND_MONTHS_BACK = 12;

export function FlaggedTransactionsDashboard({ records }: { records: SaleRecord[] }) {
  const [preset, setPreset] = useLocalStorageState<PresetKey>('pm-yb111-preset', 'ytd');
  const [customRange, setCustomRange] = useLocalStorageState<DateRange>('pm-yb111-custom-range', {
    start: toISODate(new Date(Date.now() - 29 * 86_400_000)),
    end: toISODate(new Date()),
  });

  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);

  const range = useMemo(() => resolvePreset(preset, asOfISO, customRange), [preset, asOfISO, customRange]);

  const summary = useMemo(() => computeFlaggedSummary(records, range), [records, range]);
  const transactions = useMemo(() => computeFlaggedTransactions(records, range), [records, range]);
  const byStaff = useMemo(() => computeFlaggedByStaff(records, range), [records, range]);
  const byService = useMemo(() => computeFlaggedByService(records, range), [records, range]);
  const trend = useMemo(
    () => computeFlaggedMonthlyTrend(records, TREND_MONTHS_BACK, asOfISO),
    [records, asOfISO],
  );

  const periodLabel = `${PRESET_LABELS[preset]} (${range.start} to ${range.end})`;

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold text-zinc-900">Patient Matrix — "YB111" Analytics Report</h1>
        <p className="text-xs text-zinc-500">Generated {new Date().toLocaleString('en-GB')}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 print:hidden">"YB111" Analytics</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Transactions whose Invoice Notes mention "YB111" (any case). Showing {periodLabel}. Data as of {asOfISO}.
            This view always includes flagged transactions regardless of the header toggle.
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Flagged Transactions" value={formatNumber(summary.count)} tone="bad" />
        <KpiCard
          label="Flagged Value"
          value={formatCurrencyCompact(summary.amount)}
          hint={formatCurrency(summary.amount)}
        />
        <KpiCard label="Distinct Patients" value={formatNumber(summary.distinctPatients)} />
        <KpiCard label="Distinct Staff" value={formatNumber(summary.distinctStaff)} />
      </div>

      <FlaggedTrendChart data={trend} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
        <FlaggedBreakdownTable title="By Staff" columnLabel="Staff" data={byStaff} />
        <FlaggedBreakdownTable title="By Service" columnLabel="Service" data={byService} />
      </div>

      <FlaggedTransactionsTable data={transactions} periodLabel={periodLabel} />
    </div>
  );
}
