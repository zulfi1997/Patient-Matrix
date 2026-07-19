import { KPI_CATALOG, type KpiCategory } from '../lib/kpiCatalog';

const CATEGORY_LABELS: Record<KpiCategory, string> = {
  revenue: 'Revenue',
  patient: 'Patient',
  staff: 'Staff',
  service: 'Service',
};

const CATEGORY_ORDER: KpiCategory[] = ['revenue', 'patient', 'staff', 'service'];

export function KpiPicker({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:hidden dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Choose KPIs to Evaluate <span className="font-normal text-zinc-500 dark:text-zinc-400">({selected.size} selected)</span>
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CATEGORY_ORDER.map((category) => (
          <div key={category}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {CATEGORY_LABELS[category]}
            </h4>
            <ul className="flex flex-col gap-2">
              {KPI_CATALOG.filter((k) => k.category === category).map((kpi) => (
                <li key={kpi.id}>
                  <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={selected.has(kpi.id)}
                      onChange={() => onToggle(kpi.id)}
                      className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700"
                    />
                    <span>
                      {kpi.label}
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{kpi.description}</div>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
