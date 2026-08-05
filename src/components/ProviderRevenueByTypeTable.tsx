import { useMemo } from 'react';
import type { CollectionSummary } from '../lib/collections';
import { formatCurrency, formatNumber } from '../lib/format';
import { InfoTooltip } from './InfoTooltip';
import {
  hasUntypedAdjustment,
  REVENUE_TYPE_LABELS,
  totalRevenueByType,
  visibleRevenueTypeKeys,
  type ProviderRevenueByType,
} from '../lib/providerRevenueByType';

/**
 * Revenue per provider, split by what was sold and whether it was a sale or a reversal.
 *
 * The refund columns are the point: a provider's net figure alone cannot distinguish someone who
 * sold little from someone who sold plenty and had much of it handed back.
 */
export function ProviderRevenueByTypeTable({
  data,
  collections,
}: {
  data: ProviderRevenueByType[];
  /** Present once a Collections export has been imported; adds cash actually received beside revenue. */
  collections?: CollectionSummary | null;
}) {
  const total = useMemo(() => totalRevenueByType(data), [data]);
  const keys = useMemo(() => visibleRevenueTypeKeys(total), [total]);
  const showAdjustment = useMemo(() => hasUntypedAdjustment(data), [data]);
  const collectedFor = (provider: string) => collections?.providers.find((p) => p.provider === provider);
  const showRefunds = !!collections && collections.totalRefunded !== 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Revenue by Type, per Provider
        <InfoTooltip text="The sales export has no refund item type - a refund is the original line reversed, carrying the same Item Type with a negative quantity and amount. Sales and refunds are therefore split by the sign of the line. Refund columns are shown as negatives, exactly as they arrive, so each row's columns add up to its Net Revenue." />
      </h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Net Revenue is the sum of the columns to its left, and the All Providers row matches the Revenue figure at the
        top of this dashboard. Package Redeemed sits outside it - those sessions were already recognized as revenue when the package was sold -
        and the two together give Delivered Value, what the provider actually performed. Assisting staff fold into
        whichever doctor they assisted, per your Provider Groups. Master Control Revenue Adjustments are applied here
        too: one that names a type moves that column, one that does not shows separately, and either way the
        All Providers row is unchanged, since an adjustment only moves revenue between two providers.
        {collections && ' Collection is money in and Refund is money out, both by collection date rather than sale date and matched to whoever sold the invoice; Net Collection is the two together, so gross takings stay readable instead of a refund quietly eating into them. Package, gift-card and prepaid-card settlements are in none of the three - that cash arrived when the package or card was bought. Hover a Refund to see how much of it is a gift or prepaid card handed back, which was paid for in an earlier period and so says nothing about this one.'}
      </p>
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No revenue recorded in this period.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] uppercase leading-tight text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2 align-bottom">Provider</th>
                {keys.map((k) => (
                  <th key={k} className="break-words py-2 pr-2 text-right align-bottom">{REVENUE_TYPE_LABELS[k]}</th>
                ))}
                {showAdjustment && <th className="break-words py-2 pr-2 text-right align-bottom">Adjustment</th>}
                <th className="py-2 pr-2 text-right align-bottom">Net Revenue</th>
                <th className="break-words py-2 pr-2 text-right align-bottom">Package Redeemed</th>
                <th className="break-words py-2 pr-2 text-right align-bottom">Delivered Value</th>
                {collections && <th className="break-words py-2 pr-2 text-right align-bottom">Collection</th>}
                {showRefunds && <th className="break-words py-2 pr-2 text-right align-bottom">Refund</th>}
                {collections && <th className="break-words py-2 pr-2 text-right align-bottom">Net Collection</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.provider} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2 font-medium">{row.provider}</td>
                  {keys.map((k) => (
                    <td
                      key={k}
                      className={`py-1.5 pr-2 text-right tabular-nums ${
                        row.amounts[k] < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-700 dark:text-zinc-300'
                      }`}
                      title={`${formatNumber(row.lines[k])} line item(s)`}
                    >
                      {row.amounts[k] === 0 && row.lines[k] === 0 ? '—' : formatCurrency(row.amounts[k])}
                    </td>
                  ))}
                  {showAdjustment && (
                    <td
                      className={`py-1.5 pr-2 text-right tabular-nums ${row.adjustment < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-700 dark:text-zinc-300'}`}
                      title="Master Control adjustments that named no item type"
                    >
                      {row.adjustment === 0 ? '\u2014' : formatCurrency(row.adjustment)}
                    </td>
                  )}
                  <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{formatCurrency(row.netRevenue)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatCurrency(row.redeemed)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(row.deliveredValue)}</td>
                  {collections && (
                    <td
                      className="py-1.5 pr-2 text-right tabular-nums text-sky-700 dark:text-sky-400"
                      title={`${formatNumber(collectedFor(row.provider)?.invoices ?? 0)} invoice(s) · ${formatCurrency(collectedFor(row.provider)?.redemptionSettled ?? 0)} settled by package/card, not counted here`}
                    >
                      {formatCurrency(collectedFor(row.provider)?.collected ?? 0)}
                    </td>
                  )}
                  {showRefunds && (
                    <td
                      className="py-1.5 pr-2 text-right tabular-nums text-rose-600 dark:text-rose-400"
                      title={`of which ${formatCurrency(collectedFor(row.provider)?.cardRefunds ?? 0)} is a gift or prepaid card handed back, paid for in an earlier period`}
                    >
                      {formatCurrency(collectedFor(row.provider)?.refunded ?? 0)}
                    </td>
                  )}
                  {collections && (
                    <td className="py-1.5 pr-2 text-right font-semibold tabular-nums text-sky-700 dark:text-sky-400">
                      {formatCurrency(collectedFor(row.provider)?.netCollected ?? 0)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
                <td className="py-1.5 pr-2">All Providers</td>
                {keys.map((k) => (
                  <td key={k} className={`py-1.5 pr-2 text-right tabular-nums ${total.amounts[k] < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                    {formatCurrency(total.amounts[k])}
                  </td>
                ))}
                {showAdjustment && <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(total.adjustment)}</td>}
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(total.netRevenue)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(total.redeemed)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(total.deliveredValue)}</td>
                {collections && (
                  <td className="py-1.5 pr-2 text-right tabular-nums text-sky-700 dark:text-sky-400">
                    {formatCurrency(collections.totalCollected)}
                  </td>
                )}
                {showRefunds && (
                  <td className="py-1.5 pr-2 text-right tabular-nums text-rose-600 dark:text-rose-400">
                    {formatCurrency(collections.totalRefunded)}
                  </td>
                )}
                {collections && (
                  <td className="py-1.5 pr-2 text-right tabular-nums text-sky-700 dark:text-sky-400">
                    {formatCurrency(collections.totalNetCollected)}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {collections && collections.unattributedCollected + collections.unattributedRefunded !== 0 && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {formatCurrency(collections.unattributedCollected + collections.unattributedRefunded)} of the collected total is on{' '}
          {formatNumber(collections.unattributedPayments)} payment(s) whose invoice is not in your sales data. It is
          inside the All Providers total, as it should be, but sits in no provider's row, so the rows above add up to{' '}
          {formatCurrency(collections.totalNetCollected - collections.unattributedCollected - collections.unattributedRefunded)}.{' '}
          {collections.unattributedByReason.withinImportedRange > 0 ? (
            <>
              {formatNumber(collections.unattributedByReason.withinImportedRange)} of them are numbered inside the range
              your sales data already covers
              {collections.salesSpan && ` (${collections.salesSpan.start} to ${collections.salesSpan.end})`}, so those
              are a genuine gap worth checking. The rest are outside it and will resolve once you import sales covering
              them.
            </>
          ) : (
            <>
              None are numbered inside the range your sales data covers
              {collections.salesSpan && ` (${collections.salesSpan.start} to ${collections.salesSpan.end})`}, so nothing
              is missing from your data - they will resolve once you import sales covering those invoices.
            </>
          )}{' '}
          The Excel export lists them individually on a "Collections Unmatched" sheet, each with the reason.
        </p>
      )}
    </div>
  );
}
