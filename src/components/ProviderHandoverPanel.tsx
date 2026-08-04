import { useMemo, useState } from 'react';
import type { SaleRecord } from '../types';
import type { ProviderAssignmentOverride, ProviderGroup } from '../lib/conversionMetrics';
import {
  computeProviderPatients,
  computeRoleHandover,
  computeRoleRevenueTrend,
  listProviders,
  type PatientOrigin,
  type ProviderPatientOutcome,
  type RoleHandoverSummary,
  type RoleHolder,
  type RoleOutcome,
} from '../lib/providerHandover';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { KpiCard } from './KpiCard';
import { RoleRevenueTrendChart } from './RoleRevenueTrendChart';

const OUTCOME_LABELS: Record<RoleOutcome, string> = {
  stillWithRole: 'Still with the role',
  lostMidChain: 'Lost partway along',
  wentElsewhere: 'Went to another provider',
  notSeenSince: 'Not seen since',
};

const OUTCOME_TONE: Record<RoleOutcome, string> = {
  stillWithRole: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  lostMidChain: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  wentElsewhere: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  notSeenSince: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

const PATIENT_OUTCOME_LABELS: Record<ProviderPatientOutcome, string> = {
  repeat: 'Came back',
  onceThenElsewhere: 'Once, then a colleague',
  onceThenQuiet: 'Once, then nothing',
};

const PATIENT_OUTCOME_TONE: Record<ProviderPatientOutcome, string> = {
  repeat: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  onceThenElsewhere: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  onceThenQuiet: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

const ORIGIN_LABELS: Record<PatientOrigin, string> = {
  inherited: 'Inherited',
  fromElsewhere: 'From elsewhere in the clinic',
  newToClinic: 'New to the clinic',
};

const LOOKBACK_OPTIONS = [
  { value: 180, label: 'Last 6 months' },
  { value: 365, label: 'Last 12 months' },
  { value: 730, label: 'Last 24 months' },
  { value: 0, label: 'All time' },
];

function exportCsv(summary: RoleHandoverSummary) {
  const original = summary.holders[0].provider;
  const header = [
    'Patient ID', 'Patient', 'Outcome', `Last Visit With ${original}`, `Visits With ${original}`,
    `Value Delivered With ${original} (OMR)`, 'Of Which Package Sessions (OMR)', `New Cash With ${original} (OMR)`,
    'Role Holders Seen Since', 'Providers Outside The Role Seen',
    'Visits Since Handover', 'Value Since Handover (OMR)', 'Days Since Last Visit',
  ];
  const lines = summary.patients.map((p) =>
    [
      p.patientId, p.patientName, OUTCOME_LABELS[p.outcome], p.lastVisitWithOriginal, p.visitsWithOriginal,
      p.valueWithOriginal.toFixed(3), p.redeemedWithOriginal.toFixed(3),
      (p.valueWithOriginal - p.redeemedWithOriginal).toFixed(3),
      p.seenWithHolders.join('; '), p.otherProvidersSeen.join('; '),
      p.visitsSinceHandover, p.valueSinceHandover.toFixed(3), p.daysSinceLastVisit,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `role-handover-${original}-${summary.handoverDate}.csv`.replace(/\s+/g, '-');
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

  const [holders, setHolders] = useLocalStorageState<RoleHolder[]>('pm-role-holders', [
    { provider: '', fromDate: '' },
    { provider: '', fromDate: '' },
  ]);
  const [lookbackDays, setLookbackDays] = useLocalStorageState('pm-handover-lookback', 365);
  const [outcomeFilter, setOutcomeFilter] = useState<RoleOutcome | 'all'>('all');
  const [patientOutcomeFilter, setPatientOutcomeFilter] = useState<ProviderPatientOutcome | 'all'>('all');
  const [originFilter, setOriginFilter] = useState<PatientOrigin | 'all'>('all');
  const [pickedProvider, setPickedProvider] = useLocalStorageState('pm-patients-provider', '');
  const [pickedFrom, setPickedFrom] = useLocalStorageState('pm-patients-from', '');

  const complete = holders.filter((h) => h.provider && h.fromDate);
  // The first holder's own start date only bounds the book, so it may be left blank.
  const ready = holders.length >= 2 && holders[0].provider && complete.length >= holders.length - 1 && holders.slice(1).every((h) => h.provider && h.fromDate);

  const summary = useMemo(() => {
    if (!ready) return null;
    const normalized = holders.map((h, i) => ({ provider: h.provider, fromDate: h.fromDate || (i === 0 ? '0000-01-01' : h.fromDate) }));
    return computeRoleHandover(records, {
      holders: normalized, asOfISO, lookbackDays,
      providerGroups, overrides: providerAssignmentOverrides,
    });
  }, [ready, holders, records, asOfISO, lookbackDays, providerGroups, providerAssignmentOverrides]);

  // Everyone the current holder has seen since taking over, inherited or not, tagged by origin so
  // a weak repeat rate can be told apart from a weak handover.
  const currentHolder = summary ? summary.holders[summary.holders.length - 1] : null;
  // Defaults to the role's current holder, but any provider can be examined - retention is worth
  // asking about whether or not that person inherited anything.
  const shownProvider = pickedProvider || currentHolder?.provider || '';
  const shownFrom = pickedFrom || (pickedProvider ? '' : (currentHolder?.fromDate ?? ''));
  const inheritedIds = useMemo(
    () => (summary ? new Set(summary.patients.map((p) => p.patientId)) : undefined),
    [summary],
  );
  const providerPatients = useMemo(() => {
    if (!shownProvider) return null;
    return computeProviderPatients(records, {
      provider: shownProvider,
      fromDate: shownFrom,
      asOfISO,
      inheritedIds,
      providerGroups,
      overrides: providerAssignmentOverrides,
    });
  }, [shownProvider, shownFrom, records, asOfISO, inheritedIds, providerGroups, providerAssignmentOverrides]);

  const visiblePatients = providerPatients
    ? providerPatients.patients.filter(
        (p) =>
          (patientOutcomeFilter === 'all' || p.outcome === patientOutcomeFilter) &&
          (originFilter === 'all' || p.origin === originFilter),
      )
    : [];

  const revenueTrend = useMemo(() => {
    if (!ready) return null;
    const normalized = holders.map((h, i) => ({ provider: h.provider, fromDate: h.fromDate || (i === 0 ? '0000-01-01' : h.fromDate) }));
    return computeRoleRevenueTrend(records, {
      holders: normalized, asOfISO, providerGroups, overrides: providerAssignmentOverrides,
    });
  }, [ready, holders, records, asOfISO, providerGroups, providerAssignmentOverrides]);

  const update = (i: number, patch: Partial<RoleHolder>) =>
    setHolders((prev) => prev.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const visible = summary ? summary.patients.filter((p) => outcomeFilter === 'all' || p.outcome === outcomeFilter) : [];
  const share = (n: number) =>
    summary && summary.inherited.valueWithOriginal > 0 ? (n / summary.inherited.valueWithOriginal) * 100 : null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Provider Handover</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Follows one role through however many changes of hands, and reports what became of the book the first holder
          built. A patient still visiting but seeing someone outside the role hasn't been lost so much as
          redistributed, and one who followed the role for a while before dropping off is different again - so the
          three are counted separately. Assisting staff fold into whichever doctor they assisted on the day, per your
          Provider Groups.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-2">
          {holders.map((h, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <span className="w-28 shrink-0 pb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {i === 0 ? 'Original holder' : i === holders.length - 1 ? 'Current holder' : `Then`}
              </span>
              <select
                value={h.provider}
                onChange={(e) => update(i, { provider: e.target.value })}
                className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="">Select provider…</option>
                {providers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                {i === 0 ? 'Started (optional)' : 'Took over on'}
                <input
                  type="date"
                  value={h.fromDate}
                  onChange={(e) => update(i, { fromDate: e.target.value })}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>
              {holders.length > 2 && (
                <button
                  onClick={() => setHolders((prev) => prev.filter((_, j) => j !== i))}
                  className="pb-1.5 text-xs text-rose-600 hover:underline dark:text-rose-400"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <button
            onClick={() => setHolders((prev) => [...prev, { provider: '', fromDate: '' }])}
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            + Add another holder
          </button>
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
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          "Book defined by" bounds who counts as inherited. All time includes patients who had already stopped
          visiting long before the handover, which charges pre-existing churn to the successor.
        </p>
      </div>

      {!ready ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          Name the original holder, then each person who took over and the date they did.
        </p>
      ) : !summary || summary.inherited.patients === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          No patients seen by <strong>{holders[0].provider}</strong> in the window before{' '}
          {summary ? formatDate(summary.handoverDate) : 'the handover'}. Try widening "Book defined by", or check the
          takeover date.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label="Patients Inherited"
              value={formatNumber(summary.inherited.patients)}
              hint={`${formatCurrency(summary.inherited.valueWithOriginal)} of business with ${summary.holders[0].provider}`}
              help={`Distinct patients ${summary.holders[0].provider} saw${summary.bookFrom ? ` from ${formatDate(summary.bookFrom)}` : ''} up to ${formatDate(summary.handoverDate)}. This is the book that changed hands.`}
            />
            <KpiCard
              label="Still With The Role"
              value={formatPercent(summary.retentionRate)}
              hint={`${formatNumber(summary.stillWithRole.patients)} of ${formatNumber(summary.inherited.patients)} seen by ${summary.holders[summary.holders.length - 1].provider}`}
              help="Share of the inherited book that has visited whoever currently holds the role."
              tone={summary.retentionRate != null && summary.retentionRate < 50 ? 'bad' : 'good'}
            />
            <KpiCard
              label="Lost Partway"
              value={formatNumber(summary.lostMidChain.patients)}
              hint={`${formatCurrency(summary.lostMidChain.valueWithOriginal)} - followed the role, then dropped off`}
              help="Patients who stayed with the role through at least one handover but have not seen the current holder. The role had them and lost them."
            />
            <KpiCard
              label="Not Seen Since"
              value={formatNumber(summary.notSeenSince.patients)}
              hint={`${formatCurrency(summary.notSeenSince.valueWithOriginal)} - no visit anywhere`}
              help="Inherited patients with no visit anywhere in the clinic since the handover. The only group that is a lost customer rather than a reassigned one."
              tone="bad"
            />
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h4 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Where the book thinned</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pr-2">Holder</th>
                    <th className="py-2 pr-2">Tenure</th>
                    <th className="py-2 pr-2 text-right">Of the book, seen</th>
                    <th className="py-2 pr-2 text-right">Share</th>
                    <th className="py-2 pr-2 text-right">Value Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.stages.map((st, i) => (
                    <tr key={`${st.provider}-${st.fromDate}`} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-2 font-medium">
                        {st.provider}
                        {i === 0 && <span className="ml-2 text-xs font-normal text-zinc-500">built the book</span>}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                        {i === 0 ? 'until' : 'from'} {formatDate(i === 0 ? summary.handoverDate : st.fromDate)}
                        {st.untilDate && i > 0 ? ` – ${formatDate(st.untilDate)}` : ''}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{formatNumber(st.patients)}</td>
                      <td className="py-1.5 pr-2 text-right text-zinc-500 dark:text-zinc-400">
                        {formatPercent(summary.inherited.patients > 0 ? (st.patients / summary.inherited.patients) * 100 : null)}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{formatCurrency(st.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Value here is Sales (Exc. Tax) - cash plus the value of package sessions consumed - a wider basis than
              the Dashboard's Revenue KPI, which nets package redemption off. Gift and prepaid card purchases are
              excluded from both. Of this book, {formatCurrency(summary.inherited.redeemedWithOriginal)} was package
              sessions being consumed rather than new cash; on Revenue alone a patient part-way through a prepaid
              package would look worthless to keep.
            </p>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
              Of {formatCurrency(summary.inherited.valueWithOriginal)} of business{' '}
              {summary.holders[0].provider} was handling,{' '}
              <strong>{formatPercent(share(summary.stillWithRole.valueWithOriginal))}</strong> by value is still with
              the role, <strong>{formatPercent(share(summary.lostMidChain.valueWithOriginal))}</strong> followed it
              then dropped off, <strong>{formatPercent(share(summary.wentElsewhere.valueWithOriginal))}</strong> moved
              to providers outside it, and <strong>{formatPercent(share(summary.notSeenSince.valueWithOriginal))}</strong>{' '}
              has not returned at all. Retained patients have delivered{' '}
              <strong>{formatCurrency(summary.valueRecovered)}</strong> since.
            </p>
          </div>

          {revenueTrend && revenueTrend.points.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Revenue through the handovers</h4>
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                Monthly value the role delivered, coloured by who held it. Attribution is by the date of each line, so
                a month containing a handover splits between both rather than being credited to one. A month the role
                earned nothing is shown as zero rather than skipped.
              </p>
              <RoleRevenueTrendChart trend={revenueTrend} />

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th className="py-2 pr-2">Holder</th>
                      <th className="py-2 pr-2">Held</th>
                      <th className="py-2 pr-2 text-right">Patients</th>
                      <th className="py-2 pr-2 text-right">Total Delivered</th>
                      <th className="py-2 pr-2 text-right">Per Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueTrend.byHolder.map((h) => (
                      <tr key={`${h.provider}-${h.fromDate}`} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5 pr-2 font-medium">{h.provider}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                          {formatDate(h.fromDate)} – {h.untilDate ? formatDate(h.untilDate) : 'now'} ·{' '}
                          {formatNumber(h.days)} days
                        </td>
                        <td className="py-1.5 pr-2 text-right">{formatNumber(h.patients)}</td>
                        <td className="py-1.5 pr-2 text-right">{formatCurrency(h.value)}</td>
                        <td className="py-1.5 pr-2 text-right font-medium">
                          {h.valuePerMonth != null ? formatCurrency(h.valuePerMonth) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Compare on <strong>per month</strong>, not the total. Tenures of different lengths make raw totals
                meaningless - which is exactly the situation a recent handover creates, since the newest holder has
                had the least time to accumulate one.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                Inherited Patients ({formatNumber(visible.length)})
              </h4>
              <div className="flex flex-wrap overflow-hidden rounded-lg border border-zinc-300 text-xs print:hidden dark:border-zinc-700">
                {(['all', 'notSeenSince', 'lostMidChain', 'wentElsewhere', 'stillWithRole'] as const).map((o) => (
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
                    <th className="py-2 pr-2 text-right">Last With {summary.holders[0].provider}</th>
                    <th className="py-2 pr-2 text-right">Value Delivered</th>
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
                        {formatDate(p.lastVisitWithOriginal)}
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatNumber(p.visitsWithOriginal)} visit{p.visitsWithOriginal === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium">
                        {formatCurrency(p.valueWithOriginal)}
                        {p.redeemedWithOriginal > 0 && (
                          <div className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                            incl. {formatCurrency(p.redeemedWithOriginal)} via packages
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-xs">
                        {p.seenWithHolders.length === 0 && p.otherProvidersSeen.length === 0 ? (
                          <span className="text-zinc-500 dark:text-zinc-400">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {p.seenWithHolders.length > 0 && (
                              <span className="text-emerald-700 dark:text-emerald-400">
                                In the role: {p.seenWithHolders.join(', ')}
                              </span>
                            )}
                            {p.otherProvidersSeen.length > 0 && (
                              <span className="text-amber-700 dark:text-amber-400">
                                Outside it: {p.otherProvidersSeen.join(', ')}
                              </span>
                            )}
                            <span className="text-zinc-500 dark:text-zinc-400">
                              {formatCurrency(p.valueSinceHandover)} across {formatNumber(p.visitsSinceHandover)} visit
                              {p.visitsSinceHandover === 1 ? '' : 's'}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{formatNumber(p.daysSinceLastVisit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </>
      )}

      {providerPatients && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  Everyone {shownProvider} has seen{shownFrom ? ` since ${formatDate(shownFrom)}` : ' (all time)'}
                </h4>
                <div className="flex flex-wrap items-end gap-2 print:hidden">
                  <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Provider
                    <select
                      value={shownProvider}
                      onChange={(e) => setPickedProvider(e.target.value)}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      {providers.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Seen since (blank = all time)
                    <input
                      type="date"
                      value={shownFrom}
                      onChange={(e) => setPickedFrom(e.target.value)}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                  </label>
                </div>
              </div>
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                {summary
                  ? 'Not only the inherited book. The handover table above counts a patient as kept the moment they appear once, which is the right test for whether the book transferred and the wrong one for whether they are being held onto - a single visit followed by silence looks identical to an established relationship there. Splitting by repeat visit separates the two, and tagging where each patient came from shows whether a weak repeat rate is confined to the inherited book or applies to everyone.'
                  : 'Whether this provider holds onto the patients they see. Seeing someone once is separated from an established relationship, and a single visit is split by what followed: going to a colleague is a fit or scheduling matter inside the clinic, going quiet is a patient lost. Works on its own - no handover needs configuring above.'}
              </p>

              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard
                  label="Patients Seen"
                  value={formatNumber(providerPatients.total.patients)}
                  hint={`${formatCurrency(providerPatients.total.value)} delivered`}
                  help={`Distinct patients ${shownProvider} has seen in this window, from any source.`}
                />
                <KpiCard
                  label="Came Back"
                  value={formatPercent(providerPatients.repeatRate)}
                  hint={`${formatNumber(providerPatients.repeat.patients)} seen more than once`}
                  help="Share who returned for a second visit. The clearest sign a relationship took hold."
                  tone={providerPatients.repeatRate != null && providerPatients.repeatRate < 40 ? 'bad' : 'good'}
                />
                <KpiCard
                  label="Once, Then A Colleague"
                  value={formatNumber(providerPatients.onceThenElsewhere.patients)}
                  hint={`${formatCurrency(providerPatients.onceThenElsewhere.value)} - stayed in the clinic`}
                  help="Seen once, then went to a different provider. A fit or scheduling problem inside the clinic rather than a lost patient."
                />
                <KpiCard
                  label="Once, Then Nothing"
                  value={formatNumber(providerPatients.onceThenQuiet.patients)}
                  hint={`${formatCurrency(providerPatients.onceThenQuiet.value)} - no visit since`}
                  help="Seen once and not seen anywhere in the clinic since. Filter by Inherited below to see which of these came from the previous holder."
                  tone="bad"
                />
              </div>

              <div className="mb-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th className="py-2 pr-2">Where they came from</th>
                      <th className="py-2 pr-2 text-right">Patients</th>
                      <th className="py-2 pr-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary ? (['inherited', 'fromElsewhere', 'newToClinic'] as const) : (['fromElsewhere', 'newToClinic'] as const)).map((o) => (
                      <tr key={o} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5 pr-2">{ORIGIN_LABELS[o]}</td>
                        <td className="py-1.5 pr-2 text-right">{formatNumber(providerPatients.byOrigin[o].patients)}</td>
                        <td className="py-1.5 pr-2 text-right">{formatCurrency(providerPatients.byOrigin[o].value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  Patients ({formatNumber(visiblePatients.length)})
                </h5>
                <div className="flex flex-wrap gap-2 print:hidden">
                  <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
                    {(['all', 'onceThenQuiet', 'onceThenElsewhere', 'repeat'] as const).map((o) => (
                      <button
                        key={o}
                        onClick={() => setPatientOutcomeFilter(o)}
                        className={`px-2.5 py-1 ${patientOutcomeFilter === o ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
                      >
                        {o === 'all' ? 'All' : PATIENT_OUTCOME_LABELS[o]}
                      </button>
                    ))}
                  </div>
                  <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
                    {(summary ? (['all', 'inherited', 'fromElsewhere', 'newToClinic'] as const) : (['all', 'fromElsewhere', 'newToClinic'] as const)).map((o) => (
                      <button
                        key={o}
                        onClick={() => setOriginFilter(o)}
                        className={`px-2.5 py-1 ${originFilter === o ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
                      >
                        {o === 'all' ? 'Any origin' : ORIGIN_LABELS[o]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      <th className="py-2 pr-2">Patient</th>
                      <th className="py-2 pr-2">Outcome</th>
                      <th className="py-2 pr-2">Came From</th>
                      <th className="py-2 pr-2 text-right">Visits</th>
                      <th className="py-2 pr-2 text-right">Last Seen</th>
                      <th className="py-2 pr-2 text-right">Value</th>
                      <th className="py-2 pr-2 text-right">Days Away</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePatients.map((p) => (
                      <tr key={p.patientId} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5 pr-2">
                          {p.patientName}
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">{p.patientId}</div>
                        </td>
                        <td className="py-1.5 pr-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PATIENT_OUTCOME_TONE[p.outcome]}`}>
                            {PATIENT_OUTCOME_LABELS[p.outcome]}
                          </span>
                          {p.seenAfterElsewhere.length > 0 && (
                            <div className="text-xs text-amber-700 dark:text-amber-400">
                              since seen by {p.seenAfterElsewhere.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-zinc-500 dark:text-zinc-400">{ORIGIN_LABELS[p.origin]}</td>
                        <td className="py-1.5 pr-2 text-right">{formatNumber(p.visitsWithProvider)}</td>
                        <td className="py-1.5 pr-2 text-right whitespace-nowrap">{formatDate(p.lastVisitWithProvider)}</td>
                        <td className="py-1.5 pr-2 text-right font-medium">{formatCurrency(p.valueWithProvider)}</td>
                        <td className="py-1.5 pr-2 text-right">{formatNumber(p.daysSinceLastVisit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
    </div>
  );
}
