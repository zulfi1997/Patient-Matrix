export const DEPARTMENTS = ['Wellness', 'Derma', 'Facial', 'Laser', 'Biohacking'] as const;
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
