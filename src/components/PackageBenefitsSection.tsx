import { useCallback, useRef, useState } from 'react';
import type { PackageBenefitBatch } from '../types';
import type { PackageBenefitImportResult } from '../hooks/usePackageBenefits';
import { PackageBenefitSchemaError, PackageBenefitSnapshotDateError } from '../hooks/usePackageBenefits';
import { formatDate, formatNumber } from '../lib/format';

interface PackageBenefitsSectionProps {
  batches: PackageBenefitBatch[];
  importPackageBenefitFile: (file: File) => Promise<PackageBenefitImportResult>;
  removePackageBenefitSnapshot: (snapshotDate: string) => Promise<void>;
}

export function PackageBenefitsSection({ batches, importPackageBenefitFile, removePackageBenefitSnapshot }: PackageBenefitsSectionProps) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PackageBenefitImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const res = await importPackageBenefitFile(file);
        setResult(res);
      } catch (e) {
        if (e instanceof PackageBenefitSchemaError || e instanceof PackageBenefitSnapshotDateError) {
          setError(e.message);
        } else {
          setError(e instanceof Error ? e.message : 'Failed to read this file.');
        }
      } finally {
        setBusy(false);
      }
    },
    [importPackageBenefitFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

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
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Choose file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        <p className="mt-3 text-xs text-zinc-400">
          This is a point-in-time snapshot ("As on: &lt;date&gt;"), not transactional history - re-upload it daily
          (ideally same-day) to power the Provider Conversion dashboard's "has package benefit balance" reason
          accurately for each day. Each upload replaces that date's snapshot.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <strong>{result.fileName}</strong>: {formatNumber(result.rowCount)} row(s) stored as the snapshot for{' '}
          {formatDate(result.snapshotDate)}.
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Package Balance Snapshots ({formatNumber(batches.length)} date{batches.length === 1 ? '' : 's'})
        </h3>
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
