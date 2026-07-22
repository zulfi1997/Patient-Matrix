import { useMemo, useState } from 'react';
import type { PackageBenefitRecord, SaleRecord } from '../types';
import type { ProviderAssignmentOverride, ProviderGroup } from '../lib/conversionMetrics';
import { previousPeriod, type DateRange, type PatientVisitSummary } from '../lib/metrics';
import { PRESET_LABELS, resolvePreset, type PresetKey } from '../lib/dateRanges';
import type { ServiceDepartmentRecord } from '../lib/departments';
import {
  buildBenefitLookup,
  buildDepartmentPatientActivityCsv,
  buildDepartmentProviderCsv,
  buildDepartmentRedemptionsCsv,
  buildDepartmentRevenueCsv,
  buildServiceDepartmentMap,
  computeDepartmentPackageRedemptions,
  computeDepartmentPatientActivity,
  computeDepartmentProviderContribution,
  computeDepartmentRevenue,
  UNMAPPED,
  type DepartmentOrUnmapped,
  type DepartmentProviderRow,
  type DepartmentRedemptionRow,
} from '../lib/departmentAnalytics';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { PeriodPresetSelect } from './PeriodPresetSelect';
import { KpiCard } from './KpiCard';
import { InfoTooltip } from './InfoTooltip';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent, toISODate } from '../lib/format';

function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function groupByDepartment<T extends { department: DepartmentOrUnmapped }>(rows: T[]): Map<DepartmentOrUnmapped, T[]> {
  const map = new Map<DepartmentOrUnmapped, T[]>();
  for (const row of rows) {
    if (!map.has(row.department)) map.set(row.department, []);
    map.get(row.department)!.push(row);
  }
  return map;
}

export function DepartmentAnalyticsDashboard({
  records,
  patients,
  packageBenefits,
  serviceDepartmentRecords,
  providerGroups,
  providerAssignmentOverrides,
}: {
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
  packageBenefits: PackageBenefitRecord[];
  serviceDepartmentRecords: ServiceDepartmentRecord[];
  providerGroups: ProviderGroup[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
}) {
  const [preset, setPreset] = useLocalStorageState<PresetKey>('pm-dept-preset', 'last30');
  const [customRange, setCustomRange] = useLocalStorageState<DateRange>('pm-dept-custom-range', {
    start: toISODate(new Date(Date.now() - 29 * 86_400_000)),
    end: toISODate(new Date()),
  });
  const [departmentFilter, setDepartmentFilter] = useState<'All' | DepartmentOrUnmapped>('All');

  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);

  const range = useMemo(() => resolvePreset(preset, asOfISO, customRange), [preset, asOfISO, customRange]);
  const prevRange = useMemo(() => previousPeriod(range), [range]);
  const periodLabel = `${PRESET_LABELS[preset]} (${range.start} to ${range.end})`;

  const mapping = useMemo(() => buildServiceDepartmentMap(serviceDepartmentRecords), [serviceDepartmentRecords]);
  const lookup = useMemo(() => buildBenefitLookup(packageBenefits, serviceDepartmentRecords), [packageBenefits, serviceDepartmentRecords]);

  const revenueRows = useMemo(
    () => computeDepartmentRevenue(records, range, prevRange, mapping, lookup),
    [records, range, prevRange, mapping, lookup],
  );
  const providerRows = useMemo(
    () => computeDepartmentProviderContribution(records, range, mapping, lookup, providerGroups, providerAssignmentOverrides),
    [records, range, mapping, lookup, providerGroups, providerAssignmentOverrides],
  );
  const redemptionRows = useMemo(
    () => computeDepartmentPackageRedemptions(records, range, mapping, lookup, providerGroups, providerAssignmentOverrides),
    [records, range, mapping, lookup, providerGroups, providerAssignmentOverrides],
  );
  const patientRows = useMemo(
    () => computeDepartmentPatientActivity(records, range, mapping, lookup, patients),
    [records, range, mapping, lookup, patients],
  );

  const departmentsPresent = useMemo(() => {
    const set = new Set<DepartmentOrUnmapped>();
    for (const rows of [revenueRows, providerRows, redemptionRows, patientRows]) {
      for (const r of rows) set.add(r.department);
    }
    return [...set].sort((a, b) => (a === UNMAPPED ? 1 : b === UNMAPPED ? -1 : a.localeCompare(b)));
  }, [revenueRows, providerRows, redemptionRows, patientRows]);

  const providerRowsByDept = useMemo(() => groupByDepartment(providerRows), [providerRows]);
  const redemptionRowsByDept = useMemo(() => groupByDepartment(redemptionRows), [redemptionRows]);

  const totalRevenue = revenueRows.reduce((s, r) => s + r.revenue, 0);
  const unmappedRevenue = revenueRows.find((r) => r.department === UNMAPPED)?.revenue ?? 0;
  const totalRedemptions = redemptionRows.reduce((s, r) => s + r.redemptions, 0);

  const visibleDepartments = departmentFilter === 'All' ? departmentsPresent : departmentsPresent.filter((d) => d === departmentFilter);

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold text-zinc-900">Patient Matrix — Department Analytics Report</h1>
        <p className="text-xs text-zinc-500">Generated {new Date().toLocaleString('en-GB')}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 print:hidden">Department Analytics</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Showing {periodLabel}, compared with the equivalent prior period. Data as of {asOfISO}. Revenue is
            attributed by each line item's mapped department (Data tab → Departments); an unmapped package with
            known benefits splits proportionally across the departments those benefits belong to.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <PeriodPresetSelect preset={preset} onPresetChange={setPreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
          </div>
          <button
            onClick={() => window.print()}
            className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Export / Print Dashboard
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Total Revenue"
          value={formatCurrencyCompact(totalRevenue)}
          hint={formatCurrency(totalRevenue)}
          help="Sum of every department's revenue this period, including Unmapped."
        />
        <KpiCard
          label="Unmapped Revenue"
          value={formatCurrencyCompact(unmappedRevenue)}
          hint={totalRevenue > 0 ? `${formatPercent((unmappedRevenue / totalRevenue) * 100, 1)} of total` : undefined}
          help='Revenue from line items with no department resolved - an unmapped service/product, or an unmapped package with no matching Package Benefits data. Map more services on the Data tab to shrink this.'
          tone={unmappedRevenue > 0 ? 'bad' : 'neutral'}
        />
        <KpiCard
          label="Package Redemptions"
          value={formatNumber(totalRedemptions)}
          help="Sessions consumed from previously-sold packages this period, across all departments."
        />
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Revenue by Department</h3>
          <button
            onClick={() => downloadCsv(buildDepartmentRevenueCsv(revenueRows, periodLabel), `department-revenue-${range.start}-to-${range.end}.csv`)}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export CSV
          </button>
        </div>
        {revenueRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No revenue in this period.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1.5 pr-2">Department</th>
                <th className="py-1.5 pr-2 text-right">Revenue</th>
                <th className="py-1.5 pr-2 text-right">vs. Prior Period</th>
                <th className="py-1.5 pr-2 text-right">Transactions</th>
                <th className="py-1.5 pr-2 text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {revenueRows.map((r) => {
                const change = r.previousRevenue > 0 ? ((r.revenue - r.previousRevenue) / r.previousRevenue) * 100 : null;
                const share = totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : null;
                return (
                  <tr key={r.department} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className={`py-1.5 pr-2 font-medium ${r.department === UNMAPPED ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                      {r.department}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatCurrency(r.revenue)}</td>
                    <td className={`py-1.5 pr-2 text-right ${change != null && change < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                      {change != null ? formatPercent(change, 1) : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatNumber(r.transactions)}</td>
                    <td className="py-1.5 pr-2 text-right text-zinc-500 dark:text-zinc-400">{share != null ? formatPercent(share, 1) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Department:</span>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value as 'All' | DepartmentOrUnmapped)}
          className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="All">All</option>
          {departmentsPresent.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-400">Filters the provider and package redemption breakdowns below.</span>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Provider Contribution by Department</h3>
            <InfoTooltip text="Each provider's share of revenue within a department this period, folded through Provider Groups (Data tab → Master Control) so an assisting nurse's lines count under the doctor they assist." />
          </div>
          <button
            onClick={() => downloadCsv(buildDepartmentProviderCsv(providerRows), `department-provider-contribution-${range.start}-to-${range.end}.csv`)}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export CSV
          </button>
        </div>
        {visibleDepartments.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No data in this period.</p>
        ) : (
          visibleDepartments.map((dept) => {
            const rows: DepartmentProviderRow[] = providerRowsByDept.get(dept) ?? [];
            const deptTotal = rows.reduce((s, r) => s + r.revenue, 0);
            return (
              <div key={dept} className="mb-4 last:mb-0">
                <h4 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${dept === UNMAPPED ? 'text-rose-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {dept}
                </h4>
                {rows.length === 0 ? (
                  <p className="py-1 text-xs text-zinc-400">No providers.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-zinc-400">
                      <tr>
                        <th className="py-1 pr-2">Provider</th>
                        <th className="py-1 pr-2 text-right">Revenue</th>
                        <th className="py-1 pr-2 text-right">Transactions</th>
                        <th className="py-1 pr-2 text-right">Share of Dept.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rows]
                        .sort((a, b) => b.revenue - a.revenue)
                        .map((r) => (
                          <tr key={r.provider} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1 pr-2">{r.provider}</td>
                            <td className="py-1 pr-2 text-right">{formatCurrency(r.revenue)}</td>
                            <td className="py-1 pr-2 text-right">{formatNumber(r.transactions)}</td>
                            <td className="py-1 pr-2 text-right text-zinc-500 dark:text-zinc-400">
                              {deptTotal > 0 ? formatPercent((r.revenue / deptTotal) * 100, 1) : '—'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Packages Redeemed by Department</h3>
            <InfoTooltip text="Sessions consumed from a previously-sold package this period, attributed to the department of the service actually performed (not the department the package was originally sold under)." />
          </div>
          <button
            onClick={() => downloadCsv(buildDepartmentRedemptionsCsv(redemptionRows), `department-redemptions-${range.start}-to-${range.end}.csv`)}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export CSV
          </button>
        </div>
        {visibleDepartments.every((d) => (redemptionRowsByDept.get(d) ?? []).length === 0) ? (
          <p className="py-6 text-center text-sm text-zinc-500">No package redemptions in this period.</p>
        ) : (
          visibleDepartments.map((dept) => {
            const rows: DepartmentRedemptionRow[] = redemptionRowsByDept.get(dept) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={dept} className="mb-4 last:mb-0">
                <h4 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${dept === UNMAPPED ? 'text-rose-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {dept}
                </h4>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-zinc-400">
                    <tr>
                      <th className="py-1 pr-2">Provider</th>
                      <th className="py-1 pr-2 text-right">Redemptions</th>
                      <th className="py-1 pr-2 text-right">Redeemed Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows]
                      .sort((a, b) => b.redeemedValue - a.redeemedValue)
                      .map((r) => (
                        <tr key={r.provider} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-2">{r.provider}</td>
                          <td className="py-1 pr-2 text-right">{formatNumber(r.redemptions)}</td>
                          <td className="py-1 pr-2 text-right">{formatCurrency(r.redeemedValue)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Patient Activity by Department</h3>
          <button
            onClick={() => downloadCsv(buildDepartmentPatientActivityCsv(patientRows), `department-patient-activity-${range.start}-to-${range.end}.csv`)}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export CSV
          </button>
        </div>
        {patientRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No patient activity in this period.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1.5 pr-2">Department</th>
                <th className="py-1.5 pr-2 text-right">Active Patients</th>
                <th className="py-1.5 pr-2 text-right">New Patients</th>
                <th className="py-1.5 pr-2 text-right">Returning Patients</th>
              </tr>
            </thead>
            <tbody>
              {patientRows.map((r) => (
                <tr key={r.department} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className={`py-1.5 pr-2 font-medium ${r.department === UNMAPPED ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                    {r.department}
                  </td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(r.activePatients)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(r.newPatients)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(r.returningPatients)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
