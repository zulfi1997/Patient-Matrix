#!/usr/bin/env -S npx tsx
/**
 * Patient Matrix MCP server - lets an MCP client (e.g. Claude Desktop, Claude Code) ask for real
 * sales facts without opening the dashboard. Reuses the exact same code the app and the
 * "Zenoti Sales Sync" GitHub Action already use, so numbers here always match what the dashboard
 * would show for the same period:
 *   - Live sales lines straight from the Zenoti API (scripts/zenoti/fetchSales.mjs) - not the
 *     OneDrive export cycle, so this reflects up-to-the-minute data.
 *   - The latest "Department Mapping" and "Package Benefit Data" files from the shared OneDrive
 *     folder (src/lib/departmentMappingParser.ts, src/lib/packageBenefitParser.ts), so revenue can
 *     be attributed by department the same way the Department Analytics dashboard does.
 *   - src/lib/departmentAnalytics.ts's own resolution/aggregation logic - not a reimplementation,
 *     so there is nothing here that can silently drift from the dashboard's own numbers.
 *
 * Run with `npm run mcp-server` (stdio transport - for Claude Desktop/Code's MCP config) after
 * setting the environment variables listed in mcp-server/README.md.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { fetchAllSales } from '../scripts/zenoti/fetchSales.mjs';
import { zenotiRowsToExportRows } from '../scripts/zenoti/transform.mjs';
import { listOneDriveFolder, downloadLatestFromOneDriveFolder } from '../scripts/zenoti/graphAppOnly.mjs';

import { rowsToRecords } from '../src/lib/excelParser.ts';
import { parseDepartmentMappingWorkbook } from '../src/lib/departmentMappingParser.ts';
import { parsePackageBenefitWorkbook, PackageBenefitSnapshotDateError } from '../src/lib/packageBenefitParser.ts';
import { serviceMapKey, type KnownService } from '../src/lib/departments.ts';
import { buildBenefitLookup, buildServiceDepartmentMap, computeDepartmentRevenue, UNMAPPED } from '../src/lib/departmentAnalytics.ts';
import { toISODate } from '../src/lib/format.ts';

const ONEDRIVE_SUBFOLDER_NAMES = {
  sales: 'Sales Data',
  pnl: 'P&L Data',
  packageBenefits: 'Package Benefit Data',
  departmentMapping: 'Department Mapping',
} as const;
type OneDriveFolderKey = keyof typeof ONEDRIVE_SUBFOLDER_NAMES;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. See mcp-server/README.md for setup.`);
  return value;
}

interface ZenotiConfig {
  apiKey: string;
  centerIds: string[];
  host: string | undefined;
}

export function zenotiConfig(): ZenotiConfig {
  return {
    apiKey: requireEnv('ZENOTI_API_KEY'),
    centerIds: requireEnv('ZENOTI_CENTER_IDS').split(',').map((s) => s.trim()).filter(Boolean),
    host: process.env.ZENOTI_API_HOST || undefined,
  };
}

interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sharedFolderUrl: string;
}

export function graphConfig(): GraphConfig {
  return {
    tenantId: requireEnv('GRAPH_TENANT_ID'),
    clientId: requireEnv('GRAPH_CLIENT_ID'),
    clientSecret: requireEnv('GRAPH_CLIENT_SECRET'),
    sharedFolderUrl: requireEnv('ONEDRIVE_SHARED_FOLDER_URL'),
  };
}

// Mirrors excelParser.ts's own header normalization (trim/lowercase/collapse whitespace) so the
// header map built here matches what rowsToRecords expects - the export rows from
// zenotiRowsToExportRows already use the exact column names a real export uses, so there's no
// spreadsheet round-trip needed, just the same key->header lookup a parsed workbook would produce.
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function fetchLiveSaleRecords(since: Date, until: Date) {
  const { apiKey, centerIds, host } = zenotiConfig();
  const rawRows = await fetchAllSales({ host, apiKey, centerIds, since, until });
  const exportRows = zenotiRowsToExportRows(rawRows);

  const headerMap = new Map<string, string>();
  if (exportRows.length > 0) {
    for (const key of Object.keys(exportRows[0])) headerMap.set(normalizeHeader(key), key);
  }
  const { records, warnings } = rowsToRecords(exportRows as Record<string, unknown>[], headerMap, 'mcp-live-fetch');
  return { records, warnings, rawCount: rawRows.length };
}

export async function loadDepartmentMapping(knownServices: KnownService[]) {
  try {
    const file = await downloadLatestFromOneDriveFolder({
      ...graphConfig(),
      subfolderName: ONEDRIVE_SUBFOLDER_NAMES.departmentMapping,
    });
    if (!file) return { records: [], sourceFile: null as string | null, warnings: [] as string[] };
    const arrayBuffer = file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength);
    const outcome = await parseDepartmentMappingWorkbook(arrayBuffer as ArrayBuffer, knownServices);
    return { records: outcome.records, sourceFile: file.name, warnings: outcome.warnings };
  } catch (err) {
    return { records: [], sourceFile: null as string | null, warnings: [`Could not load Department Mapping: ${(err as Error).message}`] };
  }
}

export async function loadPackageBenefits() {
  try {
    const file = await downloadLatestFromOneDriveFolder({
      ...graphConfig(),
      subfolderName: ONEDRIVE_SUBFOLDER_NAMES.packageBenefits,
    });
    if (!file) return { records: [], sourceFile: null as string | null };
    const arrayBuffer = file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength);
    const outcome = await parsePackageBenefitWorkbook(arrayBuffer as ArrayBuffer);
    return { records: outcome.records, sourceFile: file.name };
  } catch (err) {
    if (err instanceof PackageBenefitSnapshotDateError) return { records: [], sourceFile: null as string | null };
    return { records: [], sourceFile: null as string | null };
  }
}

const server = new McpServer({ name: 'patient-matrix', version: '1.0.0' });

server.registerTool(
  'list_onedrive_reports',
  {
    title: 'List OneDrive reports',
    description:
      'Lists the files sitting in the Patient Matrix shared OneDrive folders (Sales Data, P&L Data, Package Benefit Data, Department Mapping) - newest-modified first. Use this to see what data snapshots are available before asking a question that depends on one of them.',
    inputSchema: {
      folder: z
        .enum(['sales', 'pnl', 'packageBenefits', 'departmentMapping'])
        .optional()
        .describe('Limit to one folder. Omit to list all four.'),
    },
  },
  async ({ folder }) => {
    const keys: OneDriveFolderKey[] = folder ? [folder] : (Object.keys(ONEDRIVE_SUBFOLDER_NAMES) as OneDriveFolderKey[]);
    const config = graphConfig();
    const lines: string[] = [];
    for (const key of keys) {
      const subfolderName = ONEDRIVE_SUBFOLDER_NAMES[key];
      lines.push(`## ${subfolderName}`);
      try {
        const files = await listOneDriveFolder({ ...config, subfolderName });
        if (files.length === 0) {
          lines.push('(no files)');
        } else {
          for (const f of files) {
            const sizeKb = (f.size / 1024).toFixed(1);
            lines.push(`- ${f.name} - ${sizeKb} KB - modified ${f.lastModifiedDateTime}`);
          }
        }
      } catch (err) {
        lines.push(`(could not list: ${(err as Error).message})`);
      }
      lines.push('');
    }
    return { content: [{ type: 'text', text: lines.join('\n').trim() }] };
  },
);

server.registerTool(
  'get_sales_facts',
  {
    title: 'Get sales facts',
    description:
      "Pulls live sales lines directly from Zenoti for a date range (not the daily OneDrive export cycle - this is up-to-the-minute) and reports revenue, transactions, unique patients, top services, package redemptions, and a revenue-by-department breakdown. Department attribution uses the same mapping/splitting logic as the Department Analytics dashboard, sourced from the latest 'Department Mapping' and 'Package Benefit Data' files in the shared OneDrive folder.",
    inputSchema: {
      since: z.string().optional().describe('Start date, YYYY-MM-DD. Defaults to 30 days before "until".'),
      until: z.string().optional().describe('End date (exclusive upper bound), YYYY-MM-DD. Defaults to now.'),
    },
  },
  async ({ since, until }) => {
    const untilDate = until ? new Date(`${until}T00:00:00Z`) : new Date();
    const sinceDate = since ? new Date(`${since}T00:00:00Z`) : new Date(untilDate.getTime() - 30 * 86_400_000);

    const { records, warnings, rawCount } = await fetchLiveSaleRecords(sinceDate, untilDate);

    if (records.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No sale lines found from Zenoti between ${toISODate(sinceDate)} and ${toISODate(untilDate)} (${rawCount} raw row(s) fetched, ${warnings.length} skipped).`,
          },
        ],
      };
    }

    const knownServicesByKey = new Map<string, KnownService>();
    for (const r of records) {
      const key = serviceMapKey(r.serviceKey, r.serviceName);
      if (!knownServicesByKey.has(key)) {
        knownServicesByKey.set(key, { serviceKey: r.serviceKey, serviceName: r.serviceName, itemType: r.itemType });
      }
    }
    const knownServices = [...knownServicesByKey.values()];

    const [mappingResult, benefitsResult] = await Promise.all([
      loadDepartmentMapping(knownServices),
      loadPackageBenefits(),
    ]);

    const mapping = buildServiceDepartmentMap(mappingResult.records);
    const lookup = buildBenefitLookup(benefitsResult.records, mappingResult.records);

    const range = { start: toISODate(sinceDate), end: toISODate(untilDate) };
    // No prior-period comparison needed here - an impossible range keeps previousRevenue at 0
    // without duplicating computeDepartmentRevenue's own aggregation logic.
    const noPriorRange = { start: '0001-01-01', end: '0001-01-02' };
    const revenueRows = computeDepartmentRevenue(records, range, noPriorRange, mapping, lookup);

    const totalRevenue = records.reduce((s, r) => s + r.amount, 0);
    const redeemedValue = records.reduce((s, r) => s + (r.packageName ? r.redeemedAmount : 0), 0);
    const uniquePatients = new Set(records.map((r) => r.patientId)).size;

    const revenueByService = new Map<string, { serviceName: string; revenue: number; transactions: number }>();
    for (const r of records) {
      const key = serviceMapKey(r.serviceKey, r.serviceName);
      const entry = revenueByService.get(key) ?? { serviceName: r.serviceName, revenue: 0, transactions: 0 };
      entry.revenue += r.amount;
      entry.transactions += 1;
      revenueByService.set(key, entry);
    }
    const topServices = [...revenueByService.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

    const lines: string[] = [];
    lines.push(`# Sales facts: ${range.start} to ${range.end}`);
    lines.push(`Source: live Zenoti API (${records.length} sale line(s), ${uniquePatients} unique patient(s))`);
    lines.push(
      `Department mapping: ${mappingResult.sourceFile ? `"${mappingResult.sourceFile}"` : 'none found - all revenue will show as Unmapped'}${benefitsResult.sourceFile ? `, package benefits from "${benefitsResult.sourceFile}"` : ''}`,
    );
    lines.push('');
    lines.push(`Total revenue: OMR ${totalRevenue.toFixed(3)}`);
    lines.push(`Package sessions redeemed (value): OMR ${redeemedValue.toFixed(3)}`);
    lines.push(`Transactions: ${records.length}`);
    lines.push('');
    lines.push('## Revenue by department');
    for (const row of revenueRows.sort((a, b) => b.revenue - a.revenue)) {
      const flag = row.department === UNMAPPED ? '  (map more services on the Data tab to shrink this)' : '';
      lines.push(`- ${row.department}: OMR ${row.revenue.toFixed(3)} (${row.transactions} txns)${flag}`);
    }
    lines.push('');
    lines.push('## Top services by revenue');
    for (const s of topServices) {
      lines.push(`- ${s.serviceName}: OMR ${s.revenue.toFixed(3)} (${s.transactions} txns)`);
    }
    if (mappingResult.warnings.length > 0) {
      lines.push('');
      lines.push('## Notes');
      for (const w of mappingResult.warnings.slice(0, 5)) lines.push(`- ${w}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start listening on stdio when this file is run directly (`npm run mcp-server`) - guarded
// so the exported helpers above can be imported and tested from another script without also
// spinning up a stdio server that would otherwise fight over the test's own stdin/stdout.
const isMainModule = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMainModule) {
  main().catch((err) => {
    console.error('[patient-matrix-mcp] fatal error:', err);
    process.exitCode = 1;
  });
}
