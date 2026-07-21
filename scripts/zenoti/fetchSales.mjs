const DEFAULT_HOST = 'https://api.zenoti.com';
const PAGE_SIZE = 200;

/** Documented API limit is 365 days per call; stay comfortably under it. */
const CHUNK_DAYS = 350;

/** This endpoint wants "YYYY-MM-DD HH:MM:SS", not ISO-with-T. */
function toZenotiDateTime(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
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

function buildRequestBody({ centerIds, start, end, itemTypes, saleTypes, invoiceStatuses }) {
  return {
    center_ids: centerIds,
    start_date: toZenotiDateTime(start),
    end_date: toZenotiDateTime(end),
    item_types: itemTypes ?? [-1], // -1 = all
    sale_types: saleTypes ?? [-1],
    sold_by_ids: [],
    invoice_statuses: invoiceStatuses ?? [-1],
    vendors: { ids: [], is_all: true },
    brands: { ids: [], is_all: true },
  };
}

async function fetchPage({ host, apiKey, body, page }) {
  const url = new URL('/v1/reports/sales/accrual_basis/flat_file', host);
  url.searchParams.set('Page', String(page));
  url.searchParams.set('Size', String(PAGE_SIZE));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `apikey ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await res.json();
  // Errors show up two ways depending on the failure: a 400 with an `error: {code, message}`
  // wrapper (bad dates, range too long, ...), or a 400 with `{code, message}` at the top level
  // (unauthorized). Neither is a network failure, so both need checking explicitly.
  const error = responseBody?.error ?? (responseBody?.message && responseBody?.code ? responseBody : null);
  if (!res.ok || error) {
    throw new Error(`Zenoti sales accrual report request failed (${res.status}): ${JSON.stringify(error ?? responseBody).slice(0, 500)}`);
  }
  return responseBody;
}

async function fetchAllPagesForChunk({ host, apiKey, body }) {
  const rows = [];
  let page = 1;
  for (;;) {
    const responseBody = await fetchPage({ host, apiKey, body, page });
    const pageRows = responseBody.sales ?? [];
    rows.push(...pageRows);
    const total = responseBody.page_info?.total ?? rows.length;
    if (rows.length >= total || pageRows.length === 0) break;
    page += 1;
  }
  return rows;
}

/**
 * Pulls every sales line for each center across [since, until), chunked into CHUNK_DAYS windows
 * to stay under the API's 365-day-per-call limit, paginating fully within each chunk.
 * Sequential (not parallel) to stay well under any undocumented rate limit.
 */
export async function fetchAllSales({ host = DEFAULT_HOST, apiKey, centerIds, since, until, itemTypes, saleTypes, invoiceStatuses }) {
  const rows = [];
  for (const { start, end } of dateChunks(since, until, CHUNK_DAYS)) {
    const body = buildRequestBody({ centerIds, start, end, itemTypes, saleTypes, invoiceStatuses });
    const chunkRows = await fetchAllPagesForChunk({ host, apiKey, body });
    rows.push(...chunkRows);
  }
  return rows;
}
