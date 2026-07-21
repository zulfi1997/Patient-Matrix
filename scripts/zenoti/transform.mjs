/**
 * Maps one row of Zenoti's POST /v1/reports/sales/accrual_basis/flat_file response to the
 * exact column names src/lib/excelParser.ts expects from a manual Zenoti sales export - so the
 * file this sync produces is a drop-in replacement for a manually-exported spreadsheet, with
 * zero changes needed to the dashboard's import/parsing code. Field mapping is based on
 * Zenoti's published OpenAPI spec for this endpoint (2026-07-21), not guesswork - item_type,
 * status, and discount_name all come through as real fields here, unlike the older
 * /v1/sales/salesreport endpoint this was originally built against.
 *
 * Confirmed against real production data (2026-07-21): guest_code reliably matches the
 * alphanumeric codes ("MUS5215" etc.) used in the manual exports, so patient identity lines up
 * across both sources without needing the guest_id fallback in practice.
 *
 * Also includes `invoice_item_id` (present on real responses, though not listed in Zenoti's
 * published field docs for this endpoint) as an "Invoice Item ID" column - a stable per-line
 * identifier that excelParser.ts uses in place of its usual derived dedup key when present, so
 * a later discount/price correction on an already-synced line updates that row in place
 * instead of being counted as a second, separate line.
 */

/** guest_code is sometimes blank - fall back to the always-present guest_id (a UUID) rather than an empty patient identifier. */
function resolveGuestCode(row) {
  const code = (row.guest_code ?? '').trim();
  if (code) return code;
  return row.guest_id ?? '';
}

function dateOnly(isoDateTime) {
  if (!isoDateTime) return '';
  return isoDateTime.slice(0, 10);
}

export function zenotiRowToExportRow(row) {
  // Zenoti's own payment_type already says "Package - <name>" when a line is a previously-sold
  // package's session being consumed, and something else (e.g. "Prepaid Card(...)") when
  // `redeemed` reflects paying for a *new* purchase via redeemed stored value instead - these
  // are different things `redeemed` doesn't distinguish on its own, so payment_type must be
  // passed through as-is rather than re-derived from whether redeemed > 0. excelParser.ts's
  // existing "Payment Type starts with 'Package'" check already handles the rest correctly.
  return {
    'Invoice Item ID': row.invoice_item_id ?? '',
    'Invoice No': row.invoice_no ?? '',
    'Guest Code': resolveGuestCode(row),
    'Guest Name': row.guest_name ?? '',
    'Sale Date': dateOnly(row.sale_date),
    'Item Name': row.item_name ?? '',
    'Item Type': row.item_type ?? '',
    'Item Code': row.item_code ?? '',
    'Item Subcategory': row.item_sub_category ?? '',
    Qty: row.qty ?? 1,
    'Sales (Exc. Tax)': row.sales_exc_tax ?? 0,
    'Sales(Inc. Tax)': row.sales_inc_tax ?? row.sales_exc_tax ?? 0,
    Tax: row.tax ?? 0,
    'Payment Type': row.payment_type || null,
    Redeemed: row.redeemed ?? 0,
    Due: row.due ?? 0,
    'Discount Name': row.discount_name || null,
    Discount: row.discount ?? 0,
    'Invoice status': row.status || 'Unknown',
    'Sold By': row.sold_by ?? '',
    'Center Name': row.center_name ?? '',
    'Invoice Notes': row.invoice_notes || null,
  };
}

export function zenotiRowsToExportRows(rows) {
  return rows.map(zenotiRowToExportRow);
}
