import type { PackageBenefitRecord } from '../types';
import { hashString } from './hash';
import { parseNumber, parseTitleDate } from './parseUtils';

function normalizeHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const REQUIRED_COLUMNS = ['invoice no', 'guest name', 'benefit name', 'balance quantity'];

export class PackageBenefitSchemaError extends Error {
  constructor() {
    super(
      'This doesn\'t look like a Zenoti "Package Benefits Detail" export - could not find the expected columns (Invoice No, Guest Name, Benefit Name, Balance Quantity).',
    );
  }
}

export class PackageBenefitSnapshotDateError extends Error {
  constructor() {
    super('Could not find the "As on" date in this file\'s title rows - expected a line like "As on : 17 Jul 2026".');
  }
}

export interface PackageBenefitParseOutcome {
  snapshotDate: string;
  records: PackageBenefitRecord[];
}

/**
 * Parses a Zenoti "Package Benefits Detail" export: a few title rows (including an
 * "As on : <date>" line), a header row, then one row per package benefit line.
 */
export async function parsePackageBenefitWorkbook(buffer: ArrayBuffer): Promise<PackageBenefitParseOutcome> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });

  let snapshotDate: string | null = null;
  let headerRowIndex = -1;
  let columnIndex = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    if (!snapshotDate) {
      for (const cell of row) {
        const m = /as on\s*:\s*([^,]+?)(?:\s{2,}|$)/i.exec(String(cell ?? ''));
        if (m) {
          snapshotDate = parseTitleDate(m[1].trim());
          break;
        }
      }
    }

    const normalized = row.map(normalizeHeader);
    if (REQUIRED_COLUMNS.every((c) => normalized.includes(c))) {
      headerRowIndex = i;
      columnIndex = new Map(normalized.map((name, idx) => [name, idx]));
      break;
    }
  }

  if (!snapshotDate) throw new PackageBenefitSnapshotDateError();
  if (headerRowIndex === -1) throw new PackageBenefitSchemaError();

  const get = (row: unknown[], name: string): unknown => {
    const idx = columnIndex.get(name);
    return idx == null ? null : row[idx];
  };

  const records: PackageBenefitRecord[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const invoiceNo = String(get(row, 'invoice no') ?? '').trim();
    const guestName = String(get(row, 'guest name') ?? '').trim();
    const benefitName = String(get(row, 'benefit name') ?? '').trim();
    if (!invoiceNo || !guestName || !benefitName) continue;

    const id = hashString(`${snapshotDate}|${invoiceNo}|${benefitName}|${i}`);

    records.push({
      id,
      snapshotDate,
      saleCenter: String(get(row, 'sale center') ?? '').trim(),
      invoiceNo,
      packageCode: (get(row, 'package code') as string) || null,
      packageName: String(get(row, 'package name') ?? '').trim(),
      packageCategory: String(get(row, 'package category') ?? '').trim(),
      guestName,
      benefitType: String(get(row, 'benefit type') ?? '').trim(),
      benefitName,
      accruedQty: parseNumber(get(row, 'accrued quantity')),
      value: parseNumber(get(row, 'value')),
      redeemedQty: parseNumber(get(row, 'redeemed quantity')),
      redeemedValue: parseNumber(get(row, 'redeemed value')),
      balanceQty: parseNumber(get(row, 'balance quantity')),
      packageStatus: String(get(row, 'package status') ?? '').trim(),
    });
  }

  return { snapshotDate, records };
}
