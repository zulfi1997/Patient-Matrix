import type { PnlLineRecord, PnlSection } from '../types';
import { hashString } from './hash';
import { parseNumber } from './parseUtils';

export class PnlSchemaError extends Error {
  constructor() {
    super(
      'This doesn\'t look like a Zoho Books "Income Statement Segment Wise" export - could not find the expected report table/columns.',
    );
  }
}

export class PnlDateRangeError extends Error {
  constructor() {
    super('Could not find the "Date From" / "Date To" range in this file\'s header.');
  }
}

const SECTION_MAP: Record<string, PnlSection> = {
  'INCOME': 'income',
  'COST OF GOODS SOLD': 'cogs',
  'EXPENSE': 'expense',
  'OTHER INCOME': 'otherIncome',
  'OTHER EXPENSE': 'otherExpense',
};

/**
 * Clinic-requested regroupings that override where a specific account lands, regardless of which
 * section/group the raw export puts it under (e.g. "Bank Charges" is exported under OTHER
 * EXPENSE, but the clinic wants it alongside "Interest Expenses" under EXPENSE > Finance and
 * Other Expenses). Checked by exact (case-insensitive) description match; first match wins.
 */
const LINE_OVERRIDES: { match: RegExp; section?: PnlSection; group?: string }[] = [
  { match: /^Depreciation Account$/i, group: 'Depreciation' },
  { match: /^Bank Charges$/i, section: 'expense', group: 'Finance and Other Expenses' },
];

/** Group-heading relabels applied to every line still under that heading (not just overridden ones). */
const GROUP_LABEL_OVERRIDES: Record<string, string> = {
  'Expense - Accounts': 'Administration Expenses',
};

function applyLineOverrides(
  section: PnlSection,
  group: string | null,
  description: string,
): { section: PnlSection; group: string | null } {
  for (const rule of LINE_OVERRIDES) {
    if (rule.match.test(description)) {
      return { section: rule.section ?? section, group: rule.group ?? group };
    }
  }
  return { section, group: group != null ? (GROUP_LABEL_OVERRIDES[group] ?? group) : group };
}

/** The 7 standardized section-subtotal rows Zoho always labels the same way - captured for cross-checking our own re-derived totals against the report's, not stored as line records. */
const STANDARD_TOTAL_LABELS: Record<string, keyof PnlReportedTotals> = {
  'TOTAL INCOME': 'totalIncome',
  'TOTAL COST OF GOODS SOLD': 'totalCogs',
  'GROSS PROFIT': 'grossProfit',
  'TOTAL EXPENSE': 'totalExpense',
  'TOTAL OTHER INCOME': 'totalOtherIncome',
  'TOTAL OTHER EXPENSE': 'totalOtherExpense',
  'NET PROFIT / LOSS': 'netProfit',
};

export interface PnlReportedTotals {
  totalIncome: number;
  totalCogs: number;
  grossProfit: number;
  totalExpense: number;
  totalOtherIncome: number;
  totalOtherExpense: number;
  netProfit: number;
}

export interface PnlParseOutcome {
  month: string; // ISO yyyy-mm-01
  segments: string[];
  records: PnlLineRecord[];
  /** Zoho's own stated section subtotals per segment, for the import UI to cross-check our re-derived totals against - not persisted. */
  reportedTotals: Map<string, PnlReportedTotals>;
}

function parseDateDDMMYYYY(s: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parses a Zoho Books "Income Statement Segment Wise" export - saved as .xls but is actually an
 * HTML table. Line items are matched by CSS class semantics (mainCategoryHead/subCategoryHead
 * for section/group headers, reportsubtotal/reporttotalblack for subtotal rows), not by fixed
 * row position or a hardcoded account list, since the exact accounts present vary month to month
 * (an account only appears in a given month's export if it had activity that month).
 */
export function parsePnlWorkbook(html: string): PnlParseOutcome {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table#tbl_report') ?? doc.querySelector('table');
  if (!table) throw new PnlSchemaError();

  const bodyText = doc.body.textContent ?? '';
  const dateMatch = /Date From\s*:\s*(\d{2}-\d{2}-\d{4})\s*-\s*Date To\s*:\s*(\d{2}-\d{2}-\d{4})/.exec(bodyText);
  if (!dateMatch) throw new PnlDateRangeError();
  const fromISO = parseDateDDMMYYYY(dateMatch[1]);
  if (!fromISO) throw new PnlDateRangeError();
  const month = `${fromISO.slice(0, 7)}-01`;

  const headerCells = [...table.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim());
  const descColIdx = headerCells.findIndex((h) => /description/i.test(h));
  const totalColIdx = headerCells.findIndex((h) => /^total$/i.test(h));
  if (descColIdx === -1 || totalColIdx === -1 || totalColIdx <= descColIdx) throw new PnlSchemaError();

  const segmentCols: { index: number; segment: string }[] = [];
  for (let i = descColIdx + 1; i < totalColIdx; i++) {
    if (headerCells[i]) segmentCols.push({ index: i, segment: headerCells[i] });
  }
  if (segmentCols.length === 0) throw new PnlSchemaError();

  const rows = [...table.querySelectorAll('tbody tr')];
  const records: PnlLineRecord[] = [];
  const reportedTotals = new Map<string, PnlReportedTotals>();
  for (const seg of segmentCols) {
    reportedTotals.set(seg.segment, {
      totalIncome: 0, totalCogs: 0, grossProfit: 0, totalExpense: 0, totalOtherIncome: 0, totalOtherExpense: 0, netProfit: 0,
    });
  }

  let currentSection: PnlSection | null = null;
  let currentGroup: string | null = null;
  const occurrence = new Map<string, number>();

  for (const row of rows) {
    const cells = [...row.children] as HTMLTableCellElement[];
    if (cells.length === 0) continue;
    const firstCellText = (cells[0].textContent ?? '').trim();
    if (!firstCellText) continue; // blank spacer row

    const mainHead = cells[0].querySelector('.mainCategoryHead');
    if (mainHead) {
      currentSection = SECTION_MAP[(mainHead.textContent ?? '').trim().toUpperCase()] ?? null;
      currentGroup = null;
      continue;
    }
    const subHead = cells[0].querySelector('.subCategoryHead');
    if (subHead) {
      currentGroup = (subHead.textContent ?? '').trim();
      continue;
    }
    if (cells.length < 2) continue; // header-only row with no amount columns

    const isTotalRow = cells.some((c) => /reportsubtotal|reporttotalblack/.test(c.className));
    const description = firstCellText.replace(/\s+/g, ' ').trim();

    if (isTotalRow) {
      const stdKey = STANDARD_TOTAL_LABELS[description.toUpperCase()];
      if (stdKey) {
        for (const seg of segmentCols) {
          const cell = cells[seg.index];
          reportedTotals.get(seg.segment)![stdKey] = cell ? parseNumber(cell.textContent) : 0;
        }
      }
      continue; // subtotal rows are re-derived from leaves, never stored as leaf records themselves
    }

    if (!currentSection) continue; // defensive - shouldn't happen once past the first section header

    const { section: finalSection, group: finalGroup } = applyLineOverrides(currentSection, currentGroup, description);

    for (const seg of segmentCols) {
      const cell = cells[seg.index];
      if (!cell) continue;
      const amount = parseNumber(cell.textContent);
      if (amount === 0) continue;

      const key = `${month}|${seg.segment}|${finalSection}|${finalGroup ?? ''}|${description}`;
      const occCount = (occurrence.get(key) ?? 0) + 1;
      occurrence.set(key, occCount);

      records.push({
        id: hashString(`${key}|${occCount}`),
        month,
        segment: seg.segment,
        section: finalSection,
        group: finalGroup,
        description,
        amount,
      });
    }
  }

  return { month, segments: segmentCols.map((s) => s.segment), records, reportedTotals };
}
