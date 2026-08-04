import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ServiceStat } from '../lib/metrics';
import { formatCurrency, formatNumber } from '../lib/format';

type Metric = 'deliveredValue' | 'count';

export function TopServicesChart({ data }: { data: ServiceStat[] }) {
  const [metric, setMetric] = useState<Metric>('deliveredValue');
  const top = [...data].sort((a, b) => b[metric] - a[metric]).slice(0, 10);
  const chartData = top.map((s) => ({
    ...s,
    label: s.serviceName.length > 28 ? `${s.serviceName.slice(0, 27)}…` : s.serviceName,
  }));

  const anyRedeemed = top.some((s) => s.redeemedRevenue > 0);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Top Selling Services{' '}
          <span className="font-normal text-zinc-500 dark:text-zinc-400">
            by {metric === 'deliveredValue' ? 'value delivered' : 'times sold'}
          </span>
        </h3>
        <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs print:hidden dark:border-zinc-700">
          <button
            onClick={() => setMetric('deliveredValue')}
            className={`px-2.5 py-1 ${metric === 'deliveredValue' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
          >
            Value delivered
          </button>
          <button
            onClick={() => setMetric('count')}
            className={`px-2.5 py-1 ${metric === 'count' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
          >
            Times sold
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        {metric === 'deliveredValue'
          ? 'New cash plus the value of sessions consumed from previously-sold packages - a service delivered mostly through packages takes little new cash at the time it is performed, so counting cash alone would understate it.'
          : 'Line items sold, counting a package session being consumed the same as a cash sale.'}
      </p>

      {chartData.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">No sales in this period for the selected category.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 34 + (metric === 'deliveredValue' && anyRedeemed ? 28 : 0))}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
            <XAxis
              type="number"
              tick={{ fontSize: 12 }}
              // Only abbreviate once past a thousand - rounding every tick to whole thousands
              // renders a small-value axis as "0k 0k 1k 1k 1k".
              tickFormatter={(v) =>
                metric !== 'deliveredValue' ? formatNumber(v) : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : formatNumber(v)
              }
            />
            <YAxis type="category" dataKey="label" width={180} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, name) =>
                metric === 'deliveredValue' ? [formatCurrency(Number(value)), name] : [formatNumber(Number(value)), name]
              }
              labelFormatter={(_, payload) => payload?.[0]?.payload?.serviceName ?? ''}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            {metric === 'deliveredValue' ? (
              <>
                {anyRedeemed && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {/* Stacked so each bar totals the delivered value while still showing what was
                    new cash and what was package redemption. */}
                <Bar dataKey="revenue" name="New cash" stackId="value" fill="#6366f1" />
                <Bar dataKey="redeemedRevenue" name="Package redemption" stackId="value" fill="#a5b4fc" radius={[0, 4, 4, 0]} />
              </>
            ) : (
              <Bar dataKey="count" name="Times sold" fill="#6366f1" radius={[0, 4, 4, 0]} />
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
