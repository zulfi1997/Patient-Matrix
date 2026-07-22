import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { ItemType } from '../types';
import { DEPARTMENTS, type Department, type ServiceDepartmentMap } from '../lib/departments';
import { formatNumber } from '../lib/format';

export interface KnownService {
  serviceKey: string;
  serviceName: string;
  itemType: ItemType;
}

export function ServiceDepartmentEditor({
  services,
  mapping,
  setMapping,
}: {
  services: KnownService[];
  mapping: ServiceDepartmentMap;
  setMapping: Dispatch<SetStateAction<ServiceDepartmentMap>>;
}) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDepartment, setBulkDepartment] = useState<Department>(DEPARTMENTS[0]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => s.serviceName.toLowerCase().includes(q) || s.itemType.toLowerCase().includes(q));
  }, [services, filter]);

  const mappedCount = services.filter((s) => mapping[s.serviceKey]).length;

  const setOne = (serviceKey: string, department: Department | '') => {
    setMapping((prev) => {
      const next = { ...prev };
      if (department) next[serviceKey] = department;
      else delete next[serviceKey];
      return next;
    });
  };

  const toggleSelected = (serviceKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(serviceKey)) next.delete(serviceKey);
      else next.add(serviceKey);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.serviceKey));
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((s) => s.serviceKey)));
  };

  const applyBulk = () => {
    if (selected.size === 0) return;
    setMapping((prev) => {
      const next = { ...prev };
      for (const key of selected) next[key] = bulkDepartment;
      return next;
    });
    setSelected(new Set());
  };

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Service → Department Mapping</h4>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Every distinct service/product/package found in your uploaded sales data, listed once. Assign each to the
        department that performs or sells it (e.g. "Laser Hair Removal - Beard" → Laser). This mapping is what the
        department-wise analysis will be built on - a line item with no department assigned won't be counted in it.
      </p>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter services…"
          className="w-56 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatNumber(mappedCount)} of {formatNumber(services.length)} mapped
        </span>
      </div>

      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm dark:bg-indigo-950/30">
          <span className="text-zinc-700 dark:text-zinc-200">{formatNumber(selected.size)} selected</span>
          <select
            value={bulkDepartment}
            onChange={(e) => setBulkDepartment(e.target.value as Department)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            onClick={applyBulk}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Assign selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Clear selection
          </button>
        </div>
      )}

      {services.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-500">No services found yet - upload sales data on this tab first.</p>
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="w-8 py-1.5 pl-3">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((s) => selected.has(s.serviceKey))}
                    onChange={toggleSelectAllFiltered}
                    className="rounded border-zinc-300 dark:border-zinc-700"
                  />
                </th>
                <th className="py-1.5 pr-2">Service</th>
                <th className="py-1.5 pr-2">Type</th>
                <th className="py-1.5 pr-3">Department</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-xs text-zinc-500">
                    No services match "{filter}".
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.serviceKey} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pl-3">
                      <input
                        type="checkbox"
                        checked={selected.has(s.serviceKey)}
                        onChange={() => toggleSelected(s.serviceKey)}
                        className="rounded border-zinc-300 dark:border-zinc-700"
                      />
                    </td>
                    <td className="py-1.5 pr-2">{s.serviceName}</td>
                    <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{s.itemType}</td>
                    <td className="py-1.5 pr-3">
                      <select
                        value={mapping[s.serviceKey] ?? ''}
                        onChange={(e) => setOne(s.serviceKey, e.target.value as Department | '')}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="">— Unassigned —</option>
                        {DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
