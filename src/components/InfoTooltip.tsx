import { useEffect, useRef, useState } from 'react';

/** A small "i" icon that reveals an explanation on click/tap or keyboard focus - for fields whose meaning or computation isn't obvious from the label alone. */
export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="What does this mean?"
        aria-expanded={open}
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-zinc-400 text-[9px] font-semibold leading-none text-zinc-400 hover:border-zinc-500 hover:text-zinc-500 dark:border-zinc-600 dark:text-zinc-500 dark:hover:border-zinc-400 dark:hover:text-zinc-400"
      >
        i
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1.5 w-56 max-w-[80vw] -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2 text-xs font-normal normal-case leading-snug tracking-normal text-zinc-600 shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {text}
        </div>
      )}
    </span>
  );
}
