import type { SaleRecord } from '../types';

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Builds a resolver that gives each sale line the key service analytics should group it by.
 *
 * serviceGroupKey (excelParser.ts) falls back to "type:<Item Type>" whenever a line carries no
 * Item Code. That is right for custom packages, whose names embed a patient and a timestamp and
 * which would otherwise each become a service that sold exactly once. It is badly wrong when a
 * whole export simply lacks the Item Code column: every coded service then collapses into a
 * single "type:Service" row, labelled by whichever line happened to parse first, silently
 * reporting one service where there were dozens.
 *
 * Services are masters in the source system, so a given service name has one stable code - and
 * any export that does carry Item Code tells us what it is. This resolves a code-less line to
 * that same code, rather than minting a name-based key for it. That distinction matters when a
 * code-less manual export and a coded API sync both cover a clinic's history: a name-based key
 * would show one service as two rows, one per source, which looks plausible and is harder to
 * catch than the collapse it replaced.
 *
 * Resolution order for a line with no code:
 *  - "type:Package" is left exactly as is: collapsing custom packages is deliberate.
 *  - Otherwise, if its name matches exactly one coded service anywhere in the data, it takes that
 *    code and merges with those rows.
 *  - Otherwise it falls back to its own name, so it is at least distinct rather than merged into
 *    an unrelated bucket. Ambiguous names (one name, several codes) land here too, since guessing
 *    between codes would silently misattribute revenue.
 *
 * Build this from every stored record, not a filtered subset - the coded rows that resolve a
 * name often sit outside the period being analyzed.
 */
export function buildServiceKeyResolver(records: SaleRecord[]): (record: SaleRecord) => string {
  const codesByName = new Map<string, Set<string>>();
  for (const r of records) {
    if (!r.serviceKey.startsWith('code:')) continue;
    const name = normalizeName(r.serviceName);
    if (!name) continue;
    let codes = codesByName.get(name);
    if (!codes) {
      codes = new Set();
      codesByName.set(name, codes);
    }
    codes.add(r.serviceKey);
  }

  return (record) => {
    if (record.serviceKey.startsWith('code:')) return record.serviceKey;
    if (record.serviceKey === 'type:Package') return record.serviceKey;

    const name = normalizeName(record.serviceName);
    if (!name) return record.serviceKey;

    const codes = codesByName.get(name);
    if (codes && codes.size === 1) return [...codes][0];
    return `name:${name}`;
  };
}

/** True when any line would collapse unrelated services together - i.e. an import is missing Item Code. */
export function countUnresolvedServiceLines(records: SaleRecord[]): number {
  const resolve = buildServiceKeyResolver(records);
  let count = 0;
  for (const r of records) {
    if (r.serviceKey === 'type:Package') continue;
    if (r.serviceKey.startsWith('code:')) continue;
    if (resolve(r).startsWith('code:')) continue;
    count++;
  }
  return count;
}
