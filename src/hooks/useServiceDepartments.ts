import { useCallback, useEffect, useState } from 'react';
import * as db from '../db/db';
import { parseDepartmentMappingWorkbook, DepartmentMappingSchemaError } from '../lib/departmentMappingParser';
import type { Department, DepartmentMappingBatch, KnownService, ServiceDepartmentRecord } from '../lib/departments';

export interface DepartmentMappingImportResult {
  fileName: string;
  rowCount: number;
  warnings: string[];
}

export function useServiceDepartments() {
  const [records, setRecords] = useState<ServiceDepartmentRecord[]>([]);
  const [batch, setBatch] = useState<DepartmentMappingBatch | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, b] = await Promise.all([db.getAllServiceDepartments(), db.getDepartmentMappingBatch()]);
    setRecords(r);
    setBatch(b);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setDepartment = useCallback(
    async (serviceKey: string, serviceName: string, department: Department | null) => {
      if (department) await db.setServiceDepartment({ serviceKey, serviceName, department });
      else await db.deleteServiceDepartment(serviceKey);
      await refresh();
    },
    [refresh],
  );

  const importFile = useCallback(
    async (file: File, knownServices: KnownService[]): Promise<DepartmentMappingImportResult> => {
      const buffer = await file.arrayBuffer();
      const { records: parsed, warnings } = await parseDepartmentMappingWorkbook(buffer, knownServices);

      const newBatch: DepartmentMappingBatch = {
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        rowCount: parsed.length,
      };
      await db.importServiceDepartmentBatch(newBatch, parsed);
      await refresh();

      return { fileName: file.name, rowCount: parsed.length, warnings };
    },
    [refresh],
  );

  return { records, batch, loading, setDepartment, importFile, refresh };
}

export { DepartmentMappingSchemaError };
