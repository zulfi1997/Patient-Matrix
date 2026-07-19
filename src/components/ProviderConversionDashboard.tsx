import { useMemo, useState } from 'react';
import type { PackageBenefitRecord, SaleRecord } from '../types';
import {
  buildInvoiceToPatientMap,
  computeConversionTrend,
  computeDailyConversion,
  FOLLOW_UP_REASON_LABELS,
  type ConversionCategory,
  type ProviderGroup,
  type RevenueAdjustment,
} from '../lib/conversionMetrics';
import { summarizePatients } from '../lib/metrics';
import { formatDate, formatNumber, formatPercent, toISODate } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { ConversionTrendChart } from './ConversionTrendChart';

const CATEGORY_LABELS: Record<ConversionCategory, string> = {
  newUnconverted: 'New - Unconverted',
  newConverted: 'New - Converted',
  repeatConverted: 'Repeat - Converted',
  followUp: 'Follow-up / Direct Service',
};

const TREND_DAYS = 30;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function ProviderConversionDashboard({
  records,
  packageBenefits,
  providerGroups,
  revenueAdjustments,
}: {
  records: SaleRecord[];
  packageBenefits: PackageBenefitRecord[];
  providerGroups: ProviderGroup[];
  revenueAdjustments: RevenueAdjustment[];
}) {
  const asOfISO = useMemo(() => {
    if (records.length === 0) return toISODate(new Date());
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
  }, [records]);
  const minDate = useMemo(() => {
    if (records.length === 0) return asOfISO;
    return records.reduce((min, r) => (r.date < min ? r.date : min), records[0].date);
  }, [records, asOfISO]);

  const [date, setDate] = useLocalStorageState('pm-conversion-date', asOfISO);
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const clampedDate = date > asOfISO ? asOfISO : date < minDate ? minDate : date;

  const patients = useMemo(() => summarizePatients(records), [records]);
  const invoiceToPatient = useMemo(() => buildInvoiceToPatientMap(records), [records]);

  const packageBenefitsByDate = useMemo(() => {
    const map = new Map<string, PackageBenefitRecord[]>();
    for (const b of packageBenefits) {
      if (!map.has(b.snapshotDate)) map.set(b.snapshotDate, []);
      map.get(b.snapshotDate)!.push(b);
    }
    return map;
  }, [packageBenefits]);

  const summary = useMemo(
    () =>
      computeDailyConversion(
        records,
        patients,
        clampedDate,
        invoiceToPatient,
        packageBenefitsByDate.get(clampedDate) ?? null,
        providerGroups,
        revenueAdjustments,
      ),
    [records, patients, clampedDate, invoiceToPatient, packageBenefitsByDate, providerGroups, revenueAdjustments],
  );

  const trendDays = useMemo(() => {
    const days: string[] = [];
    let d = addDays(asOfISO, -(TREND_DAYS - 1));
    if (d < minDate) d = minDate;
    while (d <= asOfISO) {
      days.push(d);
      d = addDays(d, 1);
    }
    return days;
  }, [asOfISO, minDate]);

  const trend = useMemo(
    () =>
      computeConversionTrend(
        records,
        patients,
        invoiceToPatient,
        packageBenefitsByDate,
        trendDays,
        providerGroups,
        revenueAdjustments,
      ),
    [records, patients, invoiceToPatient, packageBenefitsByDate, trendDays, providerGroups, revenueAdjustments],
  );

  const staffOptions = useMemo(() => summary.providers.map((p) => p.staff), [summary.providers]);

  const filteredPatientRows = useMemo(
    () =>
      summary.patientRows.filter(
        (r) => (staffFilter === 'all' || r.staff === staffFilter) && (categoryFilter === 'all' || r.category === categoryFilter),
      ),
    [summary.patientRows, staffFilter, categoryFilter],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold text-zinc-900">Patient Matrix — Provider Conversion Report</h1>
        <p className="text-xs text-zinc-500">Generated {new Date().toLocaleString('en-GB')}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 print:hidden">Provider Conversion</h2>
          <p className="max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">
            Per provider, per day: a first-ever visit with revenue that day is <strong>New Converted</strong>, with no
            revenue is <strong>New Unconverted</strong>. A repeat visit with revenue that day is{' '}
            <strong>Repeat Converted</strong>. A repeat visit with no revenue, or any "YB111"-flagged visit, falls
            under <strong>Follow-up/Direct Service</strong> - never counted as a conversion opportunity. Conversion
            Rate = (New Converted + Repeat Converted) / (New Unconverted + New Converted + Repeat Converted).
            Assisting nurses' invoices and manual Revenue corrections can be configured under{' '}
            <strong>Master Control</strong> on the Data tab.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 print:hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Export / Print Dashboard
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => setDate(addDays(clampedDate, -1))}
          disabled={clampedDate <= minDate}
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ← Prev day
        </button>
        <input
          type="date"
          value={clampedDate}
          min={minDate}
          max={asOfISO}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          onClick={() => setDate(addDays(clampedDate, 1))}
          disabled={clampedDate >= asOfISO}
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Next day →
        </button>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{formatDate(clampedDate)}</span>
        <span
          className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${
            summary.hasBalanceSnapshot
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
          }`}
        >
          {summary.hasBalanceSnapshot
            ? 'Package balance snapshot available for this date'
            : 'No package balance snapshot for this date - "Has Package Balance" reason unavailable, those visits show as "Other"'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <KpiCard label="Total Patients" value={formatNumber(summary.overall.total)} />
        <KpiCard label="New Unconverted" value={formatNumber(summary.overall.newUnconverted)} tone="bad" />
        <KpiCard label="New Converted" value={formatNumber(summary.overall.newConverted)} tone="good" />
        <KpiCard label="Repeat Converted" value={formatNumber(summary.overall.repeatConverted)} tone="good" />
        <KpiCard label="Follow-up / Direct Service" value={formatNumber(summary.overall.followUp)} />
        <KpiCard label="Conversion Rate" value={formatPercent(summary.overall.conversionRate, 1)} tone="neutral" />
        <KpiCard label="Revenue" value={formatNumber(summary.overall.revenue)} />
      </div>

      <ConversionTrendChart data={trend} />

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">By Provider / Therapist - {formatDate(clampedDate)}</h3>
        {summary.providers.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No visits recorded for this date.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-2">Provider / Therapist</th>
                  <th className="py-2 pr-2 text-right">New Unconv.</th>
                  <th className="py-2 pr-2 text-right">New Conv.</th>
                  <th className="py-2 pr-2 text-right">Repeat Conv.</th>
                  <th className="py-2 pr-2 text-right">Follow-up</th>
                  <th className="py-2 pr-2 text-right">Total</th>
                  <th className="py-2 pr-2 text-right">Conversion Rate</th>
                  <th className="py-2 pr-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {summary.providers.map((p) => {
                  const reasonBreakdown = (Object.keys(p.followUpByReason) as (keyof typeof p.followUpByReason)[])
                    .filter((r) => p.followUpByReason[r] > 0)
                    .map((r) => `${FOLLOW_UP_REASON_LABELS[r]}: ${p.followUpByReason[r]}`)
                    .join(', ');
                  return (
                    <tr key={p.staff} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-2 font-medium">{p.staff}</td>
                      <td className="py-1.5 pr-2 text-right text-rose-600 dark:text-rose-400">{formatNumber(p.newUnconverted)}</td>
                      <td className="py-1.5 pr-2 text-right text-emerald-600 dark:text-emerald-400">{formatNumber(p.newConverted)}</td>
                      <td className="py-1.5 pr-2 text-right text-emerald-600 dark:text-emerald-400">{formatNumber(p.repeatConverted)}</td>
                      <td className="py-1.5 pr-2 text-right" title={reasonBreakdown || undefined}>
                        {formatNumber(p.followUp)}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium">{formatNumber(p.total)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium">{formatPercent(p.conversionRate, 1)}</td>
                      <td
                        className="py-1.5 pr-2 text-right"
                        title={p.revenueAdjustment !== 0 ? `Includes a Master Control adjustment of ${p.revenueAdjustment > 0 ? '+' : ''}${formatNumber(p.revenueAdjustment)}` : undefined}
                      >
                        {formatNumber(p.revenue)}
                        {p.revenueAdjustment !== 0 && (
                          <span className="ml-1 text-zinc-400">
                            ({p.revenueAdjustment > 0 ? '+' : ''}
                            {formatNumber(p.revenueAdjustment)})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
                  <td className="py-1.5 pr-2">All Providers</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.newUnconverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.newConverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.repeatConverted)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.followUp)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.total)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatPercent(summary.overall.conversionRate, 1)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(summary.overall.revenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Patient Detail - {formatDate(clampedDate)}</h3>
          <div className="flex gap-2 print:hidden">
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="all">All Providers</option>
              {staffOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="all">All Categories</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">Patient</th>
                <th className="py-2 pr-2">Provider</th>
                <th className="py-2 pr-2">Category</th>
                <th className="py-2 pr-2">Reason</th>
                <th className="py-2 pr-2 text-right">Revenue</th>
                <th className="py-2 pr-2">Services</th>
              </tr>
            </thead>
            <tbody>
              {filteredPatientRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-zinc-500">No patients match this filter.</td>
                </tr>
              ) : (
                filteredPatientRows.map((r) => (
                  <tr key={`${r.patientId}-${r.staff}`} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2">{r.patientName}</td>
                    <td className="py-1.5 pr-2">{r.staff}</td>
                    <td className="py-1.5 pr-2">{CATEGORY_LABELS[r.category]}</td>
                    <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">
                      {r.followUpReason ? FOLLOW_UP_REASON_LABELS[r.followUpReason] : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatNumber(r.revenue)}</td>
                    <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{r.services.join(', ')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
