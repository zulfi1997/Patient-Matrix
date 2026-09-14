import { useMemo } from 'react';
import {
  COHORT_BASIS_LABELS,
  averageByAge,
  cellValue,
  cohortTotal,
  cumulativeValues,
  type CohortAnalysis,
  type CohortBasis,
  type PatientCohort,
} from '../lib/patientCohorts';
import { formatCurrency, formatMonthLabel, formatNumber } from '../lib/format';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { InfoTooltip } from './InfoTooltip';

type Measure = 'total' | 'perPatient' | 'patients';

const MEASURE_LABELS: Record<Measure, string> = {
  total: 'Total',
  perPatient: 'Per Patient',
  patients: 'Active Patients',
};

function Segmented<T extends string>({
  value, options, labels, onChange, label,
}: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`px-2.5 py-1 ${
              value === option
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Values a cohort row shows across its age columns, already shaped by the chosen controls. */
function rowValues(cohort: PatientCohort, basis: CohortBasis, measure: Measure, cumulative: boolean): (number | null)[] {
  if (measure === 'patients') return cohort.cells.map((c) => c.activePatients);
  const base = cumulative ? cumulativeValues(cohort, basis) : cohort.cells.map((c) => cellValue(c, basis));
  if (measure !== 'perPatient') return base;
  return base.map((v) => (cohort.patients > 0 ? v / cohort.patients : null));
}

export function PatientCohortTable({ analysis, basis, onBasisChange }: {
  analysis: CohortAnalysis;
  /** Owned by the parent so the age-curve card below reads the same basis as the triangle. */
  basis: CohortBasis;
  onBasisChange: (basis: CohortBasis) => void;
}) {
  const [measure, setMeasure] = useLocalStorageState<Measure>('pm-cohort-measure', 'total');
  const [cumulative, setCumulative] = useLocalStorageState<boolean>('pm-cohort-cumulative', true);

  // Active patients is a count of people, not a running sum of money: adding March's visitors to
  // April's would double-count anyone who came in both months.
  const cumulativeApplies = measure !== 'patients';
  const showCumulative = cumulative && cumulativeApplies;

  const ages = useMemo(
    () => Array.from({ length: analysis.maxMonthIndex + 1 }, (_, i) => i),
    [analysis.maxMonthIndex],
  );

  const rows = useMemo(
    () => analysis.cohorts.map((cohort) => ({ cohort, values: rowValues(cohort, basis, measure, showCumulative) })),
    [analysis.cohorts, basis, measure, showCumulative],
  );

  // Shading is scaled to the largest cell on screen, so the eye can find the strong months without
  // reading every number. Recomputed per view, since cumulative values are far larger than monthly.
  const peak = useMemo(() => {
    let max = 0;
    for (const { values } of rows) {
      for (const v of values) if (v !== null && Math.abs(v) > max) max = Math.abs(v);
    }
    return max;
  }, [rows]);

  const format = (value: number | null) => {
    if (value === null) return '—';
    if (measure === 'patients') return formatNumber(value);
    return formatCurrency(value);
  };

  if (analysis.cohorts.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        No sales data loaded, so there are no cohorts to follow yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-1">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Lifetime Value by Acquisition Month</h3>
        <InfoTooltip text="Each row is the patients who came for the very first time in that month. Reading across shows what that same group of people spent in the months that followed - not what the clinic earned that month. A patient stays in their acquisition row forever, so June revenue from a May first-timer is credited to May." />
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Read the May row, column <span className="font-medium">+1</span>, with Cumulative on: that is everything May's new
        patients had spent by the end of June. Column <span className="font-medium">0</span> is their first month.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-3 print:hidden">
        <Segmented
          label="Basis"
          value={basis}
          options={['revenue', 'deliveredValue'] as const}
          labels={COHORT_BASIS_LABELS}
          onChange={onBasisChange}
        />
        <Segmented
          label="Cell shows"
          value={measure}
          options={['total', 'perPatient', 'patients'] as const}
          labels={MEASURE_LABELS}
          onChange={setMeasure}
        />
        <label className={`flex items-center gap-2 pb-1 text-xs ${cumulativeApplies ? 'text-zinc-600 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-600'}`}>
          <input
            type="checkbox"
            checked={showCumulative}
            disabled={!cumulativeApplies}
            onChange={(e) => setCumulative(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Cumulative
          {!cumulativeApplies && <span className="text-[11px]">(counts people, so they cannot be added up)</span>}
        </label>
      </div>

      <div className="max-h-[32rem] overflow-auto print:max-h-none print:overflow-visible">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="sticky left-0 z-20 bg-white py-2 pr-3 dark:bg-zinc-900">Acquired</th>
              <th className="py-2 pr-3 text-right">Patients</th>
              <th className="py-2 pr-3 text-right">Lifetime</th>
              <th className="py-2 pr-4 text-right">Per Patient</th>
              {ages.map((age) => (
                <th key={age} className="py-2 pr-3 text-right font-medium tabular-nums">
                  {age === 0 ? '0' : `+${age}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cohort, values }) => {
              const lifetime = cohortTotal(cohort, basis);
              return (
                <tr key={cohort.cohortMonth} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-1.5 pr-3 font-medium dark:bg-zinc-900">
                    {formatMonthLabel(cohort.cohortMonth)}
                    {cohort.censored && (
                      <span
                        className="ml-1 cursor-help text-amber-600 dark:text-amber-500"
                        title="Earliest month of imported data. Anyone first seen here may have been a patient for years - there is no earlier data to tell a genuine first-timer apart from a long-standing one. Treat this row as unverified."
                      >
                        *
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{formatNumber(cohort.patients)}</td>
                  <td className="py-1.5 pr-3 text-right font-medium">{formatCurrency(lifetime)}</td>
                  <td className="py-1.5 pr-4 text-right text-zinc-500 dark:text-zinc-400">
                    {cohort.patients > 0 ? formatCurrency(lifetime / cohort.patients) : '—'}
                  </td>
                  {ages.map((age) => {
                    const cell = cohort.cells[age];
                    if (!cell) return <td key={age} className="py-1.5 pr-3" />;
                    const value = values[age];
                    const intensity = peak > 0 && value !== null ? Math.min(Math.abs(value) / peak, 1) : 0;
                    const negative = value !== null && value < 0;
                    return (
                      <td
                        key={age}
                        className="py-1.5 pr-3 text-right tabular-nums"
                        title={`${formatMonthLabel(cell.month)}${cell.partial ? ' (month still in progress)' : ''}`}
                        style={{
                          backgroundColor: negative
                            ? `rgba(244, 63, 94, ${0.12 + intensity * 0.45})`
                            : `rgba(99, 102, 241, ${intensity * 0.42})`,
                        }}
                      >
                        <span className={cell.partial ? 'italic text-zinc-500 dark:text-zinc-400' : undefined}>
                          {format(value)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Lifetime and Per Patient always read as {COHORT_BASIS_LABELS[basis].toLowerCase()}, whatever the cells show.
        Rows get shorter towards the bottom because a recent cohort has had fewer months to spend, so lifetime totals are
        not comparable between rows - compare down a single age column instead. Italic cells sit in a month that is still
        filling (data ends {analysis.asOf}). A row marked <span className="text-amber-600 dark:text-amber-500">*</span> is
        the earliest month of data, where a first visit cannot be verified.
      </p>
    </div>
  );
}

/**
 * The average cohort's spending curve by age, which is the fair comparison the triangle above
 * cannot give directly: a row's lifetime total mostly reflects how long ago it was acquired.
 */
export function PatientCohortAgeCurve({ analysis, basis }: { analysis: CohortAnalysis; basis: CohortBasis }) {
  const ages = useMemo(() => averageByAge(analysis.cohorts, basis), [analysis.cohorts, basis]);

  if (ages.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        No cohort has a complete month behind it yet, so there is nothing to average.
      </div>
    );
  }

  const running: number[] = [];
  let sum = 0;
  for (const age of ages) {
    sum += age.valuePerPatient ?? 0;
    running.push(sum);
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-1">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Average New Patient, by Months Since First Visit
        </h3>
        <InfoTooltip text="Every cohort averaged together at each age, so a month acquired long ago and one acquired recently are compared over the same stretch of life rather than by how much time they have had. Only complete months count, and the earliest month of data is left out because its patients are not verifiably new." />
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        What one new patient is worth on average in their first month, second month, and so on, measured as{' '}
        {COHORT_BASIS_LABELS[basis].toLowerCase()}.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-2 pr-3">Month</th>
              {ages.map((a) => (
                <th key={a.monthIndex} className="py-2 pr-3 text-right tabular-nums">
                  {a.monthIndex === 0 ? '0' : `+${a.monthIndex}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5 pr-3 font-medium">Per patient</td>
              {ages.map((a) => (
                <td key={a.monthIndex} className="py-1.5 pr-3 text-right tabular-nums">
                  {a.valuePerPatient === null ? '—' : formatCurrency(a.valuePerPatient)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5 pr-3 font-medium">Cumulative</td>
              {running.map((value, i) => (
                <td key={ages[i].monthIndex} className="py-1.5 pr-3 text-right font-medium tabular-nums">
                  {formatCurrency(value)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-zinc-100 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <td className="py-1.5 pr-3">Cohorts averaged</td>
              {ages.map((a) => (
                <td key={a.monthIndex} className="py-1.5 pr-3 text-right tabular-nums">
                  {formatNumber(a.cohorts)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Later columns rest on fewer cohorts, so they move more from month to month. The Cumulative row is what an average
        new patient has been worth in total by that age, which is the figure to set against acquisition cost.
      </p>
    </div>
  );
}
