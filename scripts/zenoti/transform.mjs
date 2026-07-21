/**
 * Maps one row of Zenoti's POST /v1/reports/sales/accrual_basis/flat_file response to the
 * exact column names src/lib/excelParser.ts expects from a manual Zenoti sales export - so the
 * file this sync produces is a drop-in replacement for a manually-exported spreadsheet, with
 * zero changes needed to the dashboard's import/parsing code. Field mapping is based on
 * Zenoti's published OpenAPI spec for this endpoint (2026-07-21), not guesswork - item_type,
 * status, and discount_name all come through as real fields here, unlike the older
 * /v1/sales/salesreport endpoint this was originally built against.
 *
 * One thing still worth confirming against real production data (not just Zenoti's docs
 * examples): whether `guest_code` is reliably populated with the same alphanumeric codes your
 * manual exports use (e.g. "MUS5738"), so patient identity lines up across both sources. The
 * fallback to guest_id below only kicks in when guest_code is blank.
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
  const redeemed = row.redeemed ?? 0;
  const isRedemption = redeemed > 0;
  // No dedicated "package name" field on this endpoint - the redeemed item's own name is the
  // closest available label, reconstructed to match the manual export's "Payment Type starts
  // with 'Package'" convention that excelParser.ts already relies on.
  const paymentType = isRedemption ? `Package - ${row.item_name || 'Package'}` : row.payment_type || null;

  return {
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
    'Payment Type': paymentType,
    Redeemed: isRedemption ? redeemed : 0,
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
