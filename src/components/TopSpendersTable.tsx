import { useMemo } from 'react';
import {
  SPEND_BASIS_LABELS,
  spendConcentration,
  topSpenders,
  type PatientSpendSummary,
  type SpendBasis,
} from '../lib/patientSpend';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { InfoTooltip } from './InfoTooltip';

const LIMITS = [10, 25, 50, 100] as const;

export function TopSpendersTable({
  summary,
  periodLabel,
  /** Set when the list is already scoped to one provider, which makes the provider column noise. */
  scopedProvider,
}: {
  summary: PatientSpendSummary;
  periodLabel: string;
  scopedProvider?: string;
}) {
  const keyPrefix = scopedProvider ? 'pm-top-spenders-provider' : 'pm-top-spenders';
  const [basis, setBasis] = useLocalStorageState<SpendBasis>(`${keyPrefix}-basis`, 'revenue');
  const [limit, setLimit] = useLocalStorageState<number>(`${keyPrefix}-limit`, 25);

  const rows = useMemo(() => topSpenders(summary, basis, limit), [summary, basis, limit]);
  const share = useMemo(() => spendConcentration(summary, rows, basis), [summary, rows, basis]);

  const copyRows = () => {
    const header = [
      'Patient ID', 'Patient', 'Cash Spent (OMR)', 'Package Delivered (OMR)', 'Total Value (OMR)',
      'Visits', 'Invoices', 'Last Visit', ...(scopedProvider ? [] : ['Top Provider', 'Share of Patient %', 'Providers Seen']),
      'First Visit', 'Lifetime Cash (OMR)',
    ];
    const body = rows.map((p) => [
      p.patientId, p.patientName, p.revenue.toFixed(3), p.redeemed.toFixed(3), p.deliveredValue.toFixed(3),
      p.visits, p.invoices, p.lastVisit,
      ...(scopedProvider ? [] : [p.topProvider, p.topProviderShare.toFixed(1), p.providerCount]),
      p.firstVisit ?? '', p.lifetimeRevenue.toFixed(3),
    ]);
    navigator.clipboard?.writeText([header, ...body].map((r) => r.join('\t')).join('\n')).catch(() => {});
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {scopedProvider ? `Highest Spenders — ${scopedProvider}` : 'Highest Spenders'}
          </h3>
          <InfoTooltip text="Patients ranked by what they spent in the selected period. Cash Spent is new money. Value Delivered adds package sessions consumed, which is the work actually done for them - a patient can be large on one and small on the other, and the two say different things about what to do next." />
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
            {(['revenue', 'deliveredValue'] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBasis(b)}
                className={`px-2.5 py-1 ${basis === b ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
              >
                {SPEND_BASIS_LABELS[b]}
              </button>
            ))}
          </div>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {LIMITS.map((n) => (
              <option key={n} value={n}>Top {n}</option>
            ))}
          </select>
          <button
            onClick={copyRows}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Copy
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        {periodLabel}. {rows.length === 0 ? 'No spend in this period.' : (
          <>
            These {formatNumber(rows.length)} of {formatNumber(summary.totalPatients)} patients account for{' '}
            <span className="font-medium text-zinc-700 dark:text-zinc-200">{formatPercent(share)}</span> of{' '}
            {SPEND_BASIS_LABELS[basis].toLowerCase()} in the period.
          </>
        )}
      </p>

      {rows.length > 0 && (
        <div className="max-h-[32rem] overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Patient</th>
                <th className="py-2 pr-2">ID</th>
                <th className="py-2 pr-2 text-right">Cash</th>
                <th className="py-2 pr-2 text-right">Package Delivered</th>
                <th className="py-2 pr-2 text-right">Total Value</th>
                <th className="py-2 pr-2 text-right">Visits</th>
                {!scopedProvider && <th className="py-2 pr-2">Top Provider</th>}
                <th className="py-2 pr-2 text-right">Last Visit</th>
                <th className="py-2 pr-2 text-right">Lifetime Cash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.patientId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2 text-zinc-400 dark:text-zinc-500">{i + 1}</td>
                  <td className="py-1.5 pr-2 font-medium">{p.patientName}</td>
                  <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{p.patientId}</td>
                  <td className={`py-1.5 pr-2 text-right ${basis === 'revenue' ? 'font-semibold' : ''}`}>
                    {formatCurrency(p.revenue)}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-zinc-500 dark:text-zinc-400">
                    {formatCurrency(p.redeemed)}
                  </td>
                  <td className={`py-1.5 pr-2 text-right ${basis === 'deliveredValue' ? 'font-semibold' : ''}`}>
                    {formatCurrency(p.deliveredValue)}
                  </td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(p.visits)}</td>
                  {!scopedProvider && (
                    <td className="py-1.5 pr-2">
                      <span className="whitespace-nowrap">{p.topProvider}</span>
                      {p.providerCount > 1 && (
                        <span
                          className="ml-1 text-xs text-zinc-400 dark:text-zinc-500"
                          title={`Saw ${p.providerCount} providers this period; ${formatPercent(p.topProviderShare)} of their value went to ${p.topProvider}.`}
                        >
                          +{p.providerCount - 1}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="py-1.5 pr-2 text-right">{formatDate(p.lastVisit)}</td>
                  <td className="py-1.5 pr-2 text-right text-zinc-500 dark:text-zinc-400">
                    {formatCurrency(p.lifetimeRevenue)}
                    {p.firstVisit && (
                      <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500" title={`First visit ${p.firstVisit}`}>
                        since {p.firstVisit.slice(0, 7)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        A provider is credited on value delivered, so whoever worked through a package counts as
        having treated the patient even though the cash was taken when it was sold.
        {!scopedProvider && ' The marker beside a provider name means the patient also saw others that period.'}
        {' '}Lifetime Cash spans all imported data, not the period.
      </p>
    </div>
  );
}
