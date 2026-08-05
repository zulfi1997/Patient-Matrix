import { useEffect, useMemo, useState } from 'react';
import type { FlaggedTransaction } from '../lib/metrics';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';

const PAGE_SIZE = 25;

function downloadCsv(rows: FlaggedTransaction[]) {
  const header = ['Patient ID', 'Patient Name', 'Date', 'Service', 'Item Type', 'Staff', 'Raw Staff', 'Invoice No', 'Amount (OMR)', 'Invoice Notes'];
  const lines = rows.map((r) =>
    [r.patientId, r.patientName, r.date, r.serviceName, r.itemType, r.staff, r.rawStaff ?? '', r.invoiceNo, r.amount.toFixed(3), r.notes]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `yb111-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function FlaggedTransactionsTable({ data, periodLabel }: { data: FlaggedTransaction[]; periodLabel: string }) {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter(
      (r) =>
        r.patientName.toLowerCase().includes(q) ||
        r.patientId.toLowerCase().includes(q) ||
        r.serviceName.toLowerCase().includes(q) ||
        r.staff.toLowerCase().includes(q) ||
        (r.rawStaff ?? '').toLowerCase().includes(q) ||
        r.notes.toLowerCase().includes(q),
    );
  }, [data, search]);

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
          "YB111" Transactions ({formatNumber(data.length)})
        </h3>
        <button
          onClick={() => downloadCsv(filtered)}
          disabled={filtered.length === 0}
          className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Export CSV
        </button>
      </div>
      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{periodLabel}, most recent first.</p>
      <input
        type="text"
        placeholder="Search by name, patient ID, service, staff, or note text…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setVisible(PAGE_SIZE);
        }}
        className="mb-3 w-full max-w-sm rounded-lg border border-zinc-300 px-3 py-1.5 text-sm print:hidden dark:border-zinc-700 dark:bg-zinc-800"
      />
      {search.trim() && <p className="mb-2 hidden text-xs text-zinc-500 print:block">Filtered by: "{search.trim()}"</p>}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No flagged transactions match.</p>
      ) : (
        <>
          <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-2">Patient</th>
                  <th className="py-2 pr-2 text-right">Date</th>
                  <th className="py-2 pr-2">Service</th>
                  <th className="py-2 pr-2">Staff</th>
                  <th className="py-2 pr-2 text-right">Amount</th>
                  <th className="py-2 pr-2">Invoice Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, visible).map((r, i) => (
                  <tr key={`${r.invoiceNo}-${r.serviceName}-${i}`} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2">
                      {r.patientName}
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{r.patientId}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatDate(r.date)}</td>
                    <td className="py-1.5 pr-2">{r.serviceName}</td>
                    <td className="py-1.5 pr-2">
                      {r.staff}
                      {r.rawStaff && r.rawStaff !== r.staff && (
                        <span className="ml-1 text-xs text-zinc-400" title="Name on the line, before Provider Groups">
                          (via {r.rawStaff})
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatCurrency(r.amount)}</td>
                    <td className="py-1.5 pr-2 whitespace-pre-line text-xs text-zinc-500 dark:text-zinc-400">{r.notes}</td>
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
