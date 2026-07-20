import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  GENERAL_SEGMENT,
  resolveAllocationPercent,
  totalAllocatedPercent,
  type SegmentAllocationRule,
} from '../lib/segmentAllocation';
import { formatMonthLabel } from '../lib/format';

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function monthInputToISO(value: string): string {
  // <input type="month"> gives "yyyy-mm"
  return `${value}-01`;
}

export function SegmentAllocationEditor({
  segments,
  rules,
  setRules,
  latestMonth,
}: {
  /** All segment codes seen across uploaded P&L data, including GEN. */
  segments: string[];
  rules: SegmentAllocationRule[];
  setRules: Dispatch<SetStateAction<SegmentAllocationRule[]>>;
  /** Most recent month with uploaded data, used to preview the currently-effective % split. */
  latestMonth: string | null;
}) {
  const targetSegments = segments.filter((s) => s !== GENERAL_SEGMENT);

  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [percents, setPercents] = useState<Record<string, string>>({});

  const addRules = () => {
    if (!effectiveFrom) return;
    const month = monthInputToISO(effectiveFrom);
    const newRules: SegmentAllocationRule[] = [];
    for (const segment of targetSegments) {
      const raw = percents[segment];
      if (raw === undefined || raw === '') continue;
      const pct = parseFloat(raw);
      if (!Number.isFinite(pct) || pct < 0) continue;
      newRules.push({ id: newId(), effectiveFrom: month, segment, percent: pct });
    }
    if (newRules.length === 0) return;
    setRules((prev) => [...prev.filter((r) => !(r.effectiveFrom === month && newRules.some((n) => n.segment === r.segment))), ...newRules]);
    setEffectiveFrom('');
    setPercents({});
  };

  const effectiveFromDates = [...new Set(rules.map((r) => r.effectiveFrom))].sort((a, b) => b.localeCompare(a));
  const previewSum = latestMonth ? totalAllocatedPercent(rules, segments, latestMonth) : null;

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">GEN Overhead Allocation</h4>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        What % of the General ({GENERAL_SEGMENT}) segment's costs each other segment absorbs. Effective from a chosen
        month onward (until superseded by a later change here), so a mid-year rate change doesn't rewrite prior
        months. Ideally the percentages for a given month add up to 100% - anything left over stays unallocated.
      </p>

      {targetSegments.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-500">Upload a Segment P&amp;L file first to configure allocation.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400">Effective From</label>
              <input
                type="month"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="mt-0.5 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            {targetSegments.map((segment) => (
              <div key={segment}>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400">{segment} %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={percents[segment] ?? ''}
                  onChange={(e) => setPercents((prev) => ({ ...prev, [segment]: e.target.value }))}
                  placeholder="0"
                  className="mt-0.5 w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            ))}
            <button
              onClick={addRules}
              disabled={!effectiveFrom}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Save Split
            </button>
          </div>

          {previewSum != null && (
            <p className={`mb-3 text-xs ${Math.round(previewSum * 10) === 1000 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              Currently effective split as of {formatMonthLabel(latestMonth!)} totals {previewSum.toFixed(1)}%
              {Math.round(previewSum * 10) === 1000 ? ' (fully allocated).' : ' - overhead is not fully allocated.'}
            </p>
          )}

          {effectiveFromDates.length === 0 ? (
            <p className="py-3 text-center text-xs text-zinc-500">No allocation splits configured yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1.5 pr-2">Effective From</th>
                  {targetSegments.map((s) => (
                    <th key={s} className="py-1.5 pr-2 text-right">{s} %</th>
                  ))}
                  <th className="py-1.5 pr-2" />
                </tr>
              </thead>
              <tbody>
                {effectiveFromDates.map((month) => (
                  <tr key={month} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2 font-medium">{formatMonthLabel(month)}</td>
                    {targetSegments.map((s) => (
                      <td key={s} className="py-1.5 pr-2 text-right">
                        {rules.some((r) => r.effectiveFrom === month && r.segment === s)
                          ? `${resolveAllocationPercent(rules.filter((r) => r.effectiveFrom === month), s, month).toFixed(1)}%`
                          : '—'}
                      </td>
                    ))}
                    <td className="py-1.5 pr-2 text-right">
                      <button
                        onClick={() => setRules((prev) => prev.filter((r) => r.effectiveFrom !== month))}
                        className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
