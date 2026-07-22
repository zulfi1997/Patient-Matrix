import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ImportBatch, PackageBenefitBatch, PnlImportBatch, PnlLineRecord, SaleRecord } from '../types';
import type { ImportResult } from '../hooks/useTransactions';
import type { PackageBenefitImportResult } from '../hooks/usePackageBenefits';
import type { PnlImportResult } from '../hooks/usePnl';
import type { ProviderAssignmentOverride, ProviderGroup, RevenueAdjustment } from '../lib/conversionMetrics';
import type { AllocationMode, PnlLineAdjustment, SegmentAllocationRule } from '../lib/segmentAllocation';
import type { DepartmentMappingBatch, KnownService, ServiceDepartmentRecord } from '../lib/departments';
import type { DepartmentMappingImportResult } from '../hooks/useServiceDepartments';
import type { AccountInfo } from '@azure/msal-browser';
import { ImportSchemaError } from '../lib/excelParser';
import { formatDate, formatNumber } from '../lib/format';
import { ONEDRIVE_SUBFOLDERS } from '../lib/oneDriveConfig';
import { PackageBenefitsSection } from './PackageBenefitsSection';
import { PnlUploadSection } from './PnlUploadSection';
import { SegmentAllocationEditor } from './SegmentAllocationEditor';
import { PnlLineAdjustmentsEditor } from './PnlLineAdjustmentsEditor';
import { OneDriveConnectSection } from './OneDriveConnectSection';
import { MasterControlPanel } from './MasterControlPanel';
import { DuplicateInvoiceLinesPanel } from './DuplicateInvoiceLinesPanel';
import { ServiceDepartmentEditor } from './ServiceDepartmentEditor';

interface DataPageProps {
  records: SaleRecord[];
  batches: ImportBatch[];
  importFile: (file: File) => Promise<ImportResult>;
  removeBatch: (id: string) => Promise<void>;
  clearAllData: () => Promise<void>;
  removeTransactionsByIds: (ids: string[]) => Promise<void>;
  packageBenefitBatches: PackageBenefitBatch[];
  importPackageBenefitFile: (file: File) => Promise<PackageBenefitImportResult>;
  removePackageBenefitSnapshot: (snapshotDate: string) => Promise<void>;
  providerGroups: ProviderGroup[];
  setProviderGroups: Dispatch<SetStateAction<ProviderGroup[]>>;
  revenueAdjustments: RevenueAdjustment[];
  setRevenueAdjustments: Dispatch<SetStateAction<RevenueAdjustment[]>>;
  providerAssignmentOverrides: ProviderAssignmentOverride[];
  setProviderAssignmentOverrides: Dispatch<SetStateAction<ProviderAssignmentOverride[]>>;
  serviceDepartmentRecords: ServiceDepartmentRecord[];
  departmentMappingBatch: DepartmentMappingBatch | null;
  setServiceDepartment: (serviceKey: string, serviceName: string, department: ServiceDepartmentRecord['department'] | null) => Promise<void>;
  importDepartmentMappingFile: (file: File, knownServices: KnownService[]) => Promise<DepartmentMappingImportResult>;
  pnlLines: PnlLineRecord[];
  pnlBatches: PnlImportBatch[];
  importPnlFile: (file: File) => Promise<PnlImportResult>;
  removePnlBatch: (month: string) => Promise<void>;
  clearAllPnl: () => Promise<void>;
  pnlSegments: string[];
  allocationRules: SegmentAllocationRule[];
  setAllocationRules: Dispatch<SetStateAction<SegmentAllocationRule[]>>;
  allocationMode: AllocationMode;
  pnlLineAdjustments: PnlLineAdjustment[];
  setPnlLineAdjustments: Dispatch<SetStateAction<PnlLineAdjustment[]>>;
  oneDrive: {
    account: AccountInfo | null;
    loading: boolean;
    signingIn: boolean;
    error: string | null;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
    pullFiles: (subfolderName: string) => Promise<File[]>;
  };
}

function exportAllCsv(records: SaleRecord[]) {
  const header = [
    'Patient ID', 'Patient Name', 'Date', 'Item Type', 'Service', 'Subcategory', 'Qty',
    'Invoice No', 'Invoice Status', 'Net Revenue (Exc. Redemption)', 'Redeemed Package', 'Redeemed Amount', 'Amount (Inc. Tax)', 'Due Amount', 'Payment Type', 'Staff', 'Invoice Notes',
  ];
  const lines = records.map((r) =>
    [
      r.patientId, r.patientName, r.date, r.itemType, r.serviceName, r.subcategory, r.qty,
      r.invoiceNo, r.invoiceStatus, r.amount.toFixed(3), r.packageName ?? '', r.redeemedAmount.toFixed(3), r.amountIncTax.toFixed(3), r.dueAmount.toFixed(3), r.paymentType ?? '', r.staff ?? '', r.invoiceNotes ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patient-matrix-backup-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataPage({
  records,
  batches,
  importFile,
  removeBatch,
  clearAllData,
  removeTransactionsByIds,
  packageBenefitBatches,
  importPackageBenefitFile,
  removePackageBenefitSnapshot,
  providerGroups,
  setProviderGroups,
  revenueAdjustments,
  setRevenueAdjustments,
  providerAssignmentOverrides,
  setProviderAssignmentOverrides,
  serviceDepartmentRecords,
  departmentMappingBatch,
  setServiceDepartment,
  importDepartmentMappingFile,
  pnlLines,
  pnlBatches,
  importPnlFile,
  removePnlBatch,
  clearAllPnl,
  pnlSegments,
  allocationRules,
  setAllocationRules,
  allocationMode,
  pnlLineAdjustments,
  setPnlLineAdjustments,
  oneDrive,
}: DataPageProps) {
  const knownStaff = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.staff) set.add(r.staff);
    }
    return [...set].sort();
  }, [records]);

  const knownServices = useMemo(() => {
    const map = new Map<string, KnownService>();
    for (const r of records) {
      if (!map.has(r.serviceKey)) map.set(r.serviceKey, { serviceKey: r.serviceKey, serviceName: r.serviceName, itemType: r.itemType });
    }
    return [...map.values()].sort((a, b) => a.serviceName.localeCompare(b.serviceName));
  }, [records]);

  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setError(null);
      setResults([]);
      const outcomes: ImportResult[] = [];
      const errors: string[] = [];
      for (const file of files) {
        try {
          outcomes.push(await importFile(file));
        } catch (e) {
          const message = e instanceof ImportSchemaError || e instanceof Error ? e.message : 'Failed to read this file.';
          errors.push(`${file.name}: ${message}`);
        }
      }
      setResults(outcomes);
      if (errors.length > 0) setError(errors.join('\n'));
      setBusy(false);
    },
    [importFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = [...e.dataTransfer.files];
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles],
  );

  const pullSalesFromOneDrive = useCallback(async () => {
    if (!oneDrive.account) return;
    setBusy(true);
    setError(null);
    try {
      const files = await oneDrive.pullFiles(ONEDRIVE_SUBFOLDERS.sales);
      if (files.length === 0) {
        setError('No .xlsx/.xls/.csv files found in the "Sales Data" OneDrive folder.');
        setBusy(false);
        return;
      }
      await handleFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pull files from OneDrive.');
      setBusy(false);
    }
  }, [oneDrive, handleFiles]);

  return (
    <div className="flex flex-col gap-4">
      <OneDriveConnectSection
        account={oneDrive.account}
        loading={oneDrive.loading}
        signingIn={oneDrive.signingIn}
        error={oneDrive.error}
        signIn={oneDrive.signIn}
        signOut={oneDrive.signOut}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
            : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
        }`}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Drag & drop the sales export (.xlsx) here, or
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Choose file'}
          </button>
          {oneDrive.account && (
            <button
              onClick={pullSalesFromOneDrive}
              disabled={busy}
              className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              {busy ? 'Importing…' : 'Pull from OneDrive'}
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length > 0) handleFiles(files);
            e.target.value = '';
          }}
        />
        <p className="mt-3 text-xs text-zinc-400">
          Upload the full history once, then just the latest export each day — records already imported are
          detected automatically and refreshed in place (not duplicated), so it's always safe to re-upload
          overlapping data, and doing so also re-applies any dashboard fixes/improvements to that data. Select or
          drop multiple files at once to import them all in one go, or use "Pull from OneDrive" to import every file
          currently in the shared "Sales Data" folder.
        </p>
      </div>

      {error && (
        <div className="whitespace-pre-line rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {results.map((result, i) => (
            <p key={i}>
              <strong>{result.fileName}</strong>: {formatNumber(result.added)} new row(s) added,{' '}
              {formatNumber(result.refreshed)} already-imported row(s) refreshed with current values
              {result.skipped > 0 && `, ${formatNumber(result.skipped)} row(s) skipped (missing data)`}.
            </p>
          ))}
          {results.some((r) => r.warnings.length > 0) && (
            <>
              <button onClick={() => setShowWarnings((v) => !v)} className="mt-1 text-xs underline">
                {showWarnings ? 'Hide' : 'Show'} skipped-row details
              </button>
              {showWarnings && (
                <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs">
                  {results.flatMap((result) =>
                    result.warnings.slice(0, 200).map((w, i) => (
                      <li key={`${result.fileName}-${i}`}>
                        {result.fileName} row {w.rowNumber}: {w.message}
                      </li>
                    )),
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <DuplicateInvoiceLinesPanel records={records} batches={batches} onRemove={removeTransactionsByIds} />

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            Import History ({formatNumber(batches.length)} upload{batches.length === 1 ? '' : 's'}, {formatNumber(records.length)} total rows)
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => exportAllCsv(records)}
              disabled={records.length === 0}
              className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Backup all data (CSV)
            </button>
            <button
              onClick={() => {
                if (confirm('This deletes all Sales data (transactions and import history) from this browser. Package Benefits and Segment P&L data are not affected. This cannot be undone. Continue?')) {
                  clearAllData();
                }
              }}
              disabled={records.length === 0}
              className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              Clear all Sales data
            </button>
          </div>
        </div>

        {batches.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No uploads yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">File</th>
                <th className="py-2 pr-2">Uploaded</th>
                <th className="py-2 pr-2">Date Range Covered</th>
                <th className="py-2 pr-2 text-right">Rows Added</th>
                <th className="py-2 pr-2 text-right">Rows Refreshed</th>
                <th className="py-2 pr-2" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2">{b.fileName}</td>
                  <td className="py-1.5 pr-2">{new Date(b.uploadedAt).toLocaleString('en-GB')}</td>
                  <td className="py-1.5 pr-2">
                    {b.dateRange ? `${formatDate(b.dateRange.min)} – ${formatDate(b.dateRange.max)}` : '—'}
                  </td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(b.addedCount)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(b.refreshedCount)}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Remove all rows imported from "${b.fileName}"?`)) removeBatch(b.id);
                      }}
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

      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">Package Balance Snapshots</h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Powers the "has package benefit balance" reason on the Provider Conversion dashboard.
        </p>
        <PackageBenefitsSection
          batches={packageBenefitBatches}
          importPackageBenefitFile={importPackageBenefitFile}
          removePackageBenefitSnapshot={removePackageBenefitSnapshot}
          onPullFromOneDrive={
            oneDrive.account ? () => oneDrive.pullFiles(ONEDRIVE_SUBFOLDERS.packageBenefits) : undefined
          }
        />
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">Segment P&amp;L</h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Powers the "Segment P&amp;L" tab - month-on-month and year-to-date P&amp;L per business segment, with
          General overhead allocated in.
        </p>
        <PnlUploadSection
          batches={pnlBatches}
          importPnlFile={importPnlFile}
          removePnlBatch={removePnlBatch}
          clearAllPnl={clearAllPnl}
          onPullFromOneDrive={oneDrive.account ? () => oneDrive.pullFiles(ONEDRIVE_SUBFOLDERS.pnl) : undefined}
        />
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <SegmentAllocationEditor
            segments={pnlSegments}
            rules={allocationRules}
            setRules={setAllocationRules}
            latestMonth={pnlBatches.length > 0 ? pnlBatches.map((b) => b.month).sort().at(-1)! : null}
            allocationMode={allocationMode}
          />
        </div>
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <PnlLineAdjustmentsEditor
            pnlLines={pnlLines}
            segments={pnlSegments}
            adjustments={pnlLineAdjustments}
            setAdjustments={setPnlLineAdjustments}
          />
        </div>
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">Master Control</h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Applies across the Provider Conversion dashboard and the "Staff" KPIs on the KPI Evaluation dashboard
          (Active Staff Count, Average Revenue per Staff).
        </p>
        <MasterControlPanel
          providerGroups={providerGroups}
          setProviderGroups={setProviderGroups}
          revenueAdjustments={revenueAdjustments}
          setRevenueAdjustments={setRevenueAdjustments}
          providerAssignmentOverrides={providerAssignmentOverrides}
          setProviderAssignmentOverrides={setProviderAssignmentOverrides}
          knownStaff={knownStaff}
        />
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">Departments</h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Master data for the department-wise analysis (Wellness, Derma, Facial, Laser, Biohacking).
        </p>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <ServiceDepartmentEditor
            services={knownServices}
            records={serviceDepartmentRecords}
            batch={departmentMappingBatch}
            setDepartment={setServiceDepartment}
            importFile={importDepartmentMappingFile}
            onPullFromOneDrive={oneDrive.account ? () => oneDrive.pullFiles(ONEDRIVE_SUBFOLDERS.departmentMapping) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
