import { useCallback, useMemo, useRef, useState } from 'react';
import type { PackageBenefitRecord, SaleRecord } from '../types';
import { DEPARTMENTS, type Department, type DepartmentMappingBatch, type KnownService, type ServiceDepartmentRecord } from '../lib/departments';
import { DepartmentMappingSchemaError, type DepartmentMappingImportResult } from '../hooks/useServiceDepartments';
import { buildDepartmentMappingCsv } from '../lib/departmentMappingParser';
import { suggestPackageDepartments } from '../lib/packageDepartmentSuggestion';
import { InfoTooltip } from './InfoTooltip';
import { formatNumber } from '../lib/format';

function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ServiceDepartmentEditor({
  services,
  saleRecords,
  records,
  batch,
  packageBenefits,
  setDepartment,
  importFile,
  onPullFromOneDrive,
}: {
  services: KnownService[];
  /** Full sales history - used to link a package to its Package Benefits rows by invoice number. */
  saleRecords: SaleRecord[];
  records: ServiceDepartmentRecord[];
  batch: DepartmentMappingBatch | null;
  /** Package Benefits Detail data, used to suggest a package's department from the services it bundles. */
  packageBenefits: PackageBenefitRecord[];
  setDepartment: (serviceKey: string, serviceName: string, department: Department | null) => Promise<void>;
  importFile: (file: File, knownServices: KnownService[]) => Promise<DepartmentMappingImportResult>;
  /** Present only when signed in to OneDrive - pulls every file from the configured "Department Mapping" subfolder. */
  onPullFromOneDrive?: () => Promise<File[]>;
}) {
  const [serviceFilter, setServiceFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDepartment, setBulkDepartment] = useState<Department>(DEPARTMENTS[0]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importResult, setImportResult] = useState<DepartmentMappingImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mapping = useMemo(() => Object.fromEntries(records.map((r) => [r.serviceKey, r.department])), [records]);

  const itemTypes = useMemo(() => [...new Set(services.map((s) => s.itemType))].sort(), [services]);

  const filtered = useMemo(() => {
    const q = serviceFilter.trim().toLowerCase();
    return services.filter((s) => {
      if (q && !s.serviceName.toLowerCase().includes(q)) return false;
      if (typeFilter !== 'All' && s.itemType !== typeFilter) return false;
      const department = mapping[s.serviceKey];
      if (departmentFilter === 'Unassigned' && department) return false;
      if (departmentFilter !== 'All' && departmentFilter !== 'Unassigned' && department !== departmentFilter) return false;
      return true;
    });
  }, [services, serviceFilter, typeFilter, departmentFilter, mapping]);

  const mappedCount = services.filter((s) => mapping[s.serviceKey]).length;

  const packageSuggestions = useMemo(() => {
    const packages = services.filter((s) => s.itemType === 'Package');
    const suggestions = suggestPackageDepartments(packages, saleRecords, packageBenefits, mapping, services);
    return new Map(suggestions.map((s) => [s.serviceKey, s]));
  }, [services, saleRecords, packageBenefits, mapping]);

  const confidentSuggestions = [...packageSuggestions.values()].filter(
    (s) => s.suggestedDepartment && !mapping[s.serviceKey],
  );

  // When focused on Unassigned, surface the truly-stuck rows (no suggestion at all) before the
  // ones that already have a green "Suggested" or amber "Mixed" hint to act on.
  const displayed = useMemo(() => {
    if (departmentFilter !== 'Unassigned') return filtered;
    const hasHint = (s: KnownService) => {
      const suggestion = packageSuggestions.get(s.serviceKey);
      return !!suggestion && (!!suggestion.suggestedDepartment || suggestion.departmentsFound.length > 1);
    };
    return [...filtered].sort((a, b) => Number(hasHint(a)) - Number(hasHint(b)));
  }, [filtered, departmentFilter, packageSuggestions]);

  const applyAllConfidentSuggestions = async () => {
    await Promise.all(
      confidentSuggestions.map((s) => {
        const service = services.find((x) => x.serviceKey === s.serviceKey)!;
        return setDepartment(s.serviceKey, service.serviceName, s.suggestedDepartment!);
      }),
    );
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

  const applyBulk = async () => {
    if (selected.size === 0) return;
    const targets = services.filter((s) => selected.has(s.serviceKey));
    await Promise.all(targets.map((s) => setDepartment(s.serviceKey, s.serviceName, bulkDepartment)));
    setSelected(new Set());
  };

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // The mapping is one wholesale-replaced file, not an accumulating history - if more than
      // one shows up (e.g. a "Pull from OneDrive" against a folder that's collected several
      // exports over time), use whichever was actually modified most recently rather than just
      // the first one returned, since that order isn't guaranteed to be newest-first.
      const file = [...files].sort((a, b) => b.lastModified - a.lastModified)[0];
      setBusy(true);
      setError(null);
      setImportResult(null);
      try {
        const result = await importFile(file, services);
        setImportResult({
          ...result,
          warnings: files.length > 1 ? [`${files.length} files found - used the most recently modified: "${file.name}".`, ...result.warnings] : result.warnings,
        });
      } catch (e) {
        setError(e instanceof DepartmentMappingSchemaError || e instanceof Error ? e.message : `Failed to read "${file.name}".`);
      } finally {
        setBusy(false);
      }
    },
    [importFile, services],
  );

  const pullFromOneDrive = useCallback(async () => {
    if (!onPullFromOneDrive) return;
    setBusy(true);
    setError(null);
    try {
      const files = await onPullFromOneDrive();
      if (files.length === 0) {
        setError('No .csv/.xlsx files found in the "Department Mapping" OneDrive folder.');
        setBusy(false);
        return;
      }
      await handleFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pull files from OneDrive.');
      setBusy(false);
    }
  }, [onPullFromOneDrive, handleFiles]);

  const exportMapping = () => {
    const csv = buildDepartmentMappingCsv(services, mapping);
    // Deliberately no date/timestamp in the name - this is meant to overwrite the same file in
    // the shared OneDrive folder each time, not accumulate a new dated copy per export (which
    // would leave "Pull from OneDrive" guessing which of several files is actually current).
    downloadCsv(csv, 'department-mapping.csv');
  };

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Service → Department Mapping</h4>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Every distinct service/product/package found in your uploaded sales data, listed once. Assign each to the
        department that performs or sells it (e.g. "Laser Hair Removal - Beard" → Laser) - use "General" for things
        that aren't department-specific (e.g. a registration fee). This mapping is what the department-wise analysis
        will be built on - a line item with no department assigned won't be counted in it. Packages are cross-checked
        against your uploaded Package Benefits data: if a package's underlying services (e.g. a "VIP Package"
        redeeming Laser sessions) are already mapped and all agree on one department, it's suggested here
        automatically instead of you having to guess. A benefit that's only ever redeemed inside a package - never
        sold on its own ("Package Benefit" type below) - is listed too, so it can be mapped even without a standalone
        sale, letting more packages resolve automatically.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = [...e.dataTransfer.files];
          if (files.length > 0) handleFiles(files);
        }}
        className={`mb-3 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
          dragOver ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/20' : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
        }`}
      >
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          Editing this in Excel? Drag &amp; drop a mapping file (.csv/.xlsx) here to replace the whole mapping below, or
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Choose file'}
          </button>
          {onPullFromOneDrive && (
            <button
              onClick={pullFromOneDrive}
              disabled={busy}
              className="rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              {busy ? 'Importing…' : 'Pull from OneDrive'}
            </button>
          )}
          <button
            onClick={exportMapping}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Download current mapping (.csv)
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length > 0) handleFiles(files);
            e.target.value = '';
          }}
        />
        <p className="mt-2 text-xs text-zinc-400">
          Download, edit the Department column in Excel, then re-upload (or drop the file in the shared "Department
          Mapping" OneDrive folder) - anyone using this dashboard can then pull the same mapping via the button
          above, instead of it only living in your own browser.
        </p>
        {batch && (
          <p className="mt-2 text-xs text-zinc-400">
            Last imported: <strong>{batch.fileName}</strong> ({formatNumber(batch.rowCount)} rows),{' '}
            {new Date(batch.uploadedAt).toLocaleString('en-GB')}.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-3 whitespace-pre-line rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {importResult && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <p>
            <strong>{importResult.fileName}</strong>: {formatNumber(importResult.rowCount)} service(s) mapped.
          </p>
          {importResult.warnings.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {importResult.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatNumber(mappedCount)} of {formatNumber(services.length)} mapped
        </span>
        {(serviceFilter || typeFilter !== 'All' || departmentFilter !== 'All') && (
          <button
            onClick={() => {
              setServiceFilter('');
              setTypeFilter('All');
              setDepartmentFilter('All');
            }}
            className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Clear filters
          </button>
        )}
      </div>

      {confidentSuggestions.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950/30">
          <span className="text-zinc-700 dark:text-zinc-200">
            {formatNumber(confidentSuggestions.length)} package{confidentSuggestions.length === 1 ? '' : 's'} can be
            auto-mapped from their Package Benefits composition
          </span>
          <button
            onClick={applyAllConfidentSuggestions}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Apply suggestions
          </button>
        </div>
      )}

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
                <th className="w-8 py-1.5 pl-3 align-bottom">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((s) => selected.has(s.serviceKey))}
                    onChange={toggleSelectAllFiltered}
                    className="rounded border-zinc-300 dark:border-zinc-700"
                  />
                </th>
                <th className="py-1.5 pr-2 align-bottom">
                  <div className="mb-1">Service</div>
                  <input
                    value={serviceFilter}
                    onChange={(e) => setServiceFilter(e.target.value)}
                    placeholder="Filter…"
                    className="w-full max-w-40 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-normal normal-case text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </th>
                <th className="py-1.5 pr-2 align-bottom">
                  <div className="mb-1">Type</div>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="w-full max-w-32 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-normal normal-case text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="All">All</option>
                    {itemTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="py-1.5 pr-2 align-bottom">Category</th>
                <th className="py-1.5 pr-2 align-bottom">
                  Sold By
                  <InfoTooltip text="Only shown when every sale of this service was by the same staff member - always true for a one-off custom package, rarely true for a shared service sold by many providers." />
                </th>
                <th className="py-1.5 pr-2 align-bottom">
                  Invoice No
                  <InfoTooltip text="Only shown when every sale of this service is on the same invoice - always true for a one-off custom package." />
                </th>
                <th className="py-1.5 pr-3 align-bottom">
                  <div className="mb-1">Department</div>
                  <select
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    className="w-full max-w-36 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-normal normal-case text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="All">All</option>
                    <option value="Unassigned">Unassigned</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-xs text-zinc-500">
                    No services match the current filters.
                  </td>
                </tr>
              ) : (
                displayed.map((s) => {
                  const suggestion = packageSuggestions.get(s.serviceKey);
                  const isUnassigned = !mapping[s.serviceKey];
                  return (
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
                      <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{s.category || '—'}</td>
                      <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{s.soldBy || '—'}</td>
                      <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{s.invoiceNo || '—'}</td>
                      <td className="py-1.5 pr-3">
                        <select
                          value={mapping[s.serviceKey] ?? ''}
                          onChange={(e) => setDepartment(s.serviceKey, s.serviceName, (e.target.value as Department) || null)}
                          className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="">— Unassigned —</option>
                          {DEPARTMENTS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                        {isUnassigned && suggestion && suggestion.suggestedDepartment && (
                          <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                            Suggested: {suggestion.suggestedDepartment} (from {formatNumber(suggestion.benefitNames.length)} benefit
                            {suggestion.benefitNames.length === 1 ? '' : 's'}){' '}
                            <button
                              onClick={() => setDepartment(s.serviceKey, s.serviceName, suggestion.suggestedDepartment!)}
                              className="font-medium underline hover:no-underline"
                            >
                              Apply
                            </button>
                          </div>
                        )}
                        {isUnassigned && suggestion && !suggestion.suggestedDepartment && suggestion.departmentsFound.length > 1 && (
                          <div
                            className="mt-1 text-xs text-amber-600 dark:text-amber-400"
                            title={`Benefits: ${suggestion.benefitNames.join(', ')}`}
                          >
                            Mixed: {suggestion.departmentsFound.join(', ')} - needs manual review
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
