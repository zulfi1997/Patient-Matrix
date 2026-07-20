import { useEffect, useMemo, useState } from 'react';
import type { DiscountDetailRow } from '../lib/discounts';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';

const PAGE_SIZE = 25;

const CATEGORY_BADGE: Record<string, string> = {
  manual: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  campaign: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  priceAdjusted: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  other: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

const CATEGORY_LABEL: Record<string, string> = {
  manual: 'Manual',
  campaign: 'Campaign',
  priceAdjusted: 'Adjusted',
  other: 'Other',
};

function downloadCsv(rows: DiscountDetailRow[]) {
  const header = ['Invoice No', 'Date', 'Patient Name', 'Service Name', 'Discount Name', 'Type', 'Price (OMR)', 'Discount (OMR)', 'Net Price (OMR)'];
  const lines = rows.map((r) =>
    [
      r.invoiceNo,
      r.date,
      r.patientName,
      r.serviceName,
      r.discountName ?? '',
      CATEGORY_LABEL[r.category] ?? 'Other',
      r.price.toFixed(3),
      r.discountAmount.toFixed(3),
      r.netPrice.toFixed(3),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `discount-details-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DiscountDetailsTable({ data }: { data: DiscountDetailRow[] }) {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter(
      (r) =>
        r.invoiceNo.toLowerCase().includes(q) ||
        r.patientName.toLowerCase().includes(q) ||
        r.serviceName.toLowerCase().includes(q) ||
        (r.discountName ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  // Printing should include the full (filtered) list, not just the current page.
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
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Discount Details ({formatNumber(data.length)})
        </h3>
        <button
          onClick={() => downloadCsv(filtered)}
          disabled={filtered.length === 0}
          className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Export CSV
        </button>
      </div>
      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        Invoice-level detail for every discounted line item this period. Excludes "Package Redemption" entries (not a
        real discount).
      </p>
      <input
        type="text"
        placeholder="Search by invoice, patient, service, or discount name…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setVisible(PAGE_SIZE);
        }}
        className="mb-3 mt-2 w-full max-w-sm rounded-lg border border-zinc-300 px-3 py-1.5 text-sm print:hidden dark:border-zinc-700 dark:bg-zinc-800"
      />
      {search.trim() && <p className="mb-2 hidden text-xs text-zinc-500 print:block">Filtered by: "{search.trim()}"</p>}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No discounted line items match.</p>
      ) : (
        <>
          <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-2">Invoice No</th>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Patient</th>
                  <th className="py-2 pr-2">Service</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2 text-right">Price</th>
                  <th className="py-2 pr-2 text-right">Discount</th>
                  <th className="py-2 pr-2 text-right">Net Price</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, visible).map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{r.invoiceNo}</td>
                    <td className="py-1.5 pr-2">{formatDate(r.date)}</td>
                    <td className="py-1.5 pr-2">{r.patientName}</td>
                    <td className="py-1.5 pr-2">{r.serviceName}</td>
                    <td className="py-1.5 pr-2">
                      <span
                        title={r.discountName ?? undefined}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_BADGE[r.category] ?? CATEGORY_BADGE.other}`}
                      >
                        {CATEGORY_LABEL[r.category] ?? 'Other'}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatCurrency(r.price)}</td>
                    <td className="py-1.5 pr-2 text-right text-rose-600 dark:text-rose-400">{formatCurrency(r.discountAmount)}</td>
                    <td className="py-1.5 pr-2 text-right font-medium">{formatCurrency(r.netPrice)}</td>
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
  );
}
