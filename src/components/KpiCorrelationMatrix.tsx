import type { KpiDefinition } from '../lib/kpiCatalog';
import { computeCorrelationMatrix, type KpiPoint } from '../lib/kpiCatalog';

function cellColor(coefficient: number): string {
  if (Number.isNaN(coefficient)) return 'text-zinc-400 dark:text-zinc-600';
  const abs = Math.abs(coefficient);
  if (abs < 0.2) return 'text-zinc-500 dark:text-zinc-400';
  const intensity = coefficient > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400';
  return abs >= 0.7 ? `${intensity} font-semibold` : intensity;
}

export function KpiCorrelationMatrix({
  selected,
  seriesById,
}: {
  selected: KpiDefinition[];
  seriesById: Map<string, KpiPoint[]>;
}) {
  const matrix = computeCorrelationMatrix(selected.map((k) => ({ id: k.id, points: seriesById.get(k.id) ?? [] })));
  const lookup = new Map<string, number>();
  for (const c of matrix) {
    lookup.set(`${c.aId}|${c.bId}`, c.coefficient);
    lookup.set(`${c.bId}|${c.aId}`, c.coefficient);
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Correlation Matrix</h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        How closely each pair of selected KPIs moves together month to month (-1 to 1). Green = move together,
        red = move oppositely, closer to 0 = no relationship.
      </p>
      <div className="max-w-full overflow-auto">
        <table className="text-left text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white py-1 pr-2 dark:bg-zinc-900" />
              {selected.map((k) => (
                <th key={k.id} className="px-2 py-1 text-center font-medium text-zinc-500 dark:text-zinc-400" style={{ writingMode: 'vertical-rl' }}>
                  {k.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selected.map((rowKpi) => (
              <tr key={rowKpi.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <th className="sticky left-0 bg-white py-1.5 pr-3 text-right font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  {rowKpi.label}
                </th>
                {selected.map((colKpi) => {
                  if (rowKpi.id === colKpi.id) {
                    return (
                      <td key={colKpi.id} className="px-2 py-1.5 text-center text-zinc-300 dark:text-zinc-700">
                        —
                      </td>
                    );
                  }
                  const coeff = lookup.get(`${rowKpi.id}|${colKpi.id}`);
                  return (
                    <td key={colKpi.id} className={`px-2 py-1.5 text-center ${cellColor(coeff ?? NaN)}`}>
                      {coeff == null || Number.isNaN(coeff) ? '—' : coeff.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
