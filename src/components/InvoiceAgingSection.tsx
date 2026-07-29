import { useEffect, useMemo, useState } from 'react';
import type { AgingBucket, AgingBucketStat, InvoiceAgingRow } from '../lib/metrics';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';
import { KpiCard } from './KpiCard';

const PAGE_SIZE = 25;

const BUCKET_LABEL: Record<AgingBucket, string> = {
  '0-15': '0-15 days',
  '16-30': '16-30 days',
  '31-60': '31-60 days',
  '60+': '60+ days',
};

const BUCKET_TONE: Record<AgingBucket, string> = {
  '0-15': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  '16-30': 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  '31-60': 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  '60+': 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

function downloadCsv(rows: InvoiceAgingRow[]) {
  const header = ['Invoice No', 'Patient ID', 'Patient Name', 'Sale Date', 'Age (days)', 'Aging Bucket', 'Services', 'Status', 'Due Amount (OMR)', 'Comments'];
  const lines = rows.map((r) =>
    [r.invoiceNo, r.patientId, r.patientName, r.date, r.ageDays, r.agingBucket, r.services.join('; '), r.invoiceStatus, r.dueAmount.toFixed(3), r.notes.join('; ')]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoice-due-aging-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function InvoiceAgingSection({
  rows,
  bucketSummary,
  asOfISO,
}: {
  rows: InvoiceAgingRow[];
  bucketSummary: AgingBucketStat[];
  asOfISO: string;
}) {
  const [search, setSearch] = useState('');
  const [bucketFilter, setBucketFilter] = useState<AgingBucket | 'All'>('All');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const totalDue = useMemo(() => rows.reduce((sum, r) => sum + r.dueAmount, 0), [rows]);
  const oldest = useMemo(() => rows.reduce((max, r) => Math.max(max, r.ageDays), 0), [rows]);
  const overSixty = bucketSummary.find((b) => b.bucket === '60+');

  const filtered = useMemo(() => {
    let result = rows;
    if (bucketFilter !== 'All') result = result.filter((r) => r.agingBucket === bucketFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.patientName.toLowerCase().includes(q) ||
          r.patientId.toLowerCase().includes(q) ||
          r.invoiceNo.toLowerCase().includes(q) ||
          r.services.some((s) => s.toLowerCase().includes(q)) ||
          r.notes.some((n) => n.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [rows, bucketFilter, search]);

  useEffect(() => {
    const expand = () => setVisible(filtered.length);
    const restore = () => setVisible(PAGE_SIZE);
    window.addEventListener('beforeprint', expand);
    window.addEventListener('afterprint', restore);
    return () => {
      window.removeEventListener('beforeprint', expand);
      window.removeEventListener('afterprint', restore);
    };
  }, [filtered.length]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Invoice Due &amp; Aging</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Every invoice across all sales data with an outstanding balance, aged from its Sale Date to {formatDate(asOfISO)}
          - independent of the period selected above, since a due balance doesn't stop being owed just because its sale
          date falls outside that window.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Total Due"
          value={formatCurrency(totalDue)}
          hint={`${formatNumber(rows.length)} invoices`}
          help="Sum of the outstanding (unpaid) balance across every invoice with a due amount, regardless of sale date."
          tone="bad"
        />
        <KpiCard
          label="Oldest Invoice"
          value={`${formatNumber(oldest)} days`}
          help="Age (in days from Sale Date to today) of the single oldest invoice that still has an outstanding balance."
        />
        <KpiCard
          label="60+ Days Due"
          value={formatCurrency(overSixty?.amount ?? 0)}
          hint={`${formatNumber(overSixty?.count ?? 0)} invoices`}
          help="Outstanding balance on invoices aged 60 days or more since their Sale Date."
          tone={overSixty && overSixty.amount > 0 ? 'bad' : 'neutral'}
        />
        <KpiCard
          label="Avg Age"
          value={rows.length === 0 ? '—' : `${formatNumber(Math.round(rows.reduce((s, r) => s + r.ageDays, 0) / rows.length))} days`}
          help="Average age (in days) across every invoice with an outstanding balance."
        />
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {bucketSummary.map((b) => (
            <button
              key={b.bucket}
              onClick={() => setBucketFilter((cur) => (cur === b.bucket ? 'All' : b.bucket))}
              className={`rounded-lg border p-2.5 text-left transition ${
                bucketFilter === b.bucket
                  ? 'border-indigo-400 ring-1 ring-indigo-400'
                  : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
              }`}
            >
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BUCKET_TONE[b.bucket]}`}>
                {BUCKET_LABEL[b.bucket]}
              </span>
              <div className="mt-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{formatCurrency(b.amount)}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{formatNumber(b.count)} invoices</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            Invoices ({formatNumber(filtered.length)})
            {bucketFilter !== 'All' && <span className="ml-2 text-xs font-normal text-zinc-500">filtered: {BUCKET_LABEL[bucketFilter]}</span>}
          </h4>
          <button
            onClick={() => downloadCsv(filtered)}
            disabled={filtered.length === 0}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export CSV
          </button>
        </div>
        <input
          type="text"
          placeholder="Search by invoice, patient, service, or comment…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          className="mb-3 w-full max-w-sm rounded-lg border border-zinc-300 px-3 py-1.5 text-sm print:hidden dark:border-zinc-700 dark:bg-zinc-800"
        />

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">No outstanding invoices{bucketFilter !== 'All' || search ? ' match this filter' : ''}.</p>
        ) : (
          <>
            <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pr-2">Invoice</th>
                    <th className="py-2 pr-2">Patient</th>
                    <th className="py-2 pr-2 text-right">Sale Date</th>
                    <th className="py-2 pr-2 text-right">Age</th>
                    <th className="py-2 pr-2">Services</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2 text-right">Due</th>
                    <th className="py-2 pr-2">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, visible).map((r) => (
                    <tr key={r.invoiceNo} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-2 font-medium">{r.invoiceNo}</td>
                      <td className="py-1.5 pr-2">
                        {r.patientName}
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{r.patientId}</div>
                      </td>
                      <td className="py-1.5 pr-2 text-right">{formatDate(r.date)}</td>
                      <td className="py-1.5 pr-2 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BUCKET_TONE[r.agingBucket]}`}>
                          {formatNumber(r.ageDays)}d
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">{r.services.join(', ')}</td>
                      <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{r.invoiceStatus}</td>
                      <td className="py-1.5 pr-2 text-right font-medium text-rose-600 dark:text-rose-400">
                        {formatCurrency(r.dueAmount)}
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {r.notes.length > 0 ? r.notes.join('; ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible < filtered.length && (
              <button
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                className="mt-3 w-full rounded-lg border border-zinc-300 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Show more ({filtered.length - visible} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
