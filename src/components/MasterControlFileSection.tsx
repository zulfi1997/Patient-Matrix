import { useCallback, useRef, useState } from 'react';
import {
  buildMasterControlSheets,
  describeImport,
  MasterControlSchemaError,
  parseMasterControlWorkbook,
  type MasterControlSettings,
} from '../lib/masterControlFile';
import { downloadWorkbook } from '../lib/workbook';

/**
 * Share the hand-made configuration the same way the data is shared.
 *
 * Everything under Master Control lives in one browser on one machine, so two people looking at
 * the same sales files can legitimately see different figures with nothing on screen to explain
 * the gap. Exporting it as a workbook - not JSON - keeps it reviewable by the people who own the
 * decisions in it, and re-importable after they have corrected it.
 */
export function MasterControlFileSection({
  settings,
  applySettings,
  onPullFromOneDrive,
}: {
  settings: MasterControlSettings;
  applySettings: (incoming: Partial<MasterControlSettings>) => void;
  /** Present only when signed in to OneDrive - pulls every file from the configured "Master Control" subfolder. */
  onPullFromOneDrive?: () => Promise<File[]>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      await downloadWorkbook(
        `patient-matrix-settings-${new Date().toISOString().slice(0, 10)}.xlsx`,
        buildMasterControlSheets(settings),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build the settings file.');
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setError(null);
      setApplied(null);
      try {
        // Last file wins if several are dropped, rather than merging them - two settings files
        // disagreeing about the same section have no obvious resolution, and inventing one would
        // produce a configuration neither file describes.
        const file = files[files.length - 1];
        const incoming = await parseMasterControlWorkbook(await file.arrayBuffer());
        applySettings(incoming);
        setApplied(describeImport(incoming));
      } catch (e) {
        const message = e instanceof MasterControlSchemaError || e instanceof Error ? e.message : 'Failed to read this file.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [applySettings],
  );

  const pull = useCallback(async () => {
    if (!onPullFromOneDrive) return;
    setBusy(true);
    setError(null);
    try {
      const files = await onPullFromOneDrive();
      if (files.length === 0) {
        setError('No .xls/.xlsx files found in the "Master Control" OneDrive folder.');
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
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Every decision on this page - provider groups, reassignments, revenue adjustments, collection attribution,
        segment allocation and the analysis toggles - is stored in this browser only. Export it, put it in the shared
        OneDrive <strong>Master Control</strong> folder, and anyone else can import it so their dashboard agrees with
        yours. Each sheet replaces that section wholesale; a sheet left out of the file leaves that section untouched.
        The file is plain Excel, so it can be reviewed and corrected before it is shared.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={download}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Export settings'}
        </button>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-lg border border-indigo-300 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
        >
          Import settings
        </button>
        {onPullFromOneDrive && (
          <button
            onClick={pull}
            disabled={busy}
            className="rounded-lg border border-indigo-300 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            Pull from OneDrive
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length > 0) handleFiles(files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="whitespace-pre-line rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {applied && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {applied.length === 0 ? (
            <p>The file carried no settings, so nothing changed.</p>
          ) : (
            <>
              <p className="font-medium">Settings applied:</p>
              <ul className="mt-1 list-inside list-disc">
                {applied.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
