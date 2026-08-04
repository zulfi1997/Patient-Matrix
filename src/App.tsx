import { useCallback, useMemo, useState } from 'react';
import { useTransactions } from './hooks/useTransactions';
import { usePackageBenefits } from './hooks/usePackageBenefits';
import { usePnl } from './hooks/usePnl';
import { useOneDrive } from './hooks/useOneDrive';
import { useStaffScorecards } from './hooks/useStaffScorecards';
import { useManualKpiEntries } from './hooks/useManualKpiEntries';
import { useServiceDepartments } from './hooks/useServiceDepartments';
import { useLocalStorageState } from './hooks/useLocalStorageState';
import { Dashboard } from './components/Dashboard';
import { NewPatientRevenueDashboard } from './components/NewPatientRevenueDashboard';
import { FlaggedTransactionsDashboard } from './components/FlaggedTransactionsDashboard';
import { KpiEvaluationDashboard } from './components/KpiEvaluationDashboard';
import { ProviderConversionDashboard } from './components/ProviderConversionDashboard';
import { ProviderAnalyticsDashboard } from './components/ProviderAnalyticsDashboard';
import { SegmentPnlDashboard } from './components/SegmentPnlDashboard';
import { StaffScorecardsDashboard } from './components/StaffScorecardsDashboard';
import { DepartmentAnalyticsDashboard } from './components/DepartmentAnalyticsDashboard';
import { DataPage } from './components/DataPage';
import { InfoTooltip } from './components/InfoTooltip';
import { excludeFlaggedRecords, excludeZeroValueRecords, hasFlaggedNote, hasVisitValue, toAnalysisRecords } from './lib/filters';
import { summarizePatients } from './lib/metrics';
import type { ProviderAssignmentOverride, ProviderGroup, RevenueAdjustment } from './lib/conversionMetrics';
import type { AllocationMode, PnlLineAdjustment, SegmentAllocationRule } from './lib/segmentAllocation';
import { formatNumber } from './lib/format';

type Tab = 'dashboard' | 'newPatientRevenue' | 'kpi' | 'conversion' | 'providerAnalytics' | 'yb111' | 'segmentPnl' | 'staffScorecards' | 'departments' | 'data';

function App() {
  const {
    records,
    batches,
    loading,
    importFile,
    removeBatch,
    clearAllData: clearAllTransactions,
    removeTransactionsByIds,
  } = useTransactions();
  const {
    packageBenefits,
    packageBenefitBatches,
    importPackageBenefitFile,
    removePackageBenefitSnapshot,
    refresh: refreshPackageBenefits,
  } = usePackageBenefits();
  const { pnlLines, pnlBatches, importPnlFile, removePnlBatch, clearAllPnl, refresh: refreshPnl } = usePnl();
  const { scorecards, importOfferLetter, removeScorecard: removeScorecardOnly } = useStaffScorecards();
  const { entries: manualKpiEntries, setManualKpiValue, refresh: refreshManualKpiEntries } = useManualKpiEntries();
  const {
    records: serviceDepartmentRecords,
    batch: departmentMappingBatch,
    setDepartment: setServiceDepartment,
    importFile: importDepartmentMappingFile,
  } = useServiceDepartments();
  const oneDrive = useOneDrive();
  const [tab, setTab] = useState<Tab>(() => 'dashboard');

  const removeScorecard = useCallback(
    async (id: string) => {
      await removeScorecardOnly(id);
      await refreshManualKpiEntries();
    },
    [removeScorecardOnly, refreshManualKpiEntries],
  );

  const clearAllData = useCallback(async () => {
    await clearAllTransactions();
    await refreshPackageBenefits();
    await refreshPnl();
  }, [clearAllTransactions, refreshPackageBenefits, refreshPnl]);
  const [excludeFlagged, setExcludeFlagged] = useLocalStorageState('pm-exclude-yb111', false);
  const [excludeZeroValue, setExcludeZeroValue] = useLocalStorageState('pm-exclude-zero-value', false);
  const [providerGroups, setProviderGroups] = useLocalStorageState<ProviderGroup[]>('pm-provider-groups', []);
  const [revenueAdjustments, setRevenueAdjustments] = useLocalStorageState<RevenueAdjustment[]>('pm-revenue-adjustments', []);
  const [providerAssignmentOverrides, setProviderAssignmentOverrides] = useLocalStorageState<ProviderAssignmentOverride[]>(
    'pm-provider-assignment-overrides',
    [],
  );
  const [allocationRules, setAllocationRules] = useLocalStorageState<SegmentAllocationRule[]>('pm-segment-allocation-rules', []);
  const [allocationMode, setAllocationMode] = useLocalStorageState<AllocationMode>('pm-pnl-allocation-mode', 'percentage');
  const [pnlLineAdjustments, setPnlLineAdjustments] = useLocalStorageState<PnlLineAdjustment[]>('pm-pnl-line-adjustments', []);
  const pnlSegments = useMemo(() => [...new Set(pnlBatches.flatMap((b) => b.segments))].sort(), [pnlBatches]);

  // Dashboard analysis excludes gift card / prepaid card transactions (not clinic visits or service sales);
  // the Data tab still shows true totals for every row that was imported.
  const baseAnalysisRecords = useMemo(() => toAnalysisRecords(records), [records]);

  // The "Exclude" toggles apply on the Dashboard/New Patient Revenue/KPI Evaluation/Staff
  // Scorecards tabs - the YB111 Analytics tab always shows flagged transactions regardless,
  // since that's its purpose.
  const flaggedFilteredRecords = useMemo(
    () => (excludeFlagged ? excludeFlaggedRecords(baseAnalysisRecords) : baseAnalysisRecords),
    [baseAnalysisRecords, excludeFlagged],
  );

  // Zero-value line items (no revenue, no package redemption - e.g. a complimentary
  // service) never count as a "visit" for retention once excluded; package redemptions
  // (net revenue 0 but redeemedAmount > 0) are untouched, since those are real, already-paid visits.
  const analysisRecords = useMemo(
    () => (excludeZeroValue ? excludeZeroValueRecords(flaggedFilteredRecords) : flaggedFilteredRecords),
    [flaggedFilteredRecords, excludeZeroValue],
  );

  const patients = useMemo(() => summarizePatients(analysisRecords), [analysisRecords]);

  const flaggedCount = useMemo(() => records.filter(hasFlaggedNote).length, [records]);
  const zeroValueCount = useMemo(() => baseAnalysisRecords.filter((r) => !hasVisitValue(r)).length, [baseAnalysisRecords]);

  return (
    <div className="min-h-screen bg-zinc-50 print:bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-col items-stretch gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Patient Matrix</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Clinic performance dashboard</p>
          </div>
          {/* overflow-x-auto (not overflow-hidden) so a narrow/mobile screen can swipe to reach
              tabs past the visible width instead of them being silently clipped and unreachable -
              shrink-0 on each button keeps their width readable instead of being squeezed. */}
          <nav className="flex overflow-x-auto rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
            <button
              onClick={() => setTab('dashboard')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'dashboard' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setTab('newPatientRevenue')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'newPatientRevenue' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              New Patient Revenue
            </button>
            <button
              onClick={() => setTab('kpi')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'kpi' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              KPI Evaluation
            </button>
            <button
              onClick={() => setTab('conversion')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'conversion' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Provider Conversion
            </button>
            <button
              onClick={() => setTab('providerAnalytics')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'providerAnalytics' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Provider Analytics
            </button>
            <button
              onClick={() => setTab('yb111')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'yb111' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              "YB111" Analytics
            </button>
            <button
              onClick={() => setTab('segmentPnl')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'segmentPnl' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Segment P&amp;L
            </button>
            <button
              onClick={() => setTab('staffScorecards')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'staffScorecards' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Staff Scorecards
            </button>
            <button
              onClick={() => setTab('departments')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'departments' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Departments
            </button>
            <button
              onClick={() => setTab('data')}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 ${tab === 'data' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
            >
              Data
            </button>
          </nav>
        </div>
        {records.length > 0 && tab !== 'data' && tab !== 'yb111' && tab !== 'conversion' && tab !== 'providerAnalytics' && tab !== 'segmentPnl' && (
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-x-4 gap-y-1 px-4 pb-3">
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={excludeFlagged}
                onChange={(e) => setExcludeFlagged(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-700"
              />
              Exclude "YB111"-flagged transactions
              {flaggedCount > 0 && ` (${formatNumber(flaggedCount)} rows)`}
              <InfoTooltip text={`Removes every line item whose Invoice Notes mention "YB111" (any case) from this tab's figures before anything else is computed. The dedicated "YB111" Analytics tab always shows these transactions regardless of this toggle.`} />
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={excludeZeroValue}
                onChange={(e) => setExcludeZeroValue(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-700"
              />
              Exclude zero-revenue visits (e.g. complimentary services)
              {zeroValueCount > 0 && ` (${formatNumber(zeroValueCount)} rows)`}
              <InfoTooltip text="Excludes line items with no revenue and no package redemption (e.g. a complimentary service) from patient activity - New/Returning/Active/Retention/Turnover/Stopped Visiting. Package sessions redeemed from a previously-sold package still count as real visits." />
            </label>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {loading ? (
          <p className="py-20 text-center text-sm text-zinc-500">Loading…</p>
        ) : records.length === 0 && tab !== 'data' && tab !== 'segmentPnl' && tab !== 'staffScorecards' ? (
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
          <Dashboard
            records={analysisRecords}
            rawRecords={records}
            batches={batches}
            excludeFlagged={excludeFlagged}
            excludeZeroValue={excludeZeroValue}
            providerGroups={providerGroups}
            providerAssignmentOverrides={providerAssignmentOverrides}
          />
        ) : tab === 'newPatientRevenue' ? (
          <NewPatientRevenueDashboard records={analysisRecords} pnlLines={pnlLines} />
        ) : tab === 'kpi' ? (
          <KpiEvaluationDashboard
            records={analysisRecords}
            providerGroups={providerGroups}
            providerAssignmentOverrides={providerAssignmentOverrides}
          />
        ) : tab === 'conversion' ? (
          <ProviderConversionDashboard
            records={baseAnalysisRecords}
            packageBenefits={packageBenefits}
            providerGroups={providerGroups}
            revenueAdjustments={revenueAdjustments}
            providerAssignmentOverrides={providerAssignmentOverrides}
          />
        ) : tab === 'providerAnalytics' ? (
          <ProviderAnalyticsDashboard
            records={analysisRecords}
            packageBenefits={packageBenefits}
            serviceDepartmentRecords={serviceDepartmentRecords}
            providerGroups={providerGroups}
            providerAssignmentOverrides={providerAssignmentOverrides}
            revenueAdjustments={revenueAdjustments}
          />
        ) : tab === 'yb111' ? (
          <FlaggedTransactionsDashboard records={baseAnalysisRecords} />
        ) : tab === 'segmentPnl' ? (
          <SegmentPnlDashboard
            pnlLines={pnlLines}
            pnlBatches={pnlBatches}
            allocationRules={allocationRules}
            allocationMode={allocationMode}
            setAllocationMode={setAllocationMode}
            pnlLineAdjustments={pnlLineAdjustments}
          />
        ) : tab === 'staffScorecards' ? (
          <StaffScorecardsDashboard
            records={analysisRecords}
            patients={patients}
            scorecards={scorecards}
            manualEntries={manualKpiEntries}
            importOfferLetter={importOfferLetter}
            removeScorecard={removeScorecard}
            setManualKpiValue={setManualKpiValue}
          />
        ) : tab === 'departments' ? (
          <DepartmentAnalyticsDashboard
            records={analysisRecords}
            patients={patients}
            packageBenefits={packageBenefits}
            serviceDepartmentRecords={serviceDepartmentRecords}
            providerGroups={providerGroups}
            providerAssignmentOverrides={providerAssignmentOverrides}
          />
        ) : (
          <DataPage
            records={records}
            batches={batches}
            importFile={importFile}
            removeBatch={removeBatch}
            clearAllData={clearAllData}
            removeTransactionsByIds={removeTransactionsByIds}
            packageBenefits={packageBenefits}
            packageBenefitBatches={packageBenefitBatches}
            importPackageBenefitFile={importPackageBenefitFile}
            removePackageBenefitSnapshot={removePackageBenefitSnapshot}
            providerGroups={providerGroups}
            setProviderGroups={setProviderGroups}
            revenueAdjustments={revenueAdjustments}
            setRevenueAdjustments={setRevenueAdjustments}
            providerAssignmentOverrides={providerAssignmentOverrides}
            setProviderAssignmentOverrides={setProviderAssignmentOverrides}
            serviceDepartmentRecords={serviceDepartmentRecords}
            departmentMappingBatch={departmentMappingBatch}
            setServiceDepartment={setServiceDepartment}
            importDepartmentMappingFile={importDepartmentMappingFile}
            pnlLines={pnlLines}
            pnlBatches={pnlBatches}
            importPnlFile={importPnlFile}
            removePnlBatch={removePnlBatch}
            clearAllPnl={clearAllPnl}
            pnlSegments={pnlSegments}
            allocationRules={allocationRules}
            setAllocationRules={setAllocationRules}
            allocationMode={allocationMode}
            pnlLineAdjustments={pnlLineAdjustments}
            setPnlLineAdjustments={setPnlLineAdjustments}
            oneDrive={oneDrive}
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
