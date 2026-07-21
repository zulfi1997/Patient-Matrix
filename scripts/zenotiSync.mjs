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
  const apiKey = requireEnv('ZENOTI_API_KEY');
  const centerIds = requireEnv('ZENOTI_CENTER_IDS').split(',').map((s) => s.trim()).filter(Boolean);
  const host = process.env.ZENOTI_API_HOST || undefined;

  const isDryRun = process.env.DRY_RUN === 'true';

  // Uploading to OneDrive isn't needed for a dry run, so those credentials are only required
  // for a real sync - lets someone verify the Zenoti side alone before setting up Graph access.
  const tenantId = isDryRun ? process.env.GRAPH_TENANT_ID : requireEnv('GRAPH_TENANT_ID');
  const clientId = isDryRun ? process.env.GRAPH_CLIENT_ID : requireEnv('GRAPH_CLIENT_ID');
  const clientSecret = isDryRun ? process.env.GRAPH_CLIENT_SECRET : requireEnv('GRAPH_CLIENT_SECRET');
  const sharedFolderUrl = isDryRun ? process.env.ONEDRIVE_SHARED_FOLDER_URL : requireEnv('ONEDRIVE_SHARED_FOLDER_URL');

  const syncBackAmount = process.env.SYNC_BACK_AMOUNT || null;
  const syncBackUnit = process.env.SYNC_BACK_UNIT || null;

  const now = new Date();
  const window = await resolveSyncWindow({ syncBackAmount, syncBackUnit, now });
  let { since, until, mode } = window;
  // A dry run is just for eyeballing field values, not a real pull - unless the caller
  // explicitly asked for a specific backfill window, keep it small and fast by default rather
  // than fetching whatever the normal incremental/initial-default window would be.
  const DRY_RUN_DEFAULT_DAYS = 3;
  if (isDryRun && mode !== 'manual-backfill') {
    since = new Date(Math.max(since.getTime(), now.getTime() - DRY_RUN_DEFAULT_DAYS * 86_400_000));
  }
  console.log(`[zenoti-sync] mode=${mode} dryRun=${isDryRun} since=${since.toISOString()} until=${until.toISOString()} centers=${centerIds.join(',')}`);

  const rawRows = await fetchAllSales({ host, apiKey, centerIds, since, until });
  console.log(`[zenoti-sync] fetched ${rawRows.length} sale line(s) from Zenoti`);

  if (isDryRun) {
    const sample = rawRows.slice(0, 5);
    console.log(`[zenoti-sync] DRY RUN - no upload, no watermark change. First ${sample.length} raw row(s):`);
    console.log(JSON.stringify(sample, null, 2));
    console.log(`[zenoti-sync] Same rows, transformed to the export column shape:`);
    console.log(JSON.stringify(zenotiRowsToExportRows(sample), null, 2));
    return;
  }

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
