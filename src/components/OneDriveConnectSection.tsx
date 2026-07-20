import type { AccountInfo } from '@azure/msal-browser';

export function OneDriveConnectSection({
  account,
  loading,
  error,
  signIn,
  signOut,
}: {
  account: AccountInfo | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">OneDrive</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Optional - sign in once to enable a "Pull from OneDrive" button on each upload section below, instead of
            choosing files manually every time. Manual upload always stays available either way.
          </p>
        </div>
        {loading ? (
          <span className="text-xs text-zinc-400">Checking sign-in status…</span>
        ) : account ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              Signed in as <strong>{account.username}</strong>
            </span>
            <button
              onClick={() => signOut()}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            onClick={() => signIn()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Sign in with Microsoft
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
