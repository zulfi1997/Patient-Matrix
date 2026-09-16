import {
  TARGET_STATUS_LABELS,
  type ProviderTargetProgress,
  type TargetStatus,
} from '../lib/providerTargets';
import { formatCurrency, formatCurrencyCompact, formatMonthLabel, formatNumber, formatPercent } from '../lib/format';
import { KpiCard } from './KpiCard';
import { InfoTooltip } from './InfoTooltip';

const STATUS_STYLE: Record<TargetStatus, string> = {
  met: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  ahead: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  behind: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  noTarget: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

/** A filled bar to the target, so a row can be read without doing the division. */
function ProgressBar({ row }: { row: ProviderTargetProgress }) {
  if (row.target <= 0) return <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>;
  const achieved = Math.max(Math.min((row.actual / row.target) * 100, 100), 0);
  const pace = Math.max(Math.min((row.paceTarget / row.target) * 100, 100), 0);
  return (
    <div className="relative h-2 w-full min-w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
      <div
        className={`h-full ${row.status === 'behind' ? 'bg-rose-500' : row.status === 'met' ? 'bg-emerald-500' : 'bg-sky-500'}`}
        style={{ width: `${achieved}%` }}
      />
      {/* Where an even spread would have them today - the line a row is ahead of or behind. */}
      {!row.complete && (
        <div
          className="absolute top-0 h-full w-0.5 bg-zinc-600 dark:bg-zinc-300"
          style={{ left: `${pace}%` }}
          title={`Even pace after ${row.workingDaysElapsed} working days: ${formatCurrency(row.paceTarget)}`}
        />
      )}
    </div>
  );
}


/**
 * The month's target as four headline figures: the goal, what has been earned, whether that is
 * ahead of where it should be by now, and what it takes per working day from here.
 *
 * Deliberately not the same four numbers as the table's first columns. Variance against the full
 * month's target is a useless headline mid-month - everybody is short of a month's target on the
 * 10th - so the comparison shown is against the pace to date, which is the one that can actually
 * be acted on. Once the month closes, pace and target are the same figure and the card says so.
 */
export function TargetKpiCardItems({ progress, scope }: { progress: ProviderTargetProgress; scope: string }) {
  const hasTarget = progress.target > 0;
  const vsPace = progress.actual - progress.paceTarget;
  const paceLabel = progress.complete ? 'vs Target' : 'vs Pace';
  // The month is in the label because these sit beside period-scoped cards on both tabs. Two
  // "Revenue" figures side by side covering different spans is a support question waiting to happen.
  const month = formatMonthLabel(progress.month);

  return (
    <>
      <KpiCard
        label={`Target (${month})`}
        value={hasTarget ? formatCurrencyCompact(progress.target) : '—'}
        hint={hasTarget ? `${formatMonthLabel(progress.month)} · ${formatCurrency(progress.target)}` : 'Set one under Master Control on the Data tab'}
        help={`Revenue target for ${scope} across the whole of ${formatMonthLabel(progress.month)}, whatever period is selected above. Targets are monthly, so a part-month slice would always read as missed.`}
      />
      <KpiCard
        label={`Achieved (${month})`}
        value={formatCurrencyCompact(progress.actual)}
        hint={hasTarget ? `${formatPercent(progress.achievedPct)} of target · ${formatCurrency(progress.actual)}` : formatCurrency(progress.actual)}
        help={`Adjusted net revenue for ${scope} over the whole month - the same figure the Revenue KPI reports, so a Master Control Revenue Adjustment moves it here too.`}
        tone={hasTarget && progress.status === 'met' ? 'good' : 'neutral'}
      />
      <KpiCard
        label={paceLabel}
        value={hasTarget ? `${vsPace >= 0 ? '+' : '−'}${formatCurrencyCompact(Math.abs(vsPace))}` : '—'}
        hint={
          hasTarget
            ? progress.complete
              ? TARGET_STATUS_LABELS[progress.status]
              : `Even pace by now is ${formatCurrency(progress.paceTarget)}`
            : 'No target to compare against'
        }
        help={
          progress.complete
            ? 'The month is over, so this is the final shortfall or surplus against the full target.'
            : 'Measured against an even spread of the target across the month\'s working days, not against the full month. Being short of a whole month\'s target on the 10th is not being behind.'
        }
        tone={hasTarget ? (vsPace >= 0 ? 'good' : 'bad') : 'neutral'}
      />
      <KpiCard
        label="Needed / Working Day"
        value={progress.requiredPerDay === null ? '—' : formatCurrencyCompact(progress.requiredPerDay)}
        hint={
          progress.requiredPerDay === null
            ? progress.complete
              ? 'Month closed'
              : 'No working days left'
            : `${formatCurrency(progress.remaining)} over ${formatNumber(progress.workingDaysRemaining)} working days`
        }
        help="What is left to earn, divided by the working days remaining. Friday and Saturday are excluded, so this is what has to be earned on a day the clinic actually opens - a calendar-day figure would be lower and unreachable."
        tone={progress.requiredPerDay !== null && progress.requiredPerDay > 0 ? 'bad' : 'neutral'}
      />
    </>
  );
}

/** The same four cards in their own row, for a tab with no KPI grid to slot them into. */
export function TargetKpiCards(props: { progress: ProviderTargetProgress; scope: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <TargetKpiCardItems {...props} />
    </div>
  );
}

export function ProviderTargetsTable({
  rows,
  total,
  asOfISO,
}: {
  rows: ProviderTargetProgress[];
  total: ProviderTargetProgress;
  asOfISO: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        No revenue or targets for this month yet. Set targets under Master Control on the Data tab.
      </div>
    );
  }

  const month = total.month;
  const anyTarget = rows.some((r) => r.target > 0);

  const cells = (row: ProviderTargetProgress, isTotal = false) => (
    <>
      <td className={`py-1.5 pr-3 text-right ${isTotal ? 'font-medium' : ''}`}>
        {row.target > 0 ? formatCurrency(row.target) : <span className="text-zinc-400 dark:text-zinc-500">—</span>}
      </td>
      <td className={`py-1.5 pr-3 text-right ${isTotal ? 'font-medium' : ''}`}>{formatCurrency(row.actual)}</td>
      <td
        className={`py-1.5 pr-3 text-right ${
          row.target <= 0
            ? 'text-zinc-400 dark:text-zinc-500'
            : row.variance < 0
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-emerald-600 dark:text-emerald-400'
        }`}
      >
        {row.target > 0 ? formatCurrency(row.variance) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right">{formatPercent(row.achievedPct)}</td>
      <td className="w-32 py-1.5 pr-3">
        <ProgressBar row={row} />
      </td>
      <td className={`py-1.5 pr-3 text-right ${isTotal ? 'font-medium' : ''}`}>
        {row.requiredPerDay === null ? (
          <span className="text-zinc-400 dark:text-zinc-500">—</span>
        ) : (
          formatCurrency(row.requiredPerDay)
        )}
      </td>
      <td className="py-1.5 pr-3 text-right text-zinc-500 dark:text-zinc-400">
        {row.actualPerDay === null ? '—' : formatCurrency(row.actualPerDay)}
      </td>
      <td className="py-1.5 pr-3 text-right text-zinc-500 dark:text-zinc-400">
        {row.projected === null ? '—' : formatCurrency(row.projected)}
      </td>
      <td className="py-1.5 pr-2">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.status]}`}>
          {TARGET_STATUS_LABELS[row.status]}
        </span>
      </td>
    </>
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-1">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Revenue Targets — {formatMonthLabel(month)}
        </h3>
        <InfoTooltip text="Actual is adjusted net revenue for the whole calendar month, the same figure the Revenue KPI and Provider Analytics report, so a Master Control Revenue Adjustment moves it here too. Behind and Ahead are judged against an even daily spread of the target, not against the full month's target, so a provider is not called behind on the 2nd for having earned less than a month's worth." />
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        {total.complete ? (
          <>The month is complete, so these are final. </>
        ) : (
          <>
            Day {formatNumber(total.daysElapsed)} of {formatNumber(total.daysInMonth)}, which is{' '}
            {formatNumber(total.workingDaysElapsed)} of {formatNumber(total.workingDaysInMonth)} working days, with{' '}
            {formatNumber(total.workingDaysRemaining)} to go.{' '}
          </>
        )}
        Every rate here is per working day, Friday and Saturday excluded. Needed / Day divides what is left by the
        working days remaining, so it is what has to be earned on a day the clinic actually opens.
      </p>

      {!anyTarget && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          No targets are set for {formatMonthLabel(month)}. Set them under Master Control on the Data tab, then export the
          settings file so everyone's dashboard shows the same targets.
        </p>
      )}

      <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="py-2 pr-3">Provider</th>
              <th className="py-2 pr-3 text-right">Target</th>
              <th className="py-2 pr-3 text-right">Actual</th>
              <th className="py-2 pr-3 text-right">Variance</th>
              <th className="py-2 pr-3 text-right">% of Target</th>
              <th className="py-2 pr-3">Progress</th>
                    <th className="py-2 pr-3 text-right">Needed / Working Day</th>
              <th className="py-2 pr-3 text-right">Actual / Working Day</th>
              <th className="py-2 pr-3 text-right">Projected</th>
              <th className="py-2 pr-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.provider} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="whitespace-nowrap py-1.5 pr-3 font-medium">{row.provider}</td>
                {cells(row)}
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-300 dark:border-zinc-600">
              <td className="whitespace-nowrap py-1.5 pr-3 font-semibold">All Providers</td>
              {cells(total, true)}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Projected is where the month lands if the current working-day pace holds. The marker on each bar is where an
        even spread across working days would have that provider today. A provider with revenue but no target still appears, since a missing
        target is usually an oversight rather than a decision. Data as of {asOfISO}.
      </p>
    </div>
  );
}
