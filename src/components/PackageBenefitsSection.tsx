import { useCallback, useRef, useState } from 'react';
import type { PackageBenefitBatch } from '../types';
import type { PackageBenefitImportResult } from '../hooks/usePackageBenefits';
import { PackageBenefitSchemaError, PackageBenefitSnapshotDateError } from '../hooks/usePackageBenefits';
import { formatDate, formatNumber } from '../lib/format';

interface PackageBenefitsSectionProps {
  batches: PackageBenefitBatch[];
  importPackageBenefitFile: (file: File) => Promise<PackageBenefitImportResult>;
  removePackageBenefitSnapshot: (snapshotDate: string) => Promise<void>;
  clearAllPackageBenefits: () => Promise<void>;
  /** Present only when signed in to OneDrive - pulls every file from the configured "Package Benefit Data" subfolder. */
  onPullFromOneDrive?: () => Promise<File[]>;
}

export function PackageBenefitsSection({
  batches,
  importPackageBenefitFile,
  removePackageBenefitSnapshot,
  clearAllPackageBenefits,
  onPullFromOneDrive,
}: PackageBenefitsSectionProps) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PackageBenefitImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setError(null);
      setResults([]);
      const outcomes: PackageBenefitImportResult[] = [];
      const errors: string[] = [];
      for (const file of files) {
        try {
          outcomes.push(await importPackageBenefitFile(file));
        } catch (e) {
          const message =
            e instanceof PackageBenefitSchemaError || e instanceof PackageBenefitSnapshotDateError || e instanceof Error
              ? e.message
              : 'Failed to read this file.';
          errors.push(`${file.name}: ${message}`);
        }
      }
      setResults(outcomes);
      if (errors.length > 0) setError(errors.join('\n'));
      setBusy(false);
    },
    [importPackageBenefitFile],
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

  const pullFromOneDrive = useCallback(async () => {
    if (!onPullFromOneDrive) return;
    setBusy(true);
    setError(null);
    try {
      const files = await onPullFromOneDrive();
      if (files.length === 0) {
        setError('No .xls/.xlsx files found in the "Package Benefit Data" OneDrive folder.');
        setBusy(false);
        return;
      }
      await handleFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pull files from OneDrive.');
      setBusy(false);
    }
  }, [onPullFromOneDrive, handleFiles]);

  return (
    <div className="flex flex-col gap-4">
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
          Drag & drop a "Package Benefits Detail" export (.xlsx) here, or
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Choose file'}
          </button>
          {onPullFromOneDrive && (
            <button
              onClick={pullFromOneDrive}
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
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length > 0) handleFiles(files);
            e.target.value = '';
          }}
        />
        <p className="mt-3 text-xs text-zinc-400">
          This is a point-in-time snapshot ("As on: &lt;date&gt;"), not transactional history - re-upload it daily
          (ideally same-day) to power the Provider Conversion dashboard's "has package benefit balance" reason
          accurately for each day. Each upload replaces that date's snapshot. Select or drop multiple files (e.g.
          several days at once) to import them all in one go, or use "Pull from OneDrive" to import every file
          currently in the shared "Package Benefit Data" folder.
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
              <strong>{result.fileName}</strong>: {formatNumber(result.rowCount)} row(s) stored as the snapshot for{' '}
              {formatDate(result.snapshotDate)}.
            </p>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            Package Balance Snapshots ({formatNumber(batches.length)} date{batches.length === 1 ? '' : 's'})
          </h3>
          <button
            onClick={() => {
              // Naming the count makes the scale of it concrete - these accumulate one file a day,
              // so by the time anyone wants to clear them there are usually far more than expected.
              if (
                confirm(
                  `This deletes ALL ${formatNumber(batches.length)} package balance snapshot(s) from this browser. ` +
                    'The Provider Conversion dashboard will lose the "has package benefit balance" reason until ' +
                    'snapshots are re-imported, and $0-revenue repeat visits with a real balance will show as ' +
                    '"Repeat Unconverted" instead. This cannot be undone. Continue?',
                )
              ) {
                clearAllPackageBenefits();
              }
            }}
            disabled={batches.length === 0}
            className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            Clear all snapshots
          </button>
        </div>
        {batches.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No snapshots yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">As On Date</th>
                <th className="py-2 pr-2">File</th>
                <th className="py-2 pr-2">Uploaded</th>
                <th className="py-2 pr-2 text-right">Rows</th>
                <th className="py-2 pr-2" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.snapshotDate} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2 font-medium">{formatDate(b.snapshotDate)}</td>
                  <td className="py-1.5 pr-2">{b.fileName}</td>
                  <td className="py-1.5 pr-2">{new Date(b.uploadedAt).toLocaleString('en-GB')}</td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(b.rowCount)}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Remove the package balance snapshot for ${formatDate(b.snapshotDate)}?`)) {
                          removePackageBenefitSnapshot(b.snapshotDate);
                        }
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
    </div>
  );
}
