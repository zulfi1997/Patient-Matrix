import { useMemo, useState } from 'react';
import type { SaleRecord } from '../types';
import type { ProviderAssignmentOverride, ProviderGroup } from '../lib/conversionMetrics';
import { computeProviderHandover, listProviders, type HandoverOutcome, type HandoverSummary } from '../lib/providerHandover';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';

const OUTCOME_LABELS: Record<HandoverOutcome, string> = {
  retained: 'Stayed with successor',
  movedToOther: 'Went to another provider',
  notSeenSince: 'Not seen since',
};

const OUTCOME_TONE: Record<HandoverOutcome, string> = {
  retained: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  movedToOther: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  notSeenSince: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

const LOOKBACK_OPTIONS = [
  { value: 0, label: 'All time' },
  { value: 180, label: 'Last 6 months' },
  { value: 365, label: 'Last 12 months' },
  { value: 730, label: 'Last 24 months' },
];

function exportCsv(summary: HandoverSummary) {
  const header = [
    'Patient ID', 'Patient', 'Outcome', 'Last Visit With ' + summary.outgoing, 'Visits With ' + summary.outgoing,
    'Value With ' + summary.outgoing + ' (OMR)', 'First Visit With ' + summary.incoming, 'Visits Since Handover',
    'Value Since Handover (OMR)', 'Seen By Since Handover', 'Days Since Last Visit',
  ];
  const lines = summary.patients.map((p) =>
    [
      p.patientId, p.patientName, OUTCOME_LABELS[p.outcome], p.lastVisitWithOutgoing, p.visitsWithOutgoing,
      p.valueWithOutgoing.toFixed(3), p.firstVisitWithIncoming ?? '', p.visitsSinceHandover,
      p.valueSinceHandover.toFixed(3), p.seenBy.join('; '), p.daysSinceLastVisit,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `handover-${summary.outgoing}-to-${summary.incoming}-${summary.handoverDate}.csv`.replace(/\s+/g, '-');
  a.click();
  URL.revokeObjectURL(url);
}

export function ProviderHandoverPanel({
  records,
  asOfISO,
  providerGroups,
  providerAssignmentOverrides,
}: {
  records: SaleRecord[];
  asOfISO: string;
  providerGroups: ProviderGroup[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
}) {
  const providers = useMemo(
    () => listProviders(records, providerGroups, providerAssignmentOverrides),
    [records, providerGroups, providerAssignmentOverrides],
  );

  const [outgoing, setOutgoing] = useLocalStorageState('pm-handover-outgoing', '');
  const [incoming, setIncoming] = useLocalStorageState('pm-handover-incoming', '');
  const [handoverDate, setHandoverDate] = useLocalStorageState('pm-handover-date', '');
  const [lookbackDays, setLookbackDays] = useLocalStorageState('pm-handover-lookback', 365);
  const [outcomeFilter, setOutcomeFilter] = useState<HandoverOutcome | 'all'>('all');

  const ready = !!outgoing && !!incoming && !!handoverDate && outgoing !== incoming;

  const summary = useMemo(
    () =>
      ready
        ? computeProviderHandover(records, {
            outgoing, incoming, handoverDate, asOfISO, lookbackDays,
            providerGroups, overrides: providerAssignmentOverrides,
          })
        : null,
    [ready, records, outgoing, incoming, handoverDate, asOfISO, lookbackDays, providerGroups, providerAssignmentOverrides],
  );

  const visible = summary
    ? summary.patients.filter((p) => outcomeFilter === 'all' || p.outcome === outcomeFilter)
    : [];

  const share = (n: number) => (summary && summary.inherited.valueWithOutgoing > 0 ? (n / summary.inherited.valueWithOutgoing) * 100 : null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Provider Handover</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          When one provider replaces another, what happened to the patients they inherited. A patient still visiting
          but seeing someone else hasn't been lost so much as redistributed - a different problem from one who hasn't
          come back at all, so the two are counted separately. Assisting staff are folded into whichever doctor they
          assisted on the day, per your Provider Groups.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Provider who left
          <select
            value={outgoing}
            onChange={(e) => setOutgoing(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">Select…</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Replaced by
          <select
            value={incoming}
            onChange={(e) => setIncoming(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">Select…</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Handover date
          <input
            type="date"
            value={handoverDate}
            onChange={(e) => setHandoverDate(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Book defined by
          <select
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {LOOKBACK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {summary && summary.inherited.patients > 0 && (
          <button
            onClick={() => exportCsv(summary)}
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Export CSV
          </button>
        )}
      </div>

      {!ready ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {outgoing && outgoing === incoming
            ? 'Pick two different providers.'
            : 'Pick the provider who left, who replaced them, and the handover date.'}
        </p>
      ) : summary && summary.inherited.patients === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          No patients seen by <strong>{outgoing}</strong>
          {summary.bookFrom ? ` between ${formatDate(summary.bookFrom)} and ${formatDate(handoverDate)}` : ` on or before ${formatDate(handoverDate)}`}.
          Try widening "Book defined by", or check the handover date.
        </p>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label="Patients Inherited"
              value={formatNumber(summary.inherited.patients)}
              hint={`${formatCurrency(summary.inherited.valueWithOutgoing)} of business with ${summary.outgoing}`}
              help={`Distinct patients ${summary.outgoing} saw${summary.bookFrom ? ` from ${formatDate(summary.bookFrom)}` : ''} up to the handover date. This is the book that changed hands.`}
            />
            <KpiCard
              label="Retention Rate"
              value={formatPercent(summary.retentionRate)}
              hint={`${formatNumber(summary.retained.patients)} of ${formatNumber(summary.inherited.patients)} came back to ${summary.incoming}`}
              help="Share of the inherited patients who have since had at least one visit with the successor."
              tone={summary.retentionRate != null && summary.retentionRate < 50 ? 'bad' : 'good'}
            />
            <KpiCard
              label="Went Elsewhere"
              value={formatNumber(summary.movedToOther.patients)}
              hint={`${formatCurrency(summary.movedToOther.valueWithOutgoing)} of the book, still visiting the clinic`}
              help="Inherited patients who have visited since the handover but have not seen the successor. Still customers - just not theirs."
            />
            <KpiCard
              label="Not Seen Since"
              value={formatNumber(summary.notSeenSince.patients)}
              hint={`${formatCurrency(summary.notSeenSince.valueWithOutgoing)} of the book, no visit at all`}
              help="Inherited patients with no visit anywhere in the clinic since the handover date."
              tone="bad"
            />
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-zinc-600 dark:text-zinc-300">
              Of {formatCurrency(summary.inherited.valueWithOutgoing)} of business {summary.outgoing} was handling,{' '}
              <strong>{formatPercent(share(summary.retained.valueWithOutgoing))}</strong> by value stayed with{' '}
              {summary.incoming}, <strong>{formatPercent(share(summary.movedToOther.valueWithOutgoing))}</strong> moved
              to other providers, and <strong>{formatPercent(share(summary.notSeenSince.valueWithOutgoing))}</strong>{' '}
              has not returned. Those retained patients have delivered{' '}
              <strong>{formatCurrency(summary.valueRecovered)}</strong> since.
            </p>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
              Value share is worth reading alongside the headcount: losing a few high-value patients can matter more
              than losing many small ones.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                Inherited Patients ({formatNumber(visible.length)})
              </h4>
              <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs print:hidden dark:border-zinc-700">
                {(['all', 'notSeenSince', 'movedToOther', 'retained'] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOutcomeFilter(o)}
                    className={`px-2.5 py-1 ${outcomeFilter === o ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
                  >
                    {o === 'all' ? 'All' : OUTCOME_LABELS[o]}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pr-2">Patient</th>
                    <th className="py-2 pr-2">Outcome</th>
                    <th className="py-2 pr-2 text-right">Last With {summary.outgoing}</th>
                    <th className="py-2 pr-2 text-right">Value With {summary.outgoing}</th>
                    <th className="py-2 pr-2">Since Handover</th>
                    <th className="py-2 pr-2 text-right">Days Away</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.patientId} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-2">
                        {p.patientName}
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{p.patientId}</div>
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_TONE[p.outcome]}`}>
                          {OUTCOME_LABELS[p.outcome]}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                        {formatDate(p.lastVisitWithOutgoing)}
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatNumber(p.visitsWithOutgoing)} visit{p.visitsWithOutgoing === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium">{formatCurrency(p.valueWithOutgoing)}</td>
                      <td className="py-1.5 pr-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {p.outcome === 'retained'
                          ? `Returned ${formatDate(p.firstVisitWithIncoming!)} · ${formatCurrency(p.valueSinceHandover)}`
                          : p.outcome === 'movedToOther'
                            ? `${p.seenBy.join(', ')} · ${formatCurrency(p.valueSinceHandover)}`
                            : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{formatNumber(p.daysSinceLastVisit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
