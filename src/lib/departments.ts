export const DEPARTMENTS = ['Wellness', 'Derma', 'Facial', 'Laser', 'Biohacking', 'General'] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** serviceKey -> assigned department. A service with no entry here is unmapped. */
export type ServiceDepartmentMap = Record<string, Department>;

/** A distinct service/product/package seen in the uploaded sales data, keyed the same way Top/Dormant Services already group by (serviceKey). */
export interface KnownService {
  serviceKey: string;
  serviceName: string;
  itemType: string;
}

/** One persisted service -> department assignment. */
export interface ServiceDepartmentRecord {
  serviceKey: string;
  serviceName: string;
  department: Department;
}

/** Info about the last time a mapping file (.csv/.xlsx) was imported - there's only ever one, since the file replaces the whole mapping wholesale. */
export interface DepartmentMappingBatch {
  fileName: string;
  uploadedAt: string; // ISO datetime
  rowCount: number;
}

export function parseDepartment(raw: unknown): Department | null {
  const s = String(raw ?? '').trim();
  const match = DEPARTMENTS.find((d) => d.toLowerCase() === s.toLowerCase());
  return match ?? null;
}

/**
 * The identity used for department mapping - usually just the sale record's own serviceKey, but
 * for items with no stable item code (custom packages, etc.) SaleRecord.serviceKey is
 * deliberately bucketed by type alone (see excelParser.ts's serviceGroupKey) so Top/Dormant
 * Services aggregate sensibly instead of listing one entry per one-off sale. That bucketing is
 * wrong for THIS list though: a single "type:Package" row would silently represent every custom
 * package ever sold, to every patient, across every department - mapping it once would wrongly
 * apply that department to all of them. Folding the service name into the key here (only for the
 * generic "type:" bucket; coded services/packages are unaffected) gives each distinctly-named
 * custom item its own row and its own accurate suggestion, at the cost of one row per one-off
 * name - which the auto-suggestion feature exists to make painless.
 */
export function serviceMapKey(serviceKey: string, serviceName: string): string {
  return serviceKey.startsWith('type:') ? `${serviceKey}|${serviceName.trim()}` : serviceKey;
}
