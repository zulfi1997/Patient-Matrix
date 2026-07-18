interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'bad';
}

const toneClasses: Record<NonNullable<KpiCardProps['tone']>, string> = {
  neutral: 'text-zinc-900 dark:text-zinc-100',
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
};

export function KpiCard({ label, value, hint, tone = 'neutral' }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-1 truncate text-xl font-semibold ${toneClasses[tone]}`} title={value}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>}
    </div>
  );
}
