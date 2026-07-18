import { useMemo, useState } from 'react';
import { useTransactions } from './hooks/useTransactions';
import { useLocalStorageState } from './hooks/useLocalStorageState';
import { Dashboard } from './components/Dashboard';
import { NewPatientRevenueDashboard } from './components/NewPatientRevenueDashboard';
import { FlaggedTransactionsDashboard } from './components/FlaggedTransactionsDashboard';
import { DataPage } from './components/DataPage';
import { excludeFlaggedRecords, hasFlaggedNote, toAnalysisRecords } from './lib/filters';
import { formatNumber } from './lib/format';

type Tab = 'dashboard' | 'newPatientRevenue' | 'yb111' | 'data';

function App() {
  const { records, batches, loading, importFile, removeBatch, clearAllData } = useTransactions();
  const [tab, setTab] = useState<Tab>(() => 'dashboard');
  const [excludeFlagged, setExcludeFlagged] = useLocalStorageState('pm-exclude-yb111', false);

  // Dashboard analysis excludes gift card / prepaid card transactions (not clinic visits or service sales);
  // the Data tab still shows true totals for every row that was imported.
  const baseAnalysisRecords = useMemo(() => toAnalysisRecords(records), [records]);

  // The "Exclude" toggle only affects the Dashboard/New Patient Revenue tabs - the YB111
  // Analytics tab always shows flagged transactions regardless, since that's its purpose.
  const analysisRecords = useMemo(
    () => (excludeFlagged ? excludeFlaggedRecords(baseAnalysisRecords) : baseAnalysisRecords),
    [baseAnalysisRecords, excludeFlagged],
  );

  const flaggedCount = useMemo(() => records.filter(hasFlaggedNote).length, [records]);

  return (
    <div className="min-h-screen bg-zinc-50 print:bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Patient Matrix</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Clinic performance dashboard</p>
          </div>
          <nav className="flex overflow-hidden rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
            <button
              onClick={() => setTab('dashboard')}
              className={`px-4 py-1.5 ${tab === 'dashboard' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setTab('newPatientRevenue')}
              className={`px-4 py-1.5 ${tab === 'newPatientRevenue' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              New Patient Revenue
            </button>
            <button
              onClick={() => setTab('yb111')}
              className={`px-4 py-1.5 ${tab === 'yb111' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              "YB111" Analytics
            </button>
            <button
              onClick={() => setTab('data')}
              className={`px-4 py-1.5 ${tab === 'data' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Data
            </button>
          </nav>
        </div>
        {records.length > 0 && tab !== 'data' && tab !== 'yb111' && (
          <div className="mx-auto flex max-w-6xl items-center justify-end px-4 pb-3">
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={excludeFlagged}
                onChange={(e) => setExcludeFlagged(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-700"
              />
              Exclude "YB111"-flagged transactions
              {flaggedCount > 0 && ` (${formatNumber(flaggedCount)} rows)`}
            </label>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {loading ? (
          <p className="py-20 text-center text-sm text-zinc-500">Loading…</p>
        ) : records.length === 0 && tab !== 'data' ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              No data yet. Upload your sales export on the <strong>Data</strong> tab to get started.
            </p>
            <button
              onClick={() => setTab('data')}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Go to Data
            </button>
          </div>
        ) : tab === 'dashboard' ? (
          <Dashboard records={analysisRecords} />
        ) : tab === 'newPatientRevenue' ? (
          <NewPatientRevenueDashboard records={analysisRecords} />
        ) : tab === 'yb111' ? (
          <FlaggedTransactionsDashboard records={baseAnalysisRecords} />
        ) : (
          <DataPage
            records={records}
            batches={batches}
            importFile={importFile}
            removeBatch={removeBatch}
            clearAllData={clearAllData}
          />
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-zinc-400 print:hidden">
        All data is stored locally in this browser only (IndexedDB) — it is not uploaded anywhere. Use "Backup all
        data" on the Data tab periodically, and remember data won't carry over to another device or browser.
      </footer>
    </div>
  );
}

export default App;
