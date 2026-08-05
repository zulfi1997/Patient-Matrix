import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ProviderAssignmentOverride, ProviderGroup, RevenueAdjustment } from '../lib/conversionMetrics';
import { isRevenueTypeKey, REVENUE_TYPE_KEYS, REVENUE_TYPE_LABELS } from '../lib/revenueTypes';
import { formatDate, formatNumber } from '../lib/format';

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function ProviderGroupsEditor({
  groups,
  setGroups,
  knownStaff,
}: {
  groups: ProviderGroup[];
  setGroups: Dispatch<SetStateAction<ProviderGroup[]>>;
  knownStaff: string[];
}) {
  const [canonicalName, setCanonicalName] = useState('');
  const [selectedAliases, setSelectedAliases] = useState<Set<string>>(new Set());
  const [staffFilter, setStaffFilter] = useState('');

  const alreadyGrouped = new Set(groups.flatMap((g) => [g.canonicalName, ...g.aliases]));
  const pickableStaff = knownStaff.filter(
    (s) => s !== canonicalName.trim() && !alreadyGrouped.has(s) && s.toLowerCase().includes(staffFilter.trim().toLowerCase()),
  );

  const toggleAlias = (name: string) => {
    setSelectedAliases((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addGroup = () => {
    const name = canonicalName.trim();
    const aliases = [...selectedAliases];
    if (!name || aliases.length === 0) return;
    setGroups((prev) => [...prev, { id: newId(), canonicalName: name, aliases }]);
    setCanonicalName('');
    setSelectedAliases(new Set());
    setStaffFilter('');
  };

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Provider Groups</h4>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Fold an assisting nurse's invoices under the doctor they assist - both are then counted as one provider
        everywhere on this dashboard (visit counts, conversion category, and Revenue).
      </p>

      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">Canonical Provider (e.g. the doctor)</label>
          <input
            list="master-control-staff-options"
            value={canonicalName}
            onChange={(e) => setCanonicalName(e.target.value)}
            placeholder="Dr. Meacy"
            className="mt-0.5 w-48 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">
            Aliases {selectedAliases.size > 0 && `(${selectedAliases.size} selected)`}
          </label>
          <input
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            placeholder="Filter staff…"
            className="mt-0.5 w-56 rounded-t-lg border border-zinc-300 border-b-0 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="max-h-40 w-56 overflow-auto rounded-b-lg border border-zinc-300 bg-white p-1.5 dark:border-zinc-700 dark:bg-zinc-800">
            {pickableStaff.length === 0 ? (
              <p className="px-1.5 py-1 text-xs text-zinc-400">No matching, ungrouped staff.</p>
            ) : (
              pickableStaff.map((s) => (
                <label key={s} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/50">
                  <input
                    type="checkbox"
                    checked={selectedAliases.has(s)}
                    onChange={() => toggleAlias(s)}
                    className="rounded border-zinc-300 dark:border-zinc-700"
                  />
                  {s}
                </label>
              ))
            )}
          </div>
        </div>
        <button
          onClick={addGroup}
          disabled={!canonicalName.trim() || selectedAliases.size === 0}
          className="mt-5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          Add Group
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-500">No provider groups yet - every staff name is its own provider.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {groups.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800/60"
            >
              <span>
                <strong>{g.canonicalName}</strong>{' '}
                <span className="text-zinc-500 dark:text-zinc-400">← {g.aliases.join(', ')}</span>
              </span>
              <button
                onClick={() => setGroups((prev) => prev.filter((x) => x.id !== g.id))}
                className="text-xs text-rose-600 hover:underline dark:text-rose-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <datalist id="master-control-staff-options">
        {knownStaff.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

function TemporaryReassignmentsEditor({
  overrides,
  setOverrides,
}: {
  overrides: ProviderAssignmentOverride[];
  setOverrides: Dispatch<SetStateAction<ProviderAssignmentOverride[]>>;
}) {
  const [staffName, setStaffName] = useState('');
  const [canonicalName, setCanonicalName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');

  const addOverride = () => {
    if (!staffName.trim() || !canonicalName.trim() || !startDate || !endDate || endDate < startDate) return;
    setOverrides((prev) => [
      ...prev,
      { id: newId(), staffName: staffName.trim(), canonicalName: canonicalName.trim(), startDate, endDate, note: note.trim() },
    ]);
    setStaffName('');
    setCanonicalName('');
    setStartDate('');
    setEndDate('');
    setNote('');
  };

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Temporary Reassignments</h4>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        A date-range exception to Provider Groups - e.g. a nurse who normally assists Dr. A is reassigned to cover
        for Dr. B while Dr. A is on leave. Takes priority over Provider Groups for visit dates within the range.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">Staff (being reassigned)</label>
          <input
            list="master-control-staff-options"
            value={staffName}
            onChange={(e) => setStaffName(e.target.value)}
            placeholder="Rini"
            className="mt-0.5 w-36 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">Covering For (provider)</label>
          <input
            list="master-control-staff-options"
            value={canonicalName}
            onChange={(e) => setCanonicalName(e.target.value)}
            placeholder="Dr. Meacy"
            className="mt-0.5 w-36 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-0.5 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">To</label>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-0.5 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">Note (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Dr. A on leave"
            className="mt-0.5 w-48 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <button
          onClick={addOverride}
          disabled={!staffName.trim() || !canonicalName.trim() || !startDate || !endDate || endDate < startDate}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          Add Reassignment
        </button>
      </div>

      {overrides.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-500">No temporary reassignments yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1.5 pr-2">Staff</th>
              <th className="py-1.5 pr-2">Covering For</th>
              <th className="py-1.5 pr-2">From</th>
              <th className="py-1.5 pr-2">To</th>
              <th className="py-1.5 pr-2">Note</th>
              <th className="py-1.5 pr-2" />
            </tr>
          </thead>
          <tbody>
            {[...overrides]
              .sort((a, b) => b.startDate.localeCompare(a.startDate))
              .map((o) => (
                <tr key={o.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2">{o.staffName}</td>
                  <td className="py-1.5 pr-2">{o.canonicalName}</td>
                  <td className="py-1.5 pr-2">{formatDate(o.startDate)}</td>
                  <td className="py-1.5 pr-2">{formatDate(o.endDate)}</td>
                  <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{o.note || '—'}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <button
                      onClick={() => setOverrides((prev) => prev.filter((x) => x.id !== o.id))}
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
    </div>
  );
}

function RevenueAdjustmentsEditor({
  adjustments,
  setAdjustments,
}: {
  adjustments: RevenueAdjustment[];
  setAdjustments: Dispatch<SetStateAction<RevenueAdjustment[]>>;
}) {
  const [date, setDate] = useState('');
  const [fromProvider, setFromProvider] = useState('');
  const [toProvider, setToProvider] = useState('');
  const [amount, setAmount] = useState('');
  const [itemType, setItemType] = useState('');
  const [note, setNote] = useState('');

  const addAdjustment = () => {
    const amt = parseFloat(amount);
    if (!date || !fromProvider.trim() || !toProvider.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setAdjustments((prev) => [
      ...prev,
      {
        id: newId(), date, fromProvider: fromProvider.trim(), toProvider: toProvider.trim(), amount: amt,
        note: note.trim(), ...(isRevenueTypeKey(itemType) ? { itemType } : {}),
      },
    ]);
    setDate('');
    setFromProvider('');
    setToProvider('');
    setAmount('');
    setItemType('');
    setNote('');
  };

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Revenue Adjustments</h4>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        A manual, dated correction - e.g. "on 14/07/2026 remove OMR 500 revenue from Rini and allocate it to Meacy".
        Only moves the Revenue figure for that date; never changes any patient's underlying conversion category or
        visit count. Naming a type puts the move in that column of the Revenue by Type breakdown on the Dashboard and
        Provider Analytics; leaving it unset still moves both providers' totals, but shows in a separate Adjustment
        column rather than being attributed to a type you did not state. Either way the clinic-wide total is
        unchanged, since the amount only moves between two providers.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-0.5 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">From (remove)</label>
          <input
            list="master-control-staff-options"
            value={fromProvider}
            onChange={(e) => setFromProvider(e.target.value)}
            placeholder="Rini"
            className="mt-0.5 w-36 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">To (allocate)</label>
          <input
            list="master-control-staff-options"
            value={toProvider}
            onChange={(e) => setToProvider(e.target.value)}
            placeholder="Meacy"
            className="mt-0.5 w-36 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">Amount (OMR)</label>
          <input
            type="number"
            min="0"
            step="0.001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
            className="mt-0.5 w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">Type (optional)</label>
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            className="mt-0.5 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">Not specified</option>
            {REVENUE_TYPE_KEYS.map((k) => (
              <option key={k} value={k}>{REVENUE_TYPE_LABELS[k]}</option>
            ))}
          </select>
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
          disabled={!date || !fromProvider.trim() || !toProvider.trim() || !amount}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          Add Adjustment
        </button>
      </div>

      {adjustments.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-500">No adjustments yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1.5 pr-2">Date</th>
              <th className="py-1.5 pr-2">From</th>
              <th className="py-1.5 pr-2">To</th>
              <th className="py-1.5 pr-2 text-right">Amount</th>
              <th className="py-1.5 pr-2">Type</th>
              <th className="py-1.5 pr-2">Note</th>
              <th className="py-1.5 pr-2" />
            </tr>
          </thead>
          <tbody>
            {[...adjustments]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((a) => (
                <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2">{formatDate(a.date)}</td>
                  <td className="py-1.5 pr-2">{a.fromProvider}</td>
                  <td className="py-1.5 pr-2">{a.toProvider}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(a.amount)}</td>
                  <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">
                    {a.itemType ? REVENUE_TYPE_LABELS[a.itemType] : 'Not specified'}
                  </td>
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
    </div>
  );
}

export function MasterControlPanel({
  providerGroups,
  setProviderGroups,
  revenueAdjustments,
  setRevenueAdjustments,
  providerAssignmentOverrides,
  setProviderAssignmentOverrides,
  knownStaff,
}: {
  providerGroups: ProviderGroup[];
  setProviderGroups: Dispatch<SetStateAction<ProviderGroup[]>>;
  revenueAdjustments: RevenueAdjustment[];
  setRevenueAdjustments: Dispatch<SetStateAction<RevenueAdjustment[]>>;
  providerAssignmentOverrides: ProviderAssignmentOverride[];
  setProviderAssignmentOverrides: Dispatch<SetStateAction<ProviderAssignmentOverride[]>>;
  knownStaff: string[];
}) {
  return (
    <div className="flex flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
      <ProviderGroupsEditor groups={providerGroups} setGroups={setProviderGroups} knownStaff={knownStaff} />
      <div className="border-t border-zinc-200 dark:border-zinc-800" />
      <TemporaryReassignmentsEditor overrides={providerAssignmentOverrides} setOverrides={setProviderAssignmentOverrides} />
      <div className="border-t border-zinc-200 dark:border-zinc-800" />
      <RevenueAdjustmentsEditor adjustments={revenueAdjustments} setAdjustments={setRevenueAdjustments} />
    </div>
  );
}
