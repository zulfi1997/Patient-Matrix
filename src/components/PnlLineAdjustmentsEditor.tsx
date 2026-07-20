import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { PnlLineRecord } from '../types';
import { GENERAL_SEGMENT, type PnlLineAdjustment } from '../lib/segmentAllocation';
import { formatCurrency, formatMonthLabel } from '../lib/format';

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function monthInputToISO(value: string): string {
  // <input type="month"> gives "yyyy-mm"
  return `${value}-01`;
}

export function PnlLineAdjustmentsEditor({
  pnlLines,
  segments,
  adjustments,
  setAdjustments,
}: {
  /** All uploaded Segment P&L line items, used only to suggest known Group/Description values. */
  pnlLines: PnlLineRecord[];
  /** All segment codes seen across uploaded P&L data, including GEN. */
  segments: string[];
  adjustments: PnlLineAdjustment[];
  setAdjustments: Dispatch<SetStateAction<PnlLineAdjustment[]>>;
}) {
  const [month, setMonth] = useState('');
  const [segment, setSegment] = useState('');
  const [group, setGroup] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const knownGroups = useMemo(
    () => [...new Set(pnlLines.filter((l) => l.section === 'expense' && l.group).map((l) => l.group as string))].sort(),
    [pnlLines],
  );
  const knownDescriptions = useMemo(
    () => [...new Set(pnlLines.filter((l) => l.section === 'expense').map((l) => l.description))].sort(),
    [pnlLines],
  );

  const addAdjustment = () => {
    const amt = parseFloat(amount);
    if (!month || !segment.trim() || !description.trim() || !Number.isFinite(amt) || amt === 0) return;
    setAdjustments((prev) => [
      ...prev,
      {
        id: newId(),
        month: monthInputToISO(month),
        segment: segment.trim(),
        section: 'expense',
        group: group.trim() || null,
        description: description.trim(),
        amount: amt,
        note: note.trim(),
      },
    ]);
    setMonth('');
    setSegment('');
    setGroup('');
    setDescription('');
    setAmount('');
    setNote('');
  };

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Expense Adjustments</h4>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        A manual, one-off correction to a specific expense line for a specific month and segment - e.g. a posting
        error, or a cost the accounting export doesn't capture. Amount uses the same sign convention as the P&amp;L
        itself: negative increases the expense, positive decreases it. An adjustment on{' '}
        <strong>{GENERAL_SEGMENT}</strong> (General) is not applied to General directly - it's added to General's own
        figure for that line and then split across every segment by whichever allocation method (Fixed % or Revenue
        Share) is active on the Segment P&amp;L tab, exactly like every other General expense.
      </p>

      {segments.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-500">Upload a Segment P&amp;L file first to add adjustments.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400">Month</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="mt-0.5 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400">Segment</label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                className="mt-0.5 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="">Select…</option>
                {segments.map((s) => (
                  <option key={s} value={s}>{s === GENERAL_SEGMENT ? `${s} (General)` : s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400">Group</label>
              <input
                list="pnl-adjustment-group-options"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="e.g. Administration Expenses"
                className="mt-0.5 w-48 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400">Line Item (Description)</label>
              <input
                list="pnl-adjustment-description-options"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Electricity"
                className="mt-0.5 w-48 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400">Amount (OMR)</label>
              <input
                type="number"
                step="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="-50"
                className="mt-0.5 w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400">Note (optional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason for correction"
                className="mt-0.5 w-48 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <button
              onClick={addAdjustment}
              disabled={!month || !segment.trim() || !description.trim() || !amount}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Add Adjustment
            </button>
          </div>

          <datalist id="pnl-adjustment-group-options">
            {knownGroups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <datalist id="pnl-adjustment-description-options">
            {knownDescriptions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>

          {adjustments.length === 0 ? (
            <p className="py-3 text-center text-xs text-zinc-500">No expense adjustments yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1.5 pr-2">Month</th>
                  <th className="py-1.5 pr-2">Segment</th>
                  <th className="py-1.5 pr-2">Group</th>
                  <th className="py-1.5 pr-2">Line Item</th>
                  <th className="py-1.5 pr-2 text-right">Amount</th>
                  <th className="py-1.5 pr-2">Note</th>
                  <th className="py-1.5 pr-2" />
                </tr>
              </thead>
              <tbody>
                {[...adjustments]
                  .sort((a, b) => b.month.localeCompare(a.month))
                  .map((a) => (
                    <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-2">{formatMonthLabel(a.month)}</td>
                      <td className="py-1.5 pr-2">{a.segment === GENERAL_SEGMENT ? `${a.segment} (General)` : a.segment}</td>
                      <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{a.group || '—'}</td>
                      <td className="py-1.5 pr-2">{a.description}</td>
                      <td className="py-1.5 pr-2 text-right">{formatCurrency(a.amount)}</td>
                      <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{a.note || '—'}</td>
                      <td className="py-1.5 pr-2 text-right">
                        <button
                          onClick={() => setAdjustments((prev) => prev.filter((x) => x.id !== a.id))}
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
