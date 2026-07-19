import type { KpiDefinition, KpiPoint } from '../lib/kpiCatalog';
import { formatKpiValue } from '../lib/kpiCatalog';
import { KpiSparkline } from './KpiSparkline';

const CATEGORY_COLORS: Record<string, string> = {
  revenue: '#10b981',
  patient: '#6366f1',
  staff: '#f97316',
  service: '#0ea5e9',
};

export function KpiScorecardCard({ kpi, points }: { kpi: KpiDefinition; points: KpiPoint[] }) {
  const latest = points[points.length - 1];
  const prev = points[points.length - 2];
  const current = latest?.value ?? 0;
  const changePct = prev && prev.value !== 0 ? ((current - prev.value) / Math.abs(prev.value)) * 100 : null;
  const color = CATEGORY_COLORS[kpi.category] ?? '#6366f1';

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{kpi.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{formatKpiValue(current, kpi.unit)}</span>
        {changePct != null && (
          <span className={`text-xs font-medium ${changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-2">
        <KpiSparkline points={points} unit={kpi.unit} color={color} />
      </div>
    </div>
  );
}
