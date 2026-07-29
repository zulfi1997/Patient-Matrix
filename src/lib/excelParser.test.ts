import { describe, expect, it } from 'vitest';
import { rowsToRecords } from './excelParser';
import { headerMapFor } from '../test/fixtures';

function parseOne(row: Record<string, unknown>, batchId = 'b1') {
  const { records } = rowsToRecords([row], headerMapFor([row]), batchId);
  return records[0];
}

const BASE = {
  'Invoice No': 'TBC900',
  'Guest Code': 'MUS1023',
  'Guest Name': 'Rim ben Hmida',
  'Sale Date': '7/5/2026',
  'Item Name': 'HydraFacial',
  'Item Type': 'Service',
  Qty: 1,
  'Sales (Exc. Tax)': 120,
  'Invoice status': 'Closed',
};

describe('rowsToRecords', () => {
  it('derives serviceKey from Item Code when the column is present', () => {
    expect(parseOne({ ...BASE, 'Item Code': 'SVC-HF' }).serviceKey).toBe('code:SVC-HF');
  });

  it('falls back to an item-type bucket when Item Code is absent', () => {
    // "Item Code" is not a required header, so the two ingest paths disagree on serviceKey for the
    // same physical line: a manual export without it yields "type:Service" where the Zenoti API
    // sync yields "code:<code>". Anything matching rows across sources must not key on serviceKey.
    expect(parseOne(BASE).serviceKey).toBe('type:Service');
  });

  it('uses the source Invoice Item ID as the row id when present', () => {
    // Lets a later price/discount correction refresh the row in place instead of adding a second.
    expect(parseOne({ ...BASE, 'Invoice Item ID': 'abc-123' }).id).toBe('zenoti-item:abc-123');
  });

  it('derives a content-hash id when the source has no stable per-line id', () => {
    const id = parseOne(BASE).id;
    expect(id).not.toContain('zenoti-item:');
    expect(id).toBeTruthy();
  });

  it('gives the same line different ids across the two ingest paths', () => {
    // The root of the double-counting: content hash vs stable source id never collide, so an
    // overlapping import adds a second row rather than deduping against the first.
    const manual = parseOne({ ...BASE, 'Item Code': 'SVC-HF' });
    const synced = parseOne({ ...BASE, 'Item Code': 'SVC-HF', 'Invoice Item ID': 'abc-123' });
    expect(manual.id).not.toBe(synced.id);
    // Everything a match would rely on still agrees - which is why replacement is done by date.
    expect(manual.invoiceNo).toBe(synced.invoiceNo);
    expect(manual.serviceName).toBe(synced.serviceName);
    expect(manual.date).toBe(synced.date);
    expect(manual.qty).toBe(synced.qty);
  });

  it('parses M/D/YYYY sale dates to ISO', () => {
    expect(parseOne(BASE).date).toBe('2026-07-05');
  });

  it('splits Sales (Exc. Tax) into revenue and package redemption', () => {
    // Consuming a previously-sold package is not new revenue; it was recognized when the package
    // itself was sold, so it is reported separately rather than added again.
    const r = parseOne({ ...BASE, 'Payment Type': 'Package - LHR Beard Half (3 Sessions) - Original', Redeemed: 120 });
    expect(r.amount).toBe(0);
    expect(r.redeemedAmount).toBe(120);
    expect(r.packageName).toBe('LHR Beard Half (3 Sessions)');
  });

  it('counts paying by prepaid card as revenue, not package redemption', () => {
    // Redeeming stored value to pay for a new purchase IS the sale happening now.
    const r = parseOne({ ...BASE, 'Payment Type': 'Prepaid Card(OMR 500)', Redeemed: 120 });
    expect(r.amount).toBe(120);
    expect(r.redeemedAmount).toBe(0);
    expect(r.packageName).toBeNull();
  });

  it('collapses per-patient custom package names to a stable category label', () => {
    const r = parseOne({ ...BASE, 'Payment Type': 'Package - derma-Custom Package-Amal-20250324152258', Redeemed: 50 });
    expect(r.packageName).toBe('Derma Custom Package');
  });

  it('skips and reports a row missing required fields instead of storing it', () => {
    const rows = [{ ...BASE, 'Invoice No': '' }];
    const { records, warnings } = rowsToRecords(rows, headerMapFor(rows), 'b1');
    expect(records).toHaveLength(0);
    expect(warnings[0].message).toContain('Invoice No');
  });

  it('defaults centerName so replacement scoping always has a value to compare', () => {
    expect(parseOne(BASE).centerName).toBe('Default');
    expect(parseOne({ ...BASE, 'Center Name': 'Main' }).centerName).toBe('Main');
  });
});
