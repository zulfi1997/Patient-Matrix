import { Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { KpiPoint, KpiUnit } from '../lib/kpiCatalog';
import { formatKpiValue } from '../lib/kpiCatalog';
import { formatMonthLabel } from '../lib/format';

export function KpiSparkline({ points, unit, color = '#6366f1' }: { points: KpiPoint[]; unit: KpiUnit; color?: string }) {
  const data = points.map((p) => ({ ...p, label: formatMonthLabel(p.month) }));
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
        <Tooltip
          formatter={(value) => formatKpiValue(Number(value), unit)}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''}
          contentStyle={{ fontSize: 11, borderRadius: 8, padding: '4px 8px' }}
        />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
