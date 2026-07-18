import { PRESET_LABELS, type PresetKey } from '../lib/dateRanges';
import type { DateRange } from '../lib/metrics';

interface PeriodPresetSelectProps {
  preset: PresetKey;
  onPresetChange: (preset: PresetKey) => void;
  customRange: DateRange;
  onCustomRangeChange: (range: DateRange) => void;
}

/** Just the period preset dropdown (+ custom range fields when relevant) - shared by the Dashboard and other tabs. */
export function PeriodPresetSelect({ preset, onPresetChange, customRange, onCustomRangeChange }: PeriodPresetSelectProps) {
  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Period</label>
        <select
          value={preset}
          onChange={(e) => onPresetChange(e.target.value as PresetKey)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          {Object.entries(PRESET_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {preset === 'custom' && (
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">From</label>
            <input
              type="date"
              value={customRange.start}
              onChange={(e) => onCustomRangeChange({ ...customRange, start: e.target.value })}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">To</label>
            <input
              type="date"
              value={customRange.end}
              onChange={(e) => onCustomRangeChange({ ...customRange, end: e.target.value })}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
        </div>
      )}
    </>
  );
}
