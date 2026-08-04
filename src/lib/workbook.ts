export interface WorkbookSheet {
  name: string;
  rows: Record<string, unknown>[];
}

/** Rounded to fils and kept numeric - a pivot cannot sum a formatted string like "OMR 1,234.000". */
export const money = (n: number) => Math.round(n * 1000) / 1000;

/** One decimal, or blank where the rate is undefined rather than zero. */
export const pct = (n: number | null | undefined) => (n == null ? '' : Math.round(n * 10) / 10);

/**
 * Excel rejects sheet names over 31 characters or containing []:*?/\, and silently corrupts the
 * workbook rather than reporting it. Names are also deduplicated, since two truncated names can
 * collide.
 */
function sanitizeSheetNames(sheets: WorkbookSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = (s.name.replace(/[[\]:*?/\\]/g, '-').trim() || `Sheet${i + 1}`).slice(0, 31);
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` ${n++}`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** Sizes columns from their content so the workbook opens readable rather than full of ####. */
function columnWidths(rows: Record<string, unknown>[]): { wch: number }[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).map((key) => {
    const longest = rows.reduce((max, r) => Math.max(max, String(r[key] ?? '').length), key.length);
    return { wch: Math.min(46, Math.max(9, longest + 2)) };
  });
}

/**
 * Writes and downloads a multi-sheet workbook.
 *
 * Shared by every dashboard's export so they cannot drift apart on the things that quietly break a
 * workbook - sheet-name limits, unreadable column widths, and a sheet with no rows, which
 * json_to_sheet turns into an empty sheet with no indication whether the export failed or the
 * period genuinely had nothing in it.
 */
export async function downloadWorkbook(fileName: string, sheets: WorkbookSheet[]): Promise<void> {
  // Lazily loaded for the same reason excelParser.ts defers it: xlsx is large and only needed
  // when someone actually exports.
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const names = sanitizeSheetNames(sheets);

  sheets.forEach((sheet, i) => {
    const ws =
      sheet.rows.length > 0
        ? XLSX.utils.json_to_sheet(sheet.rows)
        : XLSX.utils.aoa_to_sheet([['No data for this selection']]);
    if (sheet.rows.length > 0) ws['!cols'] = columnWidths(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, names[i]);
  });

  XLSX.writeFile(wb, fileName);
}
