import { useCallback, useMemo, useRef, useState } from 'react';
import type { ManualKpiEntry, SaleRecord, StaffScorecard, StaffScorecardKpi } from '../types';
import type { PatientVisitSummary } from '../lib/metrics';
import { findKpiDefinition, parseTarget, statusFor, type KpiComputation, type KpiStatus } from '../lib/kpiRegistry';
import { formatCurrency, formatMonthLabel, formatNumber, formatPercent, formatDate } from '../lib/format';
import { ExportExcelButton } from './ExportExcelButton';
import { staffScorecardSheets, contextSheet } from '../lib/dashboardExports';

const STATUS_STYLE: Record<KpiStatus, string> = {
  meets: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  below: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  unknown: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const STATUS_LABEL: Record<KpiStatus, string> = {
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
  manualEntry: ManualKpiEntry | undefined;
}

function manualStatus(kpi: StaffScorecardKpi, entry: ManualKpiEntry | undefined): KpiStatus | null {
  if (!entry) return null;
  return statusFor(entry.value, parseTarget(kpi.target));
}

function downloadScorecardCsv(scorecard: StaffScorecard, computed: ComputedKpi[], monthLabel: string) {
  const header = ['Category', 'KPI', 'Target', 'Actual', 'Period', 'Status', 'Note'];
  const lines = computed.map(({ kpi, computation, manualEntry }) => {
    if (computation) {
      return [kpi.category, kpi.metric, kpi.target, formatComputed(computation), computation.periodLabel, STATUS_LABEL[computation.status], ''];
    }
    if (manualEntry) {
      const status = manualStatus(kpi, manualEntry);
      return [kpi.category, kpi.metric, kpi.target, String(manualEntry.value), 'manually logged', status ? STATUS_LABEL[status] : '', manualEntry.note ?? ''];
    }
    return [kpi.category, kpi.metric, kpi.target, 'Not tracked in this dashboard', '', 'Manual tracking needed', ''];
  }).map((cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${scorecard.employeeName.replace(/\s+/g, '-')}-scorecard-${monthLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ManualEntryInput({ entry, onSave }: { entry: ManualKpiEntry | undefined; onSave: (value: number, note: string | null) => void }) {
  const [value, setValue] = useState(entry?.value != null ? String(entry.value) : '');
  const [note, setNote] = useState(entry?.note ?? '');

  const commit = () => {
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isFinite(parsed)) {
      onSave(parsed, note.trim() || null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        placeholder="Enter value"
        className="w-28 rounded-lg border border-zinc-300 px-2 py-1 text-right text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={commit}
        placeholder="Note (optional)"
        className="w-40 rounded-lg border border-zinc-300 px-2 py-0.5 text-right text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
      />
    </div>
  );
}

function KpiRow({
  kpi,
  computation,
  manualEntry,
  onSaveManual,
}: {
  kpi: StaffScorecardKpi;
  computation: KpiComputation | null;
  manualEntry: ManualKpiEntry | undefined;
  onSaveManual: (value: number, note: string | null) => void;
}) {
  const status = computation ? computation.status : manualStatus(kpi, manualEntry);

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
          <ManualEntryInput entry={manualEntry} onSave={onSaveManual} />
        )}
      </td>
      <td className="py-1.5 pr-2 text-right">
        {status ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
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
  manualEntries,
  asOfISO,
  monthLabel,
  onRemove,
  onSaveManual,
}: {
  scorecard: StaffScorecard;
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
  manualEntries: ManualKpiEntry[];
  asOfISO: string;
  monthLabel: string;
  onRemove: (id: string) => void;
  onSaveManual: (metric: string, value: number, note: string | null) => void;
}) {
  const manualByMetric = useMemo(() => new Map(manualEntries.map((e) => [e.metric, e])), [manualEntries]);

  const computedKpis = useMemo<ComputedKpi[]>(
    () =>
      scorecard.kpis.map((kpi) => {
        const definition = findKpiDefinition(kpi.metric);
        const target = parseTarget(kpi.target);
        return {
          kpi,
          computation: definition ? definition.compute(records, patients, target, asOfISO) : null,
          manualEntry: manualByMetric.get(kpi.metric),
        };
      }),
    [scorecard.kpis, records, patients, asOfISO, manualByMetric],
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

  const trackedCount = computedKpis.filter((r) => r.computation || r.manualEntry).length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{scorecard.employeeName}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{scorecard.roleTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">
            {formatNumber(trackedCount)} of {formatNumber(scorecard.kpis.length)} KPIs tracked
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
        measured against overall clinic performance, not attributed to this person individually. KPIs with no
        auto-tracking can be logged manually below - values are saved per month.
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
                  <KpiRow
                    key={i}
                    kpi={row.kpi}
                    computation={row.computation}
                    manualEntry={row.manualEntry}
                    onSaveManual={(value, note) => onSaveManual(row.kpi.metric, value, note)}
                  />
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
  manualEntries,
  importOfferLetter,
  removeScorecard,
  setManualKpiValue,
}: {
  records: SaleRecord[];
  patients: Map<string, PatientVisitSummary>;
  scorecards: StaffScorecard[];
  manualEntries: ManualKpiEntry[];
  importOfferLetter: (file: File) => Promise<StaffScorecard>;
  removeScorecard: (id: string) => Promise<void>;
  setManualKpiValue: (scorecardId: string, metric: string, month: string, value: number, note: string | null) => Promise<void>;
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
            automatically against overall clinic performance; anything else (leads, NPS, partnerships, compliance,
            etc.) can be logged manually per month, right on that KPI's row.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
        <ExportExcelButton
          fileName={`staff-scorecards-${selectedMonth || 'all'}.xlsx`}
          disabled={scorecards.length === 0}
          buildSheets={() => [
            contextSheet([
              ['Report', 'Staff Scorecards'],
              ['Month', selectedMonth || '(none selected)'],
              ['Source', 'KPIs parsed from each uploaded offer letter (.docx).'],
              ['Scope', 'The scorecards themselves and their KPI definitions. Measured values are computed against clinic performance on screen.'],
            ]),
            ...staffScorecardSheets(scorecards),
          ]}
        />
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
        <p className="mt-3 text-xs text-zinc-400">
          Writing a new offer letter?{' '}
          <a
            href={`${import.meta.env.BASE_URL}offer-letter-kpi-template.docx`}
            download
            className="font-medium text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400"
          >
            Download the KPI template (.docx)
          </a>{' '}
          - it keeps the section/table structure this importer expects, so you only need to fill in the names and targets.
        </p>
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
            manualEntries={manualEntries.filter((e) => e.scorecardId === s.id && e.month === selectedMonth)}
            asOfISO={asOfISO}
            monthLabel={selectedMonth}
            onRemove={removeScorecard}
            onSaveManual={(metric, value, note) => setManualKpiValue(s.id, metric, selectedMonth, value, note)}
          />
        ))
      )}
    </div>
  );
}
