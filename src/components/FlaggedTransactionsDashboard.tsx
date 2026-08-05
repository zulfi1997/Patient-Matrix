import { useMemo } from 'react';
import type { SaleRecord } from '../types';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import {
  computeFlaggedByService,
  computeFlaggedByStaff,
  computeFlaggedDueInvoices,
  computeFlaggedMonthlyTrend,
  computeFlaggedSummary,
  computeFlaggedTransactions,
  type DateRange,
} from '../lib/metrics';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from '../lib/conversionMetrics';
import { formatCurrency, formatCurrencyCompact, formatNumber, toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { PeriodPresetSelect } from './PeriodPresetSelect';
import { ExportExcelButton } from './ExportExcelButton';
import { flaggedSheets, contextSheet } from '../lib/dashboardExports';
import { FlaggedTrendChart } from './FlaggedTrendChart';
import { FlaggedBreakdownTable } from './FlaggedBreakdownTable';
import { FlaggedTransactionsTable } from './FlaggedTransactionsTable';
import { FlaggedDueInvoicesTable } from './FlaggedDueInvoicesTable';

const TREND_MONTHS_BACK = 12;

export function FlaggedTransactionsDashboard({
  records,
  providerGroups,
  providerAssignmentOverrides,
}: {
  records: SaleRecord[];
  providerGroups: ProviderGroup[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
}) {
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

  // Same grouping every other tab uses, so an assisting nurse's flagged invoices count under the
  // doctor she assisted rather than appearing as a provider of her own.
  const resolveStaff = useMemo(
    () => (r: SaleRecord) => resolveProvider(r.staff, r.date, providerGroups, providerAssignmentOverrides),
    [providerGroups, providerAssignmentOverrides],
  );

  const summary = useMemo(() => computeFlaggedSummary(records, range, resolveStaff), [records, range, resolveStaff]);
  const transactions = useMemo(() => computeFlaggedTransactions(records, range, resolveStaff), [records, range, resolveStaff]);
  const byStaff = useMemo(() => computeFlaggedByStaff(records, range, resolveStaff), [records, range, resolveStaff]);
  const byService = useMemo(() => computeFlaggedByService(records, range), [records, range]);
  const trend = useMemo(
    () => computeFlaggedMonthlyTrend(records, TREND_MONTHS_BACK, asOfISO),
    [records, asOfISO],
  );
  const dueInvoices = useMemo(() => computeFlaggedDueInvoices(records, range), [records, range]);
  const totalDue = useMemo(() => dueInvoices.reduce((sum, i) => sum + i.dueAmount, 0), [dueInvoices]);

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
          <ExportExcelButton
            fileName={`yb111-analytics-${range.start}-to-${range.end}.xlsx`}
            buildSheets={() => [
              contextSheet([
                ['Report', 'YB111 Analytics'],
                ['Period', `${PRESET_LABELS[preset]} (${range.start} to ${range.end})`],
                ['Data as of', asOfISO],
                ['Scope', 'Line items whose Invoice Notes contain "YB111". Shown regardless of the Exclude YB111 toggle, since that is this tab\'s purpose.'],
                ['Staff', 'Canonical provider after Provider Groups and date-scoped overrides, so an assisting nurse counts under whichever doctor she assisted that day. The name on the line itself is kept as Raw Staff.'],
                ['Currency', 'OMR. Amounts are numbers, not text, so they pivot and sum directly.'],
              ]),
              ...flaggedSheets({ summary, transactions, byStaff, byService, trend, dueInvoices }),
            ]}
          />
          <button
            onClick={() => window.print()}
            className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Export / Print Dashboard
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="Flagged Transactions"
          value={formatNumber(summary.count)}
          help='Count of line items whose Invoice Notes mention "YB111" (any case), in the selected period.'
          tone="bad"
        />
        <KpiCard
          label="Flagged Value"
          value={formatCurrencyCompact(summary.amount)}
          hint={formatCurrency(summary.amount)}
          help="Total revenue (Sales Exc. Tax) across the flagged line items above."
        />
        <KpiCard
          label="Distinct Patients"
          value={formatNumber(summary.distinctPatients)}
          help="Number of different patients who have at least one flagged line item in the selected period."
        />
        <KpiCard
          label="Distinct Staff"
          value={formatNumber(summary.distinctStaff)}
          help="Number of different providers with at least one flagged line item in the selected period, counted after Provider Groups and date-scoped overrides - an assisting nurse counts under the doctor she assisted rather than as a provider of her own."
        />
        <KpiCard
          label="Due to Be Settled"
          value={formatCurrencyCompact(totalDue)}
          hint={`${formatCurrency(totalDue)} · ${formatNumber(dueInvoices.length)} invoice(s)`}
          help="Outstanding (unpaid) balance still owed on invoices that contain a flagged line item - independent of the period selected above, since a due balance doesn't stop being owed just because the sale date falls outside the window."
          tone={dueInvoices.length > 0 ? 'bad' : 'neutral'}
        />
      </div>

      <FlaggedTrendChart data={trend} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
        <FlaggedBreakdownTable
          title="By Staff"
          columnLabel="Staff"
          data={byStaff}
          note="Grouped by canonical provider, so an assisting nurse's flagged invoices count under the doctor she assisted - configure this under Master Control on the Data tab."
        />
        <FlaggedBreakdownTable title="By Service" columnLabel="Service" data={byService} />
      </div>

      <FlaggedDueInvoicesTable data={dueInvoices} periodLabel={periodLabel} />

      <FlaggedTransactionsTable data={transactions} periodLabel={periodLabel} />
    </div>
  );
}
