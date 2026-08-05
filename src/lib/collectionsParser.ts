import type { CollectionMethod, CollectionRecord } from '../types';
import { hashString } from './hash';
import { parseFlexibleDate, parseNumber, parseTitleDate } from './parseUtils';

function normalizeHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const REQUIRED_COLUMNS = ['collection date', 'invoice no', 'payment type', 'amount paid'];

export class CollectionSchemaError extends Error {
  constructor() {
    super(
      'This doesn\'t look like a Zenoti "Collections" export - could not find the expected columns (Collection Date, Invoice No, Payment Type, Amount Paid).',
    );
  }
}

export class CollectionPeriodError extends Error {
  constructor() {
    super('Could not find the reporting period in this file\'s title rows - expected a line like "From : 01 Jan 2026 To : 31 Jul 2026".');
  }
}

/**
 * Buckets a raw Payment Type.
 *
 * Redemption types carry their identity after the label - "Package - derma-Custom Package-...",
 * "Gift Card(2190)", "Prepaid Card(PR2026...)" - so matching is on the prefix, not equality.
 * Everything that is not one of those three is new money arriving.
 */
export function classifyPaymentMethod(paymentType: string): CollectionMethod {
  const s = paymentType.trim().toLowerCase();
  if (s.startsWith('package')) return 'package';
  if (s.startsWith('gift card')) return 'giftCard';
  if (s.startsWith('prepaid card')) return 'prepaidCard';
  if (s.startsWith('card')) return 'card';
  if (s.startsWith('cash')) return 'cash';
  if (s.includes('bank transfer')) return 'bankTransfer';
  return 'other';
}

/** True for the methods that represent cash actually collected in the period. */
export function isCashCollection(method: CollectionMethod): boolean {
  return method !== 'package' && method !== 'giftCard' && method !== 'prepaidCard';
}

export const COLLECTION_METHOD_LABELS: Record<CollectionMethod, string> = {
  card: 'Card',
  cash: 'Cash',
  bankTransfer: 'Bank Transfer',
  other: 'Other',
  package: 'Package Redemption',
  giftCard: 'Gift Card',
  prepaidCard: 'Prepaid Card',
};

export interface CollectionParseOutcome {
  periodStart: string;
  periodEnd: string;
  records: CollectionRecord[];
}

/**
 * Parses a Zenoti "Collections" export: a title block carrying the reporting period, a header row,
 * then one row per payment received.
 *
 * The export's "Total Paid" column is a running total per invoice, not this payment - summing it
 * would multiply every invoice settled in instalments. Only "Amount Paid" is taken.
 */
export async function parseCollectionsWorkbook(buffer: ArrayBuffer, batchId: string): Promise<CollectionParseOutcome> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let headerRowIndex = -1;
  let columnIndex = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    if (!periodStart) {
      for (const cell of row) {
        const text = String(cell ?? '');
        const from = /from\s*:\s*(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/i.exec(text);
        const to = /to\s*:\s*(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/i.exec(text);
        if (from && to) {
          periodStart = parseTitleDate(from[1]);
          periodEnd = parseTitleDate(to[1]);
          break;
        }
      }
    }

    const normalized = row.map(normalizeHeader);
    if (REQUIRED_COLUMNS.every((c) => normalized.includes(c))) {
      headerRowIndex = i;
      columnIndex = new Map(normalized.map((h, idx): [string, number] => [h, idx]).filter(([h]) => h !== ''));
      break;
    }
  }

  if (headerRowIndex === -1) throw new CollectionSchemaError();
  if (!periodStart || !periodEnd) throw new CollectionPeriodError();

  const get = (row: unknown[], header: string) => {
    const idx = columnIndex.get(header);
    return idx == null ? null : row[idx];
  };
  const text = (row: unknown[], header: string) => {
    const v = get(row, header);
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s;
  };

  const records: CollectionRecord[] = [];
  const seenIds = new Map<string, number>();

  for (const row of rows.slice(headerRowIndex + 1)) {
    if (!row) continue;
    const invoiceNo = text(row, 'invoice no');
    const date = parseFlexibleDate(get(row, 'collection date'));
    if (!invoiceNo || !date) continue;

    const paymentType = text(row, 'payment type') ?? '';
    const amount = parseNumber(get(row, 'amount paid'));

    // An invoice settled twice on the same day by the same method is two real payments, not a
    // duplicate row, so the occurrence index is part of the identity.
    const base = hashString([date, invoiceNo, paymentType, amount.toFixed(3)].join('|'));
    const occurrence = (seenIds.get(base) ?? 0) + 1;
    seenIds.set(base, occurrence);

    records.push({
      id: `${base}-${occurrence}`,
      importBatchId: batchId,
      date,
      invoiceNo,
      patientId: text(row, 'guest code') ?? '',
      patientName: text(row, 'guest name') ?? '',
      centerName: text(row, 'center name') ?? '',
      paymentType,
      method: classifyPaymentMethod(paymentType),
      amount,
      taxCollected: parseNumber(get(row, 'tax collected')),
      invoiceStatus: text(row, 'invoice status') ?? '',
      collectedBy: text(row, 'collected by'),
      comments: text(row, 'comments'),
    });
  }

  return { periodStart, periodEnd, records };
}
