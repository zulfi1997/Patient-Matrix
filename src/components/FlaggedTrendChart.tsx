import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FlaggedMonthlyPoint } from '../lib/metrics';
import { formatCurrency, formatMonthLabel, formatNumber } from '../lib/format';

type Metric = 'count' | 'amount';

export function FlaggedTrendChart({ data }: { data: FlaggedMonthlyPoint[] }) {
  const [metric, setMetric] = useState<Metric>('count');
  const chartData = data.map((d) => ({ ...d, label: formatMonthLabel(d.month) }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          "YB111" Trend <span className="font-normal text-zinc-500 dark:text-zinc-400">by {metric === 'count' ? 'transaction count' : 'value'}</span>
        </h3>
        <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs print:hidden dark:border-zinc-700">
          <button
            onClick={() => setMetric('count')}
            className={`px-2.5 py-1 ${metric === 'count' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
          >
            Count
          </button>
          <button
            onClick={() => setMetric('amount')}
            className={`px-2.5 py-1 ${metric === 'amount' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
          >
            Value
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            allowDecimals={false}
            tickFormatter={(v) => (metric === 'amount' ? `${(v / 1000).toFixed(0)}k` : formatNumber(v))}
          />
          <Tooltip
            formatter={(value) => (metric === 'amount' ? formatCurrency(Number(value)) : formatNumber(Number(value)))}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Bar dataKey={metric} fill="#f97316" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
