import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonthlyTrendPoint } from '../lib/metrics';
import { formatCurrency, formatMonthLabel } from '../lib/format';

export function RevenueTrendChart({ data }: { data: MonthlyTrendPoint[] }) {
  const chartData = data.map((d) => ({ ...d, label: formatMonthLabel(d.month) }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Revenue Trend</h3>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -4, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} fill="url(#revenueFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
