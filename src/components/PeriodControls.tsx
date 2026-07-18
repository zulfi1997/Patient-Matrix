import type { PresetKey } from '../lib/dateRanges';
import type { DateRange } from '../lib/metrics';
import { PeriodPresetSelect } from './PeriodPresetSelect';

interface PeriodControlsProps {
  preset: PresetKey;
  onPresetChange: (preset: PresetKey) => void;
  customRange: DateRange;
  onCustomRangeChange: (range: DateRange) => void;
  inactivityDays: number;
  onInactivityDaysChange: (days: number) => void;
}

const INACTIVITY_OPTIONS = [30, 60, 90, 120, 180];

export function PeriodControls({
  preset,
  onPresetChange,
  customRange,
  onCustomRangeChange,
  inactivityDays,
  onInactivityDaysChange,
}: PeriodControlsProps) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <PeriodPresetSelect
        preset={preset}
        onPresetChange={onPresetChange}
        customRange={customRange}
        onCustomRangeChange={onCustomRangeChange}
      />

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          "Stopped visiting" after
        </label>
        <select
          value={inactivityDays}
          onChange={(e) => onInactivityDaysChange(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          {INACTIVITY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days of inactivity
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
