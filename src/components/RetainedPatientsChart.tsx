import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonthlyTrendPoint } from '../lib/metrics';
import { formatMonthLabel, formatNumber } from '../lib/format';

export function RetainedPatientsChart({ data }: { data: MonthlyTrendPoint[] }) {
  const chartData = data.map((d) => ({ ...d, label: formatMonthLabel(d.month) }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Retained Patients: New vs Returning</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Of each month's retained patients (active last month, active again this month), how many were themselves new
        last month vs. already an established patient.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip
            formatter={(value) => formatNumber(Number(value))}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="newPatientsRetained" name="New Patients Retained" stackId="r" fill="#6366f1" radius={[0, 0, 0, 0]} />
          <Bar dataKey="returningPatientsRetained" name="Returning Patients Retained" stackId="r" fill="#7dd3fc" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
