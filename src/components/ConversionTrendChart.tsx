import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ConversionTrendPoint } from '../lib/conversionMetrics';
import { formatDate, formatPercent } from '../lib/format';

export function ConversionTrendChart({ data }: { data: ConversionTrendPoint[] }) {
  const chartData = data.map((d) => ({ ...d, label: formatDate(d.date).replace(/ \d{4}$/, '') }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Overall Conversion Rate - Last 30 Days</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 12 }} unit="%" domain={[0, 100]} />
          <Tooltip
            formatter={(value) => formatPercent(Number(value), 1)}
            labelFormatter={(_, payload) => (payload?.[0] ? formatDate(payload[0].payload.date) : '')}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Line type="monotone" dataKey="conversionRate" name="Conversion Rate" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
