import { useState } from 'react';
import { downloadWorkbook, type WorkbookSheet } from '../lib/workbook';

/**
 * Shared "Export to Excel" control. Takes a builder rather than the sheets themselves so nothing
 * is assembled until it is asked for - several of these sit on dashboards whose data is expensive
 * to flatten, and most sessions never press the button.
 */
export function ExportExcelButton({
  fileName,
  buildSheets,
  label = 'Export to Excel',
  disabled,
}: {
  fileName: string;
  buildSheets: () => WorkbookSheet[];
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadWorkbook(fileName, buildSheets());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build the workbook.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1 print:hidden">
      <button
        onClick={run}
        disabled={busy || disabled}
        className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? 'Building…' : label}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </span>
  );
}
