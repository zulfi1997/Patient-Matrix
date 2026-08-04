import { useState } from 'react';
import { DECK_SECTIONS, orderedSections, type DeckConfig, type DeckSectionId } from '../lib/deckSections';
import { useLocalStorageState } from '../hooks/useLocalStorageState';

export function DeckBuilder({
  defaultTitle,
  defaultSubtitle,
  onBuild,
  onClose,
}: {
  defaultTitle: string;
  defaultSubtitle: string;
  onBuild: (config: DeckConfig) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useLocalStorageState('pm-deck-title', defaultTitle);
  const [subtitle, setSubtitle] = useLocalStorageState('pm-deck-subtitle', defaultSubtitle);
  const [selected, setSelected] = useLocalStorageState<DeckSectionId[]>('pm-deck-sections', [
    'kpis', 'patientTrend', 'revenueTrend', 'topServices', 'retention',
  ]);
  const [notes, setNotes] = useLocalStorageState<Partial<Record<DeckSectionId, string>>>('pm-deck-notes', {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = new Set(selected);
  const ordered = orderedSections(selected);

  const toggle = (id: DeckSectionId) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      await onBuild({ title, subtitle, sections: ordered, notes });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build the presentation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-300 bg-white p-4 shadow-sm print:hidden dark:border-indigo-900 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Build a Presentation</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Choose the slides, and write what each one should say. Figures come from the period selected above, so the
            deck matches what is on screen. Notes are printed on the slide beneath the numbers.
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Close
        </button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Patient Matrix"
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Subtitle
          <input
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Monthly Performance Review"
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {DECK_SECTIONS.map((section) => {
          const on = chosen.has(section.id);
          return (
            <div
              key={section.id}
              className={`rounded-lg border p-3 ${on ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-900 dark:bg-indigo-950/20' : 'border-zinc-200 dark:border-zinc-800'}`}
            >
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" checked={on} onChange={() => toggle(section.id)} className="mt-0.5" />
                <span>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{section.label}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{section.description}</span>
                </span>
              </label>
              {on && (
                <textarea
                  value={notes[section.id] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [section.id]: e.target.value }))}
                  rows={2}
                  placeholder="What should this slide say? Left blank, the slide shows the figures alone."
                  className="mt-2 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={build}
          disabled={busy || ordered.length === 0}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Building…' : `Download ${ordered.length + 1}-slide deck`}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {ordered.length === 0
            ? 'Pick at least one section.'
            : `Title slide plus ${ordered.length} section${ordered.length === 1 ? '' : 's'}, in the order listed above.`}
        </span>
      </div>
    </div>
  );
}
