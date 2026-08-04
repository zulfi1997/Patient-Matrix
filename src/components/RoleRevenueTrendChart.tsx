import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RoleRevenueTrend } from '../lib/providerHandover';
import { formatCurrency, formatMonthLabel, formatNumber } from '../lib/format';

/** Same palette the rest of the dashboard uses, cycled if a role has had many holders. */
const HOLDER_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#e11d48', '#8b5cf6', '#0ea5e9'];

export function RoleRevenueTrendChart({ trend }: { trend: RoleRevenueTrend }) {
  const holders = trend.byHolder.map((h) => h.provider);
  const colorFor = (provider: string) => HOLDER_COLORS[holders.indexOf(provider) % HOLDER_COLORS.length];

  const data = trend.points.map((p) => ({
    label: formatMonthLabel(p.month),
    month: p.month,
    patients: p.patients,
    total: p.value,
    // One key per holder so each bar segments by who held the role that month; a handover month
    // therefore shows both rather than being credited to one.
    ...Object.fromEntries(holders.map((h) => [h, p.byHolder[h] ?? 0])),
  }));

  // A handover falling inside the charted span gets a marker on the month it took effect.
  const handoverMonths = trend.byHolder
    .slice(1)
    .map((h) => ({ provider: h.provider, label: formatMonthLabel(`${h.fromDate.slice(0, 7)}-01`) }))
    .filter((h) => data.some((d) => d.label === h.label));

  if (trend.points.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-500">No revenue recorded for this role yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : formatNumber(v))}
        />
        <Tooltip
          formatter={(value, name) => [formatCurrency(Number(value)), name]}
          labelFormatter={(label) => {
            const row = data.find((d) => d.label === label);
            return row ? `${label} · ${formatNumber(row.patients)} patient${row.patients === 1 ? '' : 's'}` : label;
          }}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {handoverMonths.map((h) => (
          <ReferenceLine
            key={h.provider}
            x={h.label}
            stroke="#71717a"
            strokeDasharray="4 3"
            label={{ value: `${h.provider} takes over`, position: 'top', fontSize: 10, fill: '#71717a' }}
          />
        ))}
        {holders.map((h) => (
          <Bar key={h} dataKey={h} name={h} stackId="role" fill={colorFor(h)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
