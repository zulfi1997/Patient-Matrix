/**
 * Maps one row of Zenoti's GET /v1/sales/salesreport response to the exact column names
 * src/lib/excelParser.ts expects from a manual Zenoti sales export - so the file this sync
 * produces is a drop-in replacement for a manually-exported spreadsheet, with zero changes
 * needed to the dashboard's import/parsing code.
 *
 * Field mapping is based on a real sample response (2026-07-21). Two things are best-effort
 * and flagged for follow-up once real production data is visible:
 *   - ITEM_TYPE_MAP: only codes 0 (Service) and 2 (Product) are confirmed from the sample;
 *     Package/Membership/Gift card codes are a guess and will show as "Type <n>" if wrong,
 *     which is visible/inspectable rather than silently misclassified.
 *   - Discount Name and Invoice Status have no equivalent field in this API response, so
 *     they're synthesized (see below) rather than passed through.
 */

const ITEM_TYPE_MAP = {
  0: 'Service',
  1: 'Package',
  2: 'Product',
  3: 'Membership',
  4: 'Gift card',
  5: 'Pre-paid card',
};

function mapItemType(code) {
  return ITEM_TYPE_MAP[code] ?? `Type ${code}`;
}

/** guest_code is blank in some Zenoti setups - fall back to the always-present guest_id (a UUID) rather than an empty patient identifier. */
function resolveGuestCode(guest) {
  const code = (guest?.guest_code ?? '').trim();
  if (code) return code;
  return guest?.guest_id ?? '';
}

function dateOnly(isoDateTime) {
  if (!isoDateTime) return '';
  return isoDateTime.slice(0, 10);
}

export function zenotiRowToExportRow(row) {
  const salesExcTax = (row.sale_price ?? 0) - (row.discount ?? 0);
  const packageRedemption = row.package_redemption ?? 0;
  const isPackageRedemption = packageRedemption > 0;

  return {
    'Invoice No': row.invoice_no ?? '',
    'Guest Code': resolveGuestCode(row.guest),
    'Guest Name': row.guest?.guest_name ?? '',
    'Sale Date': dateOnly(row.sold_on),
    'Item Name': row.item?.name ?? '',
    'Item Type': mapItemType(row.item?.type),
    'Item Code': row.item?.code ?? '',
    Qty: row.quantity ?? 1,
    'Sales (Exc. Tax)': salesExcTax,
    'Sales(Inc. Tax)': row.final_sale_price ?? salesExcTax,
    Tax: row.total_tax ?? 0,
    // Reconstructed to match the manual export's "Payment Type starts with 'Package'"
    // convention (see excelParser.ts) - package_redemption/package are more precise
    // structured fields than the manual export's payment-type text parsing.
    'Payment Type': isPackageRedemption ? `Package - ${row.package || row.item?.name || 'Package'}` : (row.payment_type || null),
    Redeemed: isPackageRedemption ? packageRedemption : 0,
    Due: row.due ?? 0,
    // No discount-reason field in this API response - amount still tracks correctly,
    // just without the manual/campaign/price-adjusted categorization for these rows.
    'Discount Name': row.promotion || null,
    Discount: row.discount ?? 0,
    // No invoice-status field in this response - approximated from the balance due.
    'Invoice status': (row.due ?? 0) > 0 ? 'Open' : 'Closed',
    'Sold By': row.employee?.name ?? '',
    'Center Name': row.center?.center_name ?? '',
  };
}

export function zenotiRowsToExportRows(rows) {
  return rows.map(zenotiRowToExportRow);
}
