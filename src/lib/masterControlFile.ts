import type { CollectionAttributionOverride, PnlSection } from '../types';
import type { ProviderAssignmentOverride, ProviderGroup, RevenueAdjustment } from './conversionMetrics';
import { isRevenueTypeKey } from './revenueTypes';
import type { AllocationMode, PnlLineAdjustment, SegmentAllocationRule } from './segmentAllocation';
import type { WorkbookSheet } from './workbook';

/**
 * Everything a person configures by hand, in one portable file.
 *
 * All of it lives in the browser's localStorage, which means it exists for exactly one person on
 * exactly one machine. Two people looking at the same sales data therefore see different figures,
 * with nothing on screen to say why. This is the settings equivalent of the data files: export it,
 * put it in the shared folder, and everyone's dashboard agrees.
 *
 * The format is a workbook rather than JSON so it can be read and edited by the people who own the
 * decisions in it - a provider group is easier to check in a spreadsheet than in braces.
 */
export interface MasterControlSettings {
  providerGroups: ProviderGroup[];
  providerAssignmentOverrides: ProviderAssignmentOverride[];
  revenueAdjustments: RevenueAdjustment[];
  collectionAttributionOverrides: CollectionAttributionOverride[];
  allocationRules: SegmentAllocationRule[];
  pnlLineAdjustments: PnlLineAdjustment[];
  allocationMode: AllocationMode;
  excludeFlagged: boolean;
  excludeZeroValue: boolean;
}

export const MASTER_CONTROL_SHEETS = {
  readMe: 'Read Me',
  groups: 'Provider Groups',
  reassignments: 'Temporary Reassignments',
  revenue: 'Revenue Adjustments',
  collection: 'Collection Attribution',
  allocation: 'Segment Allocation',
  pnlAdjustments: 'P&L Line Adjustments',
  toggles: 'Toggles',
} as const;

export class MasterControlSchemaError extends Error {
  constructor() {
    super(
      'This doesn\'t look like a Patient Matrix settings file - none of the expected sheets were found (Provider Groups, Temporary Reassignments, Revenue Adjustments, Collection Attribution, Segment Allocation, P&L Line Adjustments, Toggles).',
    );
  }
}

const YES = (v: boolean) => (v ? 'Yes' : 'No');
const truthy = (v: unknown) => ['yes', 'true', '1', 'y'].includes(String(v ?? '').trim().toLowerCase());
const text = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Aliases are one per row rather than a delimited list in a single cell.
 *
 * A doctor with six assisting nurses would otherwise be an unreadable run of semicolons, and
 * anyone editing it in Excel would have to get the delimiter exactly right. One row per alias
 * sorts, filters and edits like any other spreadsheet.
 */
export function buildMasterControlSheets(s: MasterControlSettings): WorkbookSheet[] {
  return [
    {
      name: MASTER_CONTROL_SHEETS.readMe,
      rows: [
        { Item: 'What this is', Detail: 'Every Master Control decision made by hand: provider groups, reassignments, revenue adjustments, collection attribution, segment allocation and the analysis toggles.' },
        { Item: 'Why it exists', Detail: 'These settings live in one browser on one machine. Without this file, two people looking at the same sales data see different figures and nothing on screen says why.' },
        { Item: 'How to share it', Detail: 'Put it in the shared OneDrive "Master Control" folder. Anyone can then import it on the Data tab and their dashboard will agree with yours.' },
        { Item: 'Importing', Detail: 'Each sheet replaces that section wholesale. A sheet left out of the file leaves that section untouched, so a file carrying only Provider Groups will not wipe your Revenue Adjustments.' },
        { Item: 'Editing', Detail: 'Safe to edit here and re-import. The Id column may be left blank on a new row - one will be generated. Deleting a row removes that setting.' },
        { Item: 'Not included', Detail: 'The sales, collections, package-benefit and P&L files themselves, and the service-to-department mapping, which has its own import. Also personal view preferences - selected period, chosen provider - which are nobody else\'s business.' },
        { Item: 'Exported', Detail: new Date().toISOString() },
      ],
    },
    {
      name: MASTER_CONTROL_SHEETS.groups,
      rows: s.providerGroups.flatMap((g) =>
        (g.aliases.length > 0 ? g.aliases : ['']).map((alias) => ({
          Id: g.id,
          'Canonical Provider': g.canonicalName,
          Alias: alias,
        })),
      ),
    },
    {
      name: MASTER_CONTROL_SHEETS.reassignments,
      rows: s.providerAssignmentOverrides.map((o) => ({
        Id: o.id, Staff: o.staffName, 'Covering For': o.canonicalName,
        From: o.startDate, To: o.endDate, Note: o.note,
      })),
    },
    {
      name: MASTER_CONTROL_SHEETS.revenue,
      rows: s.revenueAdjustments.map((a) => ({
        Id: a.id, Date: a.date, From: a.fromProvider, To: a.toProvider,
        Amount: a.amount, Type: a.itemType ?? '', Note: a.note,
      })),
    },
    {
      name: MASTER_CONTROL_SHEETS.collection,
      rows: s.collectionAttributionOverrides.map((o) => ({
        Id: o.id, 'Invoice No': o.invoiceNo, Provider: o.provider, Note: o.note,
      })),
    },
    {
      name: MASTER_CONTROL_SHEETS.allocation,
      rows: s.allocationRules.map((r) => ({
        Id: r.id, 'Effective From': r.effectiveFrom, Segment: r.segment, 'Percent': r.percent,
      })),
    },
    {
      name: MASTER_CONTROL_SHEETS.pnlAdjustments,
      rows: s.pnlLineAdjustments.map((a) => ({
        Id: a.id, Month: a.month, Segment: a.segment, Section: a.section,
        Group: a.group ?? '', Description: a.description, Amount: a.amount, Note: a.note,
      })),
    },
    {
      name: MASTER_CONTROL_SHEETS.toggles,
      rows: [
        { Setting: 'Allocation Mode', Value: s.allocationMode },
        { Setting: 'Exclude YB111-flagged transactions', Value: YES(s.excludeFlagged) },
        { Setting: 'Exclude zero-revenue visits', Value: YES(s.excludeZeroValue) },
      ],
    },
  ];
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Reads a settings workbook back.
 *
 * Every section is optional and returned only when its sheet is present, so a caller can apply
 * exactly what the file carried and leave the rest of someone's configuration alone. A file with
 * no recognisable sheet at all is an error rather than a silent no-op - that is almost always the
 * wrong file, and quietly doing nothing would look like it worked.
 */
export async function parseMasterControlWorkbook(buffer: ArrayBuffer): Promise<Partial<MasterControlSettings>> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

  const rowsOf = (name: string): Record<string, unknown>[] | null => {
    const ws = wb.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: false }) : null;
  };

  const out: Partial<MasterControlSettings> = {};
  let matchedAnySheet = false;

  const groups = rowsOf(MASTER_CONTROL_SHEETS.groups);
  if (groups) {
    matchedAnySheet = true;
    // Rebuilt by canonical name rather than by Id, so someone can add an alias row by hand without
    // having to copy the right Id into it.
    const byName = new Map<string, ProviderGroup>();
    for (const r of groups) {
      const canonicalName = text(r['Canonical Provider']);
      if (!canonicalName) continue;
      let group = byName.get(canonicalName.toLowerCase());
      if (!group) {
        group = { id: text(r.Id) || newId(), canonicalName, aliases: [] };
        byName.set(canonicalName.toLowerCase(), group);
      }
      const alias = text(r.Alias);
      if (alias && !group.aliases.includes(alias)) group.aliases.push(alias);
    }
    out.providerGroups = [...byName.values()].filter((g) => g.aliases.length > 0);
  }

  const reassignments = rowsOf(MASTER_CONTROL_SHEETS.reassignments);
  if (reassignments) {
    matchedAnySheet = true;
    out.providerAssignmentOverrides = reassignments
      .filter((r) => text(r.Staff) && text(r['Covering For']) && text(r.From) && text(r.To))
      .map((r) => ({
        id: text(r.Id) || newId(),
        staffName: text(r.Staff),
        canonicalName: text(r['Covering For']),
        startDate: text(r.From),
        endDate: text(r.To),
        note: text(r.Note),
      }));
  }

  const revenue = rowsOf(MASTER_CONTROL_SHEETS.revenue);
  if (revenue) {
    matchedAnySheet = true;
    out.revenueAdjustments = revenue
      .filter((r) => text(r.Date) && text(r.From) && text(r.To) && num(r.Amount) !== 0)
      .map((r) => {
        const itemType = text(r.Type);
        return {
          id: text(r.Id) || newId(),
          date: text(r.Date),
          fromProvider: text(r.From),
          toProvider: text(r.To),
          amount: num(r.Amount),
          note: text(r.Note),
          ...(isRevenueTypeKey(itemType) ? { itemType } : {}),
        };
      });
  }

  const collection = rowsOf(MASTER_CONTROL_SHEETS.collection);
  if (collection) {
    matchedAnySheet = true;
    out.collectionAttributionOverrides = collection
      .filter((r) => text(r['Invoice No']) && text(r.Provider))
      .map((r) => ({
        id: text(r.Id) || newId(),
        invoiceNo: text(r['Invoice No']),
        provider: text(r.Provider),
        note: text(r.Note),
      }));
  }

  const allocation = rowsOf(MASTER_CONTROL_SHEETS.allocation);
  if (allocation) {
    matchedAnySheet = true;
    out.allocationRules = allocation
      .filter((r) => text(r['Effective From']) && text(r.Segment))
      .map((r) => ({
        id: text(r.Id) || newId(),
        effectiveFrom: text(r['Effective From']),
        segment: text(r.Segment),
        percent: num(r.Percent),
      }));
  }

  const pnl = rowsOf(MASTER_CONTROL_SHEETS.pnlAdjustments);
  if (pnl) {
    matchedAnySheet = true;
    out.pnlLineAdjustments = pnl
      .filter((r) => text(r.Month) && text(r.Segment) && text(r.Section))
      .map((r) => ({
        id: text(r.Id) || newId(),
        month: text(r.Month),
        segment: text(r.Segment),
        section: text(r.Section) as PnlSection,
        group: text(r.Group) || null,
        description: text(r.Description),
        amount: num(r.Amount),
        note: text(r.Note),
      }));
  }

  const toggles = rowsOf(MASTER_CONTROL_SHEETS.toggles);
  if (toggles) {
    matchedAnySheet = true;
    const find = (setting: string) => toggles.find((r) => text(r.Setting).toLowerCase() === setting.toLowerCase())?.Value;
    const mode = text(find('Allocation Mode')).toLowerCase();
    if (mode === 'percentage' || mode === 'revenue') out.allocationMode = mode;
    const flagged = find('Exclude YB111-flagged transactions');
    if (flagged != null) out.excludeFlagged = truthy(flagged);
    const zero = find('Exclude zero-revenue visits');
    if (zero != null) out.excludeZeroValue = truthy(zero);
  }

  if (!matchedAnySheet) throw new MasterControlSchemaError();
  return out;
}

/** What an import changed, so the confirmation can say more than "done". */
export function describeImport(settings: Partial<MasterControlSettings>): string[] {
  const lines: string[] = [];
  const count = (label: string, arr: unknown[] | undefined) => {
    if (arr) lines.push(`${label}: ${arr.length}`);
  };
  count('Provider Groups', settings.providerGroups);
  count('Temporary Reassignments', settings.providerAssignmentOverrides);
  count('Revenue Adjustments', settings.revenueAdjustments);
  count('Collection Attribution', settings.collectionAttributionOverrides);
  count('Segment Allocation rules', settings.allocationRules);
  count('P&L Line Adjustments', settings.pnlLineAdjustments);
  if (settings.allocationMode) lines.push(`Allocation Mode: ${settings.allocationMode}`);
  if (settings.excludeFlagged != null) lines.push(`Exclude YB111: ${settings.excludeFlagged ? 'on' : 'off'}`);
  if (settings.excludeZeroValue != null) lines.push(`Exclude zero-revenue visits: ${settings.excludeZeroValue ? 'on' : 'off'}`);
  return lines;
}
