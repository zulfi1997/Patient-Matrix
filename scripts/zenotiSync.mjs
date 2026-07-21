#!/usr/bin/env node
import * as XLSX from 'xlsx';
import { fetchAllSales } from './zenoti/fetchSales.mjs';
import { zenotiRowsToExportRows } from './zenoti/transform.mjs';
import { resolveSyncWindow, writeLastSyncedAt } from './zenoti/syncState.mjs';
import { uploadToOneDriveFolder } from './zenoti/graphAppOnly.mjs';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function buildWorkbookBuffer(rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sales');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function main() {
  const accessToken = requireEnv('ZENOTI_ACCESS_TOKEN');
  const centerIds = requireEnv('ZENOTI_CENTER_IDS').split(',').map((s) => s.trim()).filter(Boolean);
  const host = process.env.ZENOTI_API_HOST || undefined;
  const itemType = process.env.ZENOTI_ITEM_TYPE || undefined;
  const status = process.env.ZENOTI_STATUS || undefined;

  const tenantId = requireEnv('GRAPH_TENANT_ID');
  const clientId = requireEnv('GRAPH_CLIENT_ID');
  const clientSecret = requireEnv('GRAPH_CLIENT_SECRET');
  const sharedFolderUrl = requireEnv('ONEDRIVE_SHARED_FOLDER_URL');

  const syncBackAmount = process.env.SYNC_BACK_AMOUNT || null;
  const syncBackUnit = process.env.SYNC_BACK_UNIT || null;

  const now = new Date();
  const { since, until, mode } = await resolveSyncWindow({ syncBackAmount, syncBackUnit, now });
  console.log(`[zenoti-sync] mode=${mode} since=${since.toISOString()} until=${until.toISOString()} centers=${centerIds.join(',')}`);

  const rawRows = await fetchAllSales({ host, accessToken, centerIds, since, until, itemType, status });
  console.log(`[zenoti-sync] fetched ${rawRows.length} sale line(s) from Zenoti`);

  if (rawRows.length === 0) {
    console.log('[zenoti-sync] nothing to upload - skipping OneDrive upload, still advancing the sync watermark');
  } else {
    const exportRows = zenotiRowsToExportRows(rawRows);
    const buffer = buildWorkbookBuffer(exportRows);
    const fileName = `zenoti-sync-${now.toISOString().slice(0, 10)}-${now.getTime()}.xlsx`;

    await uploadToOneDriveFolder({
      tenantId,
      clientId,
      clientSecret,
      sharedFolderUrl,
      subfolderName: 'Sales Data',
      fileName,
      buffer,
    });
    console.log(`[zenoti-sync] uploaded ${fileName} (${exportRows.length} rows) to the "Sales Data" OneDrive folder`);
  }

  // Only advance the watermark on a normal incremental/default run - a manual backfill
  // (explicit sync_back_amount/unit) re-pulls an arbitrary window on demand and shouldn't
  // move where the *next* scheduled incremental run picks up from.
  if (mode !== 'manual-backfill') {
    await writeLastSyncedAt(now.toISOString());
    console.log(`[zenoti-sync] advanced sync watermark to ${now.toISOString()}`);
  }
}

main().catch((err) => {
  console.error('[zenoti-sync] failed:', err);
  process.exitCode = 1;
});
