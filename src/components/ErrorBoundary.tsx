import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render error and says so, instead of leaving a blank page.
 *
 * Without this, any thrown error anywhere in the tree unmounts the whole app and the browser is
 * left showing nothing at all - no message, no clue which tab caused it, and no way to tell a crash
 * apart from a failed download or an empty database. A dashboard that goes silently blank is
 * indistinguishable from one that is broken beyond use, and the first thing anyone does is reload,
 * which reproduces it.
 *
 * The imported data is deliberately left alone. It lives in IndexedDB and is usually the expensive
 * thing to rebuild, so the recovery offered is a reload, not a wipe.
 */
interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept for the person reading the console; the on-screen copy stays short.
    console.error('Patient Matrix crashed while rendering:', error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 p-6 text-sm">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/40">
          <h1 className="text-lg font-semibold text-rose-800 dark:text-rose-200">Something went wrong</h1>
          <p className="mt-2 text-rose-700 dark:text-rose-300">
            The dashboard hit an error while drawing this screen and stopped rather than showing figures it could not
            finish working out. Your imported data has not been touched.
          </p>

          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 p-3 text-xs text-rose-900 dark:bg-black/30 dark:text-rose-200">
            {error.message || String(error)}
          </pre>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-500"
            >
              Reload
            </button>
            <button
              onClick={() => this.setState({ error: null, info: null })}
              className="rounded-lg border border-rose-300 px-3 py-1.5 font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-900/40"
            >
              Try again without reloading
            </button>
          </div>

          <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">
            If it returns on the same tab every time, the message above and the console trace are what identify it.
          </p>
        </div>

        {info && (
          <details className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Where it happened
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">
              {info}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
