import { DEPARTMENTS, parseDepartment, type KnownService, type ServiceDepartmentRecord } from './departments';

function normalizeHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export class DepartmentMappingSchemaError extends Error {
  constructor() {
    super(
      `This doesn't look like a department mapping file - could not find a "Service Name" and "Department" column. Expected columns: Service Key (optional), Service Name, Department (one of ${DEPARTMENTS.join(', ')}).`,
    );
  }
}

export interface DepartmentMappingParseOutcome {
  records: ServiceDepartmentRecord[];
  warnings: string[];
}

/**
 * Parses a department mapping file (.csv/.xlsx) with a header row containing "Service Name" and
 * "Department" (an optional "Service Key" column, present when the file was exported from this
 * app, is used to match services directly - this makes the file portable across browsers/devices
 * even when their locally-known service lists differ slightly, since serviceKey is derived
 * deterministically from Item Type + Item Code rather than being random per upload. Without a
 * Service Key column, rows are matched by Service Name against the currently-known services
 * instead, best-effort.
 */
export async function parseDepartmentMappingWorkbook(
  buffer: ArrayBuffer,
  knownServices: KnownService[],
): Promise<DepartmentMappingParseOutcome> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });

  let headerRowIndex = -1;
  let columnIndex = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const normalized = row.map(normalizeHeader);
    if (normalized.includes('service name') && normalized.includes('department')) {
      headerRowIndex = i;
      columnIndex = new Map(normalized.map((name, idx) => [name, idx]));
      break;
    }
  }
  if (headerRowIndex === -1) throw new DepartmentMappingSchemaError();

  const byName = new Map(knownServices.map((s) => [s.serviceName.trim().toLowerCase(), s]));
  const byKey = new Map(knownServices.map((s) => [s.serviceKey, s]));

  const get = (row: unknown[], name: string): unknown => {
    const idx = columnIndex.get(name);
    return idx == null ? null : row[idx];
  };

  const records: ServiceDepartmentRecord[] = [];
  const warnings: string[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const serviceName = String(get(row, 'service name') ?? '').trim();
    const rawDepartment = get(row, 'department');
    if (!serviceName && rawDepartment == null) continue;

    const rawServiceKey = String(get(row, 'service key') ?? '').trim();
    const department = parseDepartment(rawDepartment);

    if (!department) {
      warnings.push(`Row ${i + 1}: "${rawDepartment ?? ''}" isn't a known department (expected one of ${DEPARTMENTS.join(', ')}) - skipped.`);
      continue;
    }

    const resolved = (rawServiceKey && byKey.get(rawServiceKey)) || byName.get(serviceName.toLowerCase());
    if (!resolved) {
      warnings.push(`Row ${i + 1}: "${serviceName}" doesn't match any service in your uploaded sales data - skipped.`);
      continue;
    }

    records.push({ serviceKey: resolved.serviceKey, serviceName: resolved.serviceName, department });
  }

  return { records, warnings };
}

/**
 * Builds a downloadable CSV of the current mapping - every known service gets a row (Department
 * blank if unassigned), so it round-trips through Excel and back in. Category/Sold By/Invoice No
 * are included purely as context for whoever's editing in Excel (most useful for a one-off custom
 * package, where they're specific rather than "many") - only Service Key/Name/Department are read
 * back on import.
 */
export function buildDepartmentMappingCsv(knownServices: KnownService[], mapping: Record<string, string>): string {
  const header = ['Service Key', 'Service Name', 'Type', 'Category', 'Sold By', 'Invoice No', 'Department'];
  const lines = knownServices
    .map((s) => [s.serviceKey, s.serviceName, s.itemType, s.category ?? '', s.soldBy ?? '', s.invoiceNo ?? '', mapping[s.serviceKey] ?? ''])
    .map((cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header.join(','), ...lines].join('\n');
}
