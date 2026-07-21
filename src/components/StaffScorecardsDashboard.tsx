import { useCallback, useMemo, useRef, useState } from 'react';
import type { SaleRecord, StaffScorecard, StaffScorecardKpi } from '../types';
import type { PatientVisitSummary } from '../lib/metrics';
import { findKpiDefinition, parseTarget, type KpiComputation } from '../lib/kpiRegistry';
import { formatCurrency, formatMonthLabel, formatNumber, formatPercent, formatDate } from '../lib/format';

const STATUS_STYLE: Record<'meets' | 'below' | 'unknown', string> = {
  meets: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  below: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  unknown: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const STATUS_LABEL: Record<'meets' | 'below' | 'unknown', string> = {
  meets: 'On track',
  below: 'Below target',
  unknown: 'No target range detected',
};

function formatByUnit(value: number, unit: 'currency' | 'percent' | 'count'): string {
  if (unit === 'currency') return formatCurrency(value);
  if (unit === 'percent') return formatPercent(value, 1);
  return formatNumber(Math.round(value));
}

function formatComputed(computation: KpiComputation): string {
  return formatByUnit(computation.actual, computation.unit);
}

interface ComputedKpi {
  kpi: StaffScorecardKpi;
  computation: KpiComputation | null;
}

function downloadScorecardCsv(scorecard: StaffScorecard, computed: ComputedKpi[], monthLabel: string) {
  const header = ['Category', 'KPI', 'Target', 'Actual', 'Period', 'Status'];
  const lines = computed.map(({ kpi, computation }) =>
    [
      kpi.category,
      kpi.metric,
      kpi.target,
      computation ? formatComputed(computation) : 'Not tracked in this dashboard',
      computation?.periodLabel ?? '',
      computation ? STATUS_LABEL[computation.status] : 'Manual tracking needed',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${scorecard.employeeName.replace(/\s+/g, '-')}-scorecard-${monthLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function KpiRow({ kpi, computation }: { kpi: StaffScorecardKpi; computation: KpiComputation | null }) {
  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800">
      <td className="py-1.5 pr-2 font-medium">{kpi.metric}</td>
      <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{kpi.target}</td>
      <td className="py-1.5 pr-2 text-right">
        {computation ? (
          <>
            {formatComputed(computation)}
            <div className="text-xs text-zinc-400">{computation.periodLabel}</div>
            {computation.breakdown && (
              <div className="mt-0.5 text-xs text-zinc-400">
                {computation.breakdown.map((b, i) => (
                  <span key={b.label}>
                    {i > 0 && ' · '}
                    {b.label}: {formatByUnit(b.value, b.unit)}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <span className="text-xs text-zinc-400">not tracked in this dashboard</span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right">
        {computation ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[computation.status]}`}>
            {STATUS_LABEL[computation.status]}
          </span>
        ) : (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Manual tracking needed
          </span>
        )}
      </td>
    </tr>
  );
}

function ScorecardCard({
  scorecard,
  records,
  patients,
  asOfISO,
  monthLabel,
  onRemove,
}: {
  scorecard: StaffScorecard;
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
  asOfISO: string;
  monthLabel: string;
  onRemove: (id: string) => void;
}) {
  const computedKpis = useMemo<ComputedKpi[]>(
    () =>
      scorecard.kpis.map((kpi) => {
        const definition = findKpiDefinition(kpi.metric);
        const target = parseTarget(kpi.target);
        return { kpi, computation: definition ? definition.compute(records, patients, target, asOfISO) : null };
      }),
    [scorecard.kpis, records, patients, asOfISO],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ComputedKpi[]>();
    for (const row of computedKpis) {
      const list = map.get(row.kpi.category);
      if (list) list.push(row);
      else map.set(row.kpi.category, [row]);
    }
    return [...map.entries()];
  }, [computedKpis]);

  const computableCount = computedKpis.filter((r) => r.computation).length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{scorecard.employeeName}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{scorecard.roleTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">
            {formatNumber(computableCount)} of {formatNumber(scorecard.kpis.length)} KPIs auto-tracked
          </span>
          <button
            onClick={() => downloadScorecardCsv(scorecard, computedKpis, monthLabel)}
            className="rounded-lg border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export CSV
          </button>
          <button
            onClick={() => onRemove(scorecard.id)}
            className="rounded-lg border border-zinc-300 px-2 py-0.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-zinc-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            Remove
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-zinc-400">
        From {scorecard.fileName}, uploaded {formatDate(scorecard.uploadedAt.slice(0, 10))}. Auto-tracked KPIs are
        measured against overall clinic performance, not attributed to this person individually.
      </p>

      {grouped.map(([category, rows]) => (
        <div key={category} className="mb-4 last:mb-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{category}</h4>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-400">
                <tr>
                  <th className="py-1 pr-2">KPI</th>
                  <th className="py-1 pr-2">Target</th>
                  <th className="py-1 pr-2 text-right">Actual</th>
                  <th className="py-1 pr-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <KpiRow key={i} kpi={row.kpi} computation={row.computation} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StaffScorecardsDashboard({
  records,
  patients,
  scorecards,
  importOfferLetter,
  removeScorecard,
}: {
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
  scorecards: StaffScorecard[];
  importOfferLetter: (file: File) => Promise<StaffScorecard>;
  removeScorecard: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const latestDataMonth = useMemo(() => {
    if (records.length === 0) return new Date().toISOString().slice(0, 7);
    return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date).slice(0, 7);
  }, [records]);

  const [selectedMonth, setSelectedMonth] = useState(latestDataMonth);
  // yyyy-mm-01 is enough for every KPI's date-range math (it only ever reads year/month from this).
  const asOfISO = `${selectedMonth}-01`;

  const availableMonths = useMemo(() => {
    const months = new Set(records.map((r) => r.date.slice(0, 7)));
    months.add(latestDataMonth);
    return [...months].sort().reverse();
  }, [records, latestDataMonth]);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setImporting(true);
      try {
        await importOfferLetter(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : `Failed to import "${file.name}".`);
      } finally {
        setImporting(false);
      }
    },
    [importOfferLetter],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Staff Scorecards</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Upload a staff member's offer letter (.docx) with a Key Performance Indicators section - KPIs that can
            be measured from clinic sales data (revenue, new patients, package sales, retention) are tracked
            automatically against overall clinic performance; anything that needs a CRM, survey, or partnership
            log (leads, NPS, partnerships, compliance, etc.) is shown as needing manual tracking instead of
            guessed at.
          </p>
        </div>
        {scorecards.length > 0 && (
          <label className="flex shrink-0 items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            Month:
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(`${m}-01`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/20' : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
        }`}
      >
        <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Drag &amp; drop an offer letter (.docx) here, or</p>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={importing}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {importing ? 'Importing…' : 'Choose file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {scorecards.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No staff scorecards uploaded yet.</p>
      ) : (
        scorecards.map((s) => (
          <ScorecardCard
            key={s.id}
            scorecard={s}
            records={records}
            patients={patients}
            asOfISO={asOfISO}
            monthLabel={selectedMonth}
            onRemove={removeScorecard}
          />
        ))
      )}
    </div>
  );
}
