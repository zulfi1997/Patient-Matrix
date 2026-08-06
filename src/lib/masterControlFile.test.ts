import { describe, expect, it } from 'vitest';
import {
  buildMasterControlSheets,
  describeImport,
  MasterControlSchemaError,
  parseMasterControlWorkbook,
  type MasterControlSettings,
} from './masterControlFile';

const settings: MasterControlSettings = {
  providerGroups: [
    { id: 'g1', canonicalName: 'Dr Obada', aliases: ['Rini Antony', 'Anuja Renchu'] },
    { id: 'g2', canonicalName: 'Dr Fatima', aliases: [] },
  ],
  providerAssignmentOverrides: [
    { id: 'o1', staffName: 'Rini Antony', canonicalName: 'Dr Fatima', startDate: '2026-07-10', endDate: '2026-07-12', note: 'leave cover' },
  ],
  revenueAdjustments: [
    { id: 'a1', date: '2026-07-28', fromProvider: 'Rini Antony', toProvider: 'Obada Khalouf 2', amount: 170, note: 'sold by rini', itemType: 'package' },
  ],
  collectionAttributionOverrides: [{ id: 'c1', invoiceNo: 'TBC25204', provider: 'Fatima', note: 'no seller on the line' }],
  allocationRules: [{ id: 'r1', effectiveFrom: '2026-01-01', segment: 'DERMA', percent: 40 }],
  pnlLineAdjustments: [
    { id: 'p1', month: '2026-07-01', segment: 'DERMA', section: 'expense', group: null, description: 'Rent', amount: -500, note: '' },
  ],
  allocationMode: 'revenue',
  excludeFlagged: true,
  excludeZeroValue: false,
};

const sheet = (name: string) => buildMasterControlSheets(settings).find((s) => s.name === name)!;

describe('buildMasterControlSheets', () => {
  it('writes one row per alias so the file edits like a spreadsheet', () => {
    // A doctor with six assisting nurses would be an unreadable run of semicolons in one cell, and
    // anyone editing it would have to get the delimiter exactly right.
    const rows = sheet('Provider Groups').rows;
    expect(rows).toEqual([
      { Id: 'g1', 'Canonical Provider': 'Dr Obada', Alias: 'Rini Antony' },
      { Id: 'g1', 'Canonical Provider': 'Dr Obada', Alias: 'Anuja Renchu' },
      { Id: 'g2', 'Canonical Provider': 'Dr Fatima', Alias: '' },
    ]);
  });

  it('carries the item type on a revenue adjustment', () => {
    expect(sheet('Revenue Adjustments').rows[0]).toMatchObject({ Amount: 170, Type: 'package', From: 'Rini Antony' });
  });

  it('writes the toggles as words rather than raw booleans', () => {
    expect(sheet('Toggles').rows).toEqual([
      { Setting: 'Allocation Mode', Value: 'revenue' },
      { Setting: 'Exclude YB111-flagged transactions', Value: 'Yes' },
      { Setting: 'Exclude zero-revenue visits', Value: 'No' },
    ]);
  });

  it('includes a Read Me saying why the file exists', () => {
    const items = sheet('Read Me').rows.map((r) => r.Item);
    expect(items).toContain('Why it exists');
    expect(items).toContain('Importing');
    expect(items).toContain('Not included');
  });
});

describe('describeImport', () => {
  it('reports only what the file carried', () => {
    // A partial file must not imply it changed sections it said nothing about.
    expect(describeImport({ providerGroups: settings.providerGroups })).toEqual(['Provider Groups: 2']);
  });

  it('names a toggle even when it is off, since off is a decision', () => {
    expect(describeImport({ excludeZeroValue: false })).toEqual(['Exclude zero-revenue visits: off']);
  });

  it('says nothing at all for an empty result', () => {
    expect(describeImport({})).toEqual([]);
  });
});

/** Serializes exactly as downloadWorkbook does, so the round trip is over a real .xlsx. */
async function toBuffer(sheets: ReturnType<typeof buildMasterControlSheets>): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return out as ArrayBuffer;
}

describe('round trip', () => {
  it('reads back everything it wrote', async () => {
    // The whole point of the file: what one person exports is what another person gets. Anything
    // lost here is a setting that silently differs between two dashboards.
    const parsed = await parseMasterControlWorkbook(await toBuffer(buildMasterControlSheets(settings)));

    expect(parsed.providerGroups).toEqual([{ id: 'g1', canonicalName: 'Dr Obada', aliases: ['Rini Antony', 'Anuja Renchu'] }]);
    expect(parsed.providerAssignmentOverrides).toEqual(settings.providerAssignmentOverrides);
    expect(parsed.revenueAdjustments).toEqual(settings.revenueAdjustments);
    expect(parsed.collectionAttributionOverrides).toEqual(settings.collectionAttributionOverrides);
    expect(parsed.allocationRules).toEqual(settings.allocationRules);
    expect(parsed.pnlLineAdjustments).toEqual(settings.pnlLineAdjustments);
    expect(parsed.allocationMode).toBe('revenue');
    expect(parsed.excludeFlagged).toBe(true);
    expect(parsed.excludeZeroValue).toBe(false);
  });

  it('drops a group left with no aliases, since it groups nothing', async () => {
    // Dr Fatima was exported with a blank alias row to keep the sheet readable; reading it back as
    // a real group would create one that folds nobody into anybody.
    const parsed = await parseMasterControlWorkbook(await toBuffer(buildMasterControlSheets(settings)));
    expect(parsed.providerGroups!.map((g) => g.canonicalName)).not.toContain('Dr Fatima');
  });

  it('rebuilds a group from an alias row typed in by hand with no Id', async () => {
    const sheets = buildMasterControlSheets(settings).map((s) =>
      s.name === 'Provider Groups'
        ? { ...s, rows: [...s.rows, { Id: '', 'Canonical Provider': 'Dr Obada', Alias: 'New Nurse' }] }
        : s,
    );
    const parsed = await parseMasterControlWorkbook(await toBuffer(sheets));
    expect(parsed.providerGroups![0].aliases).toEqual(['Rini Antony', 'Anuja Renchu', 'New Nurse']);
  });

  it('returns only the sections present, so a partial file leaves the rest alone', async () => {
    const only = buildMasterControlSheets(settings).filter((s) => s.name === 'Revenue Adjustments');
    const parsed = await parseMasterControlWorkbook(await toBuffer(only));
    expect(Object.keys(parsed)).toEqual(['revenueAdjustments']);
  });

  it('rejects a workbook that is not a settings file rather than doing nothing quietly', async () => {
    const wrong = [{ name: 'Collections', rows: [{ Anything: 1 }] }];
    await expect(parseMasterControlWorkbook(await toBuffer(wrong))).rejects.toThrow(MasterControlSchemaError);
  });

  it('keeps an empty section empty rather than treating it as absent', async () => {
    // Deleting every row is how someone removes all their adjustments; that has to survive the
    // trip, or the import would silently keep the recipient's old ones.
    const cleared = { ...settings, revenueAdjustments: [] };
    const parsed = await parseMasterControlWorkbook(await toBuffer(buildMasterControlSheets(cleared)));
    expect(parsed.revenueAdjustments).toEqual([]);
  });
});
