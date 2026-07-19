import type { KpiDefinition, KpiPeriodValue, KpiPoint } from '../lib/kpiCatalog';
import { formatKpiValue } from '../lib/kpiCatalog';
import { KpiSparkline } from './KpiSparkline';

const CATEGORY_COLORS: Record<string, string> = {
  revenue: '#10b981',
  patient: '#6366f1',
  staff: '#f97316',
  service: '#0ea5e9',
};

export function KpiScorecardCard({
  kpi,
  periodValue,
  series,
}: {
  kpi: KpiDefinition;
  periodValue: KpiPeriodValue;
  series: KpiPoint[];
}) {
  const color = CATEGORY_COLORS[kpi.category] ?? '#6366f1';

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{kpi.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          {formatKpiValue(periodValue.current, kpi.unit)}
        </span>
        {periodValue.changePct != null && (
          <span
            className={`text-xs font-medium ${periodValue.changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
          >
            {periodValue.changePct >= 0 ? '▲' : '▼'} {Math.abs(periodValue.changePct).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">vs. prior period</div>
      <div className="mt-2">
        <KpiSparkline points={series} unit={kpi.unit} color={color} />
      </div>
    </div>
  );
}
