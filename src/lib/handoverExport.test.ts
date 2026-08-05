import { describe, expect, it } from 'vitest';
import { handoverSheets } from './dashboardExports';
import type { ProviderPatientSummary, RoleHandoverSummary, RoleRevenueTrend } from './providerHandover';

const lite = (patients: number, value: number) => ({ patients, value });

const retention: ProviderPatientSummary = {
  provider: 'Fatima Abobakir Algaoud',
  fromDate: '2026-04-14',
  total: lite(256, 71199.085),
  repeat: lite(85, 49512.583),
  onceThenElsewhere: lite(40, 4663.209),
  onceThenQuiet: lite(131, 17023.293),
  repeatRate: 33.2,
  byOrigin: {
    inherited: lite(63, 21079.774),
    fromElsewhere: lite(60, 14118.495),
    newToClinic: lite(133, 36000.816),
  },
  patients: [
    {
      patientId: 'MUS5262', patientName: 'Sana Salim Al Rawahi', outcome: 'onceThenQuiet', origin: 'newToClinic',
      firstVisitWithProvider: '2026-04-19', lastVisitWithProvider: '2026-04-19', visitsWithProvider: 1,
      valueWithProvider: 1400, seenAfterElsewhere: [], daysSinceLastVisit: 102,
    },
    {
      patientId: 'MUS3709', patientName: 'Hadeel Abdullah Al Barami', outcome: 'onceThenElsewhere', origin: 'fromElsewhere',
      firstVisitWithProvider: '2026-05-18', lastVisitWithProvider: '2026-05-18', visitsWithProvider: 1,
      valueWithProvider: 550, seenAfterElsewhere: ['Dr Ahmed'], daysSinceLastVisit: 73,
    },
  ],
};

const sheet = (sheets: ReturnType<typeof handoverSheets>, name: string) => sheets.find((s) => s.name === name);

describe('handoverSheets', () => {
  it('exports one row per patient with outcome and origin side by side', () => {
    const rows = sheet(handoverSheets({ providerPatients: retention, handover: null, revenueTrend: null }), 'Patients Seen')!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      Patient: 'Sana Salim Al Rawahi',
      Outcome: 'Once, then nothing',
      'Came From': 'New to the clinic',
      Value: 1400,
      'Days Since Last Visit': 102,
      'Last Seen Month': '2026-04',
    });
    // Where they went next is the difference between a fit problem and a lost customer.
    expect(rows[1]['Seen Afterwards By']).toBe('Dr Ahmed');
  });

  it('carries the headline figures and the origin split', () => {
    const rows = sheet(handoverSheets({ providerPatients: retention, handover: null, revenueTrend: null }), 'Retention Summary')!.rows;
    const value = (metric: string) => rows.find((r) => r.Metric === metric)?.Value;
    expect(value('Patients seen')).toBe(256);
    expect(value('Came back (%)')).toBe(33.2);
    expect(value('Once, then nothing')).toBe(131);
    expect(value('Inherited - patients')).toBe(63);
    expect(value('New to the clinic - value')).toBe(36000.816);
  });

  it('omits the handover sheets entirely when no role chain is configured', () => {
    // The retention view stands on its own - any provider can be examined whether or not they
    // inherited anything, and empty handover sheets would imply they had.
    const names = handoverSheets({ providerPatients: retention, handover: null, revenueTrend: null }).map((s) => s.name);
    expect(names).toEqual(['Retention Summary', 'Patients Seen']);
  });

  it('adds the role sheets when there is a chain', () => {
    const handover = {
      holders: [{ provider: 'Dr Obada', fromDate: '2025-01-01' }, { provider: 'Fatima', fromDate: '2026-04-14' }],
      bookFrom: '2025-01-01', handoverDate: '2026-04-14',
      inherited: { patients: 63, valueWithOriginal: 21079.774, redeemedWithOriginal: 5000 },
      stillWithRole: { patients: 40, valueWithOriginal: 15000, redeemedWithOriginal: 3000 },
      lostMidChain: { patients: 3, valueWithOriginal: 900, redeemedWithOriginal: 0 },
      wentElsewhere: { patients: 10, valueWithOriginal: 3000, redeemedWithOriginal: 1000 },
      notSeenSince: { patients: 10, valueWithOriginal: 2179.774, redeemedWithOriginal: 1000 },
      retentionRate: 63.5, valueRecovered: 8000,
      stages: [{ provider: 'Dr Obada', fromDate: '2025-01-01', untilDate: '2026-04-14', patients: 63, value: 21079.774 }],
      patients: [],
    } as RoleHandoverSummary;
    const trend = {
      points: [{ month: '2026-04-01', value: 5000, revenue: 4000, redeemed: 1000, patients: 30, byHolder: { 'Dr Obada': 2000, Fatima: 3000 }, holders: ['Dr Obada', 'Fatima'] }],
      byHolder: [{ provider: 'Fatima', fromDate: '2026-04-14', untilDate: null, days: 107, value: 71199.085, revenue: 60000, patients: 256, valuePerMonth: 20260.5 }],
    } as RoleRevenueTrend;

    const sheets = handoverSheets({ providerPatients: retention, handover, revenueTrend: trend });
    expect(sheets.map((s) => s.name)).toEqual([
      'Retention Summary', 'Patients Seen', 'Handover Summary', 'Role Stages', 'Inherited Patients',
      'Role Revenue Trend', 'Role By Holder',
    ]);
    // A month spanning the handover shows both holders rather than being credited wholly to one.
    expect(sheet(sheets, 'Role Revenue Trend')!.rows[0]).toMatchObject({ 'Dr Obada': 2000, Fatima: 3000, 'Held By': 'Dr Obada / Fatima' });
    expect(sheet(sheets, 'Role By Holder')!.rows[0]['Value Per Month Held']).toBe(20260.5);
  });
});
