import { InfoTooltip } from './InfoTooltip';

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  /** Explanation of what this field means or how it's computed, shown behind an "i" icon next to the label - for fields a user might have doubts about. */
  help?: string;
  tone?: 'neutral' | 'good' | 'bad';
}

const toneClasses: Record<NonNullable<KpiCardProps['tone']>, string> = {
  neutral: 'text-zinc-900 dark:text-zinc-100',
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
};

export function KpiCard({ label, value, hint, help, tone = 'neutral' }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm print:break-inside-avoid print:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        {help && <InfoTooltip text={help} />}
      </div>
      <div className={`mt-1 truncate text-xl font-semibold ${toneClasses[tone]}`} title={value}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>}
    </div>
  );
}
