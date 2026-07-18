import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { NewPatientServiceStat } from '../lib/metrics';
import { formatCurrency, formatNumber } from '../lib/format';

type Metric = 'patientCount' | 'revenue';

export function NewPatientTopServicesChart({ data }: { data: NewPatientServiceStat[] }) {
  const [metric, setMetric] = useState<Metric>('patientCount');
  const top = [...data].sort((a, b) => b[metric] - a[metric]).slice(0, 10);
  const chartData = top.map((s) => ({
    ...s,
    label: s.serviceName.length > 28 ? `${s.serviceName.slice(0, 27)}…` : s.serviceName,
  }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Top Services for New Patients{' '}
          <span className="font-normal text-zinc-500 dark:text-zinc-400">
            by {metric === 'patientCount' ? 'new patients who bought it' : 'revenue'}
          </span>
        </h3>
        <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-xs print:hidden dark:border-zinc-700">
          <button
            onClick={() => setMetric('patientCount')}
            className={`px-2.5 py-1 ${metric === 'patientCount' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
          >
            New Patients
          </button>
          <button
            onClick={() => setMetric('revenue')}
            className={`px-2.5 py-1 ${metric === 'revenue' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
          >
            Revenue
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        What new patients bought on their first-ever visit, last 12 months.
        {top.length > 0 && (
          <>
            {' '}
            Highest: <strong>{top[0].serviceName}</strong> (
            {metric === 'patientCount'
              ? `${formatNumber(top[0].patientCount)} new patients`
              : formatCurrency(top[0].revenue)}
            ).
          </>
        )}
      </p>

      {chartData.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">No first-visit sales in this window.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 34)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
            <XAxis
              type="number"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => (metric === 'revenue' ? `${(v / 1000).toFixed(0)}k` : formatNumber(v))}
            />
            <YAxis type="category" dataKey="label" width={180} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value) => (metric === 'revenue' ? formatCurrency(Number(value)) : formatNumber(Number(value)))}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.serviceName ?? ''}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey={metric} fill="#6366f1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
