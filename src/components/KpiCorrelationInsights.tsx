import type { KpiDefinition } from '../lib/kpiCatalog';
import { computeCorrelationMatrix, correlationStrengthLabel, type KpiPoint } from '../lib/kpiCatalog';

export function KpiCorrelationInsights({
  selected,
  seriesById,
}: {
  selected: KpiDefinition[];
  seriesById: Map<string, KpiPoint[]>;
}) {
  const byId = new Map(selected.map((k) => [k.id, k]));
  const matrix = computeCorrelationMatrix(selected.map((k) => ({ id: k.id, points: seriesById.get(k.id) ?? [] })))
    .filter((c) => !Number.isNaN(c.coefficient) && Math.abs(c.coefficient) >= 0.4)
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))
    .slice(0, 8);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Relationship Insights</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        The strongest relationships found among your selected KPIs, based on how they moved together over the
        available months.
      </p>
      {matrix.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">
          Select at least 2 KPIs with enough history to see relationships (nothing moderate or stronger found yet).
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {matrix.map((c) => {
            const a = byId.get(c.aId);
            const b = byId.get(c.bId);
            if (!a || !b) return null;
            const direction = c.coefficient >= 0 ? 'move together' : 'move in opposite directions';
            return (
              <li key={`${c.aId}-${c.bId}`} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
                <strong>{a.label}</strong> and <strong>{b.label}</strong> are{' '}
                <span className="font-medium">{correlationStrengthLabel(c.coefficient)}</span> correlated — they {direction}{' '}
                <span className="text-zinc-500 dark:text-zinc-400">(r = {c.coefficient.toFixed(2)})</span>.
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
