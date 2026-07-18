import { useMemo, useState } from 'react';
import type { AtRiskPatient } from '../lib/metrics';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';

const PAGE_SIZE = 25;

function downloadCsv(rows: AtRiskPatient[]) {
  const header = ['Patient ID', 'Patient Name', 'Last Visit', 'Days Since Last Visit', 'Lifetime Visits', 'Lifetime Revenue (OMR)'];
  const lines = rows.map((r) =>
    [r.patientId, r.patientName, r.lastVisit, r.daysSinceLastVisit, r.lifetimeVisits, r.lifetimeRevenue.toFixed(3)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patients-stopped-visiting-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AtRiskPatientsTable({ data }: { data: AtRiskPatient[] }) {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter((p) => p.patientName.toLowerCase().includes(q) || p.patientId.toLowerCase().includes(q));
  }, [data, search]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Patients Who Stopped Visiting ({formatNumber(data.length)})
        </h3>
        <button
          onClick={() => downloadCsv(filtered)}
          disabled={filtered.length === 0}
          className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Export CSV
        </button>
      </div>
      <input
        type="text"
        placeholder="Search by name or patient ID…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setVisible(PAGE_SIZE);
        }}
        className="mb-3 mt-2 w-full max-w-xs rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No patients match.</p>
      ) : (
        <>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-2">Patient</th>
                  <th className="py-2 pr-2">ID</th>
                  <th className="py-2 pr-2 text-right">Last Visit</th>
                  <th className="py-2 pr-2 text-right">Days Inactive</th>
                  <th className="py-2 pr-2 text-right">Lifetime Visits</th>
                  <th className="py-2 pr-2 text-right">Lifetime Revenue</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, visible).map((p) => (
                  <tr key={p.patientId} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2">{p.patientName}</td>
                    <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{p.patientId}</td>
                    <td className="py-1.5 pr-2 text-right">{formatDate(p.lastVisit)}</td>
                    <td className="py-1.5 pr-2 text-right font-medium text-rose-600 dark:text-rose-400">
                      {formatNumber(p.daysSinceLastVisit)}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatNumber(p.lifetimeVisits)}</td>
                    <td className="py-1.5 pr-2 text-right">{formatCurrency(p.lifetimeRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible < filtered.length && (
            <button
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="mt-3 w-full rounded-lg border border-zinc-300 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Show more ({filtered.length - visible} remaining)
            </button>
          )}
        </>
      )}
    </div>
  );
}
