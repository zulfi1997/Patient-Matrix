const DEFAULT_HOST = 'https://api.zenoti.com';

/** No pagination params are documented for this endpoint - chunking by date protects against an unknown per-call row cap on large backfills, and keeps each request's response size predictable. */
const CHUNK_DAYS = 30;

function toZenotiDate(d) {
  return d.toISOString().slice(0, 10);
}

function* dateChunks(since, until, chunkDays) {
  let start = new Date(since);
  const end = new Date(until);
  while (start < end) {
    const chunkEnd = new Date(Math.min(start.getTime() + chunkDays * 86_400_000, end.getTime()));
    yield { start: new Date(start), end: chunkEnd };
    start = chunkEnd;
  }
}

async function fetchSalesReportChunk({ host, accessToken, centerId, start, end, itemType, status }) {
  const url = new URL('/v1/sales/salesreport', host);
  url.searchParams.set('center_id', centerId);
  url.searchParams.set('start_date', toZenotiDate(start));
  url.searchParams.set('end_date', toZenotiDate(end));
  if (itemType) url.searchParams.set('item_type', itemType);
  if (status) url.searchParams.set('status', status);

  const res = await fetch(url, {
    headers: { Authorization: `bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Zenoti sales report request failed (${res.status}) for center ${centerId} ${toZenotiDate(start)}..${toZenotiDate(end)}: ${(await res.text()).slice(0, 500)}`);
  }
  const body = await res.json();
  if (body.Error) {
    throw new Error(`Zenoti sales report returned an error for center ${centerId}: ${JSON.stringify(body.Error)}`);
  }
  return body.center_sales_report ?? [];
}

/**
 * Pulls every sales row for each center across [since, until), chunked into CHUNK_DAYS windows.
 * Sequential (not parallel) per chunk to stay well under any undocumented rate limit.
 */
export async function fetchAllSales({ host = DEFAULT_HOST, accessToken, centerIds, since, until, itemType, status }) {
  const rows = [];
  for (const centerId of centerIds) {
    for (const { start, end } of dateChunks(since, until, CHUNK_DAYS)) {
      const chunkRows = await fetchSalesReportChunk({ host, accessToken, centerId, start, end, itemType, status });
      rows.push(...chunkRows);
    }
  }
  return rows;
}
