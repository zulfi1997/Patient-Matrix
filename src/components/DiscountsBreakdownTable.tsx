import type { DiscountBreakdownStat } from '../lib/discounts';
import { formatCurrency, formatNumber } from '../lib/format';

const CATEGORY_BADGE: Record<string, string> = {
  manual: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  campaign: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  priceAdjusted: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  other: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

export function DiscountsBreakdownTable({ data }: { data: DiscountBreakdownStat[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Discounts</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Manual discounts, named campaigns, and price adjustments this period, from the Discount Name/Discount
        columns. Excludes "Package Redemption" entries, which are bookkeeping for a package session being consumed
        - not a real discount (already reflected in Redeemed Packages above).
      </p>

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No discounts applied in this period.</p>
      ) : (
        <div className="max-h-96 overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 print:static dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="py-2 pr-2">Discount</th>
                <th className="py-2 pr-2 text-right">Times Applied</th>
                <th className="py-2 pr-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={`${d.category}:${d.label}`} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-2">
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_BADGE[d.category] ?? CATEGORY_BADGE.other}`}>
                      {d.category === 'campaign' ? 'Campaign' : d.category === 'manual' ? 'Manual' : d.category === 'priceAdjusted' ? 'Adjusted' : 'Other'}
                    </span>
                    {d.label}
                  </td>
                  <td className="py-1.5 pr-2 text-right">{formatNumber(d.count)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatCurrency(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
