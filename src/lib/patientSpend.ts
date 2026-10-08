import type { SaleRecord } from '../types';
import { isInRange, type DateRange, type PatientVisitSummary } from './metrics';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';
import type { CollectionRecord } from '../types';
import { isCashCollection, methodOf } from './collectionsParser';

/**
 * Who spends the most, and with whom.
 *
 * Ranks patients by what they spent in a period, keeping cash and package-delivered value apart
 * because they answer different questions. A patient who bought a large package in January is the
 * month's top spender on cash and barely registers for the rest of the year; the same patient on
 * delivered value is steady for months while bringing in nothing new. A list that nets the two
 * together would hide both facts.
 */

export type SpendBasis = 'revenue' | 'deliveredValue';

export const SPEND_BASIS_LABELS: Record<SpendBasis, string> = {
  revenue: 'Revenue',
  deliveredValue: 'Value Delivered',
};

export interface PatientSpend {
  patientId: string;
  patientName: string;
  /**
   * Revenue recognized against this patient in the period: Sales (Exc. Tax) less anything drawn
   * from a package they already held. Negative where refunds outweighed sales.
   *
   * Deliberately not money received. A treatment settled by a gift or prepaid card bought months
   * ago counts here in full, because the card purchase was never revenue and this invoice is the
   * sale. An invoice still unpaid counts too. What was actually collected, and when, is the
   * Collections import's question, not this one.
   */
  revenue: number;
  /** Value of previously-bought package sessions consumed in the period. */
  redeemed: number;
  deliveredValue: number;
  /** Distinct days they attended in the period. */
  visits: number;
  invoices: number;
  lastVisit: string;
  /** Provider who earned the most of this patient's spend in the period. */
  topProvider: string;
  /** How many providers they saw. A high spender split across several is a different risk to one tied to a single person. */
  providerCount: number;
  /** Share of their period spend that went to topProvider, 0-100. */
  topProviderShare: number;
  /** First-ever visit, from full history - so a long-standing patient is not mistaken for a new one. */
  firstVisit: string | null;
  /** Lifetime revenue across all data, for context beside the period figure. */
  lifetimeRevenue: number;

  /**
   * Money actually received from this patient in the period, from the Collections import.
   *
   * By payment date, not sale date, so it answers "what came in" rather than "what was billed".
   * The two deliberately will not tie to Revenue: an instalment paid in June may settle a March
   * invoice, and a package bought in March pays for June's sessions. Null where no Collections
   * export has been imported, which is different from a patient who paid nothing.
   */
  collected: number | null;
  /** Refunds handed back in the period, as a negative. Null when no Collections data is loaded. */
  refunded: number | null;
  /** collected + refunded. Null when no Collections data is loaded. */
  netCollected: number | null;
}

export interface PatientSpendSummary {
  patients: PatientSpend[];
  /** Period totals across every patient, not just the ones listed. */
  totalRevenue: number;
  totalDeliveredValue: number;
  totalPatients: number;
}

export function spendOf(p: PatientSpend, basis: SpendBasis): number {
  return basis === 'revenue' ? p.revenue : p.deliveredValue;
}

/**
 * Spend per patient over a period, ranked highest first.
 *
 * `history` carries first visit and lifetime figures and should come from the unfiltered records,
 * for the same reason the New Patients count does: an Exclude toggle says which lines to count in
 * the period, not that the patient's earlier visits never happened.
 */
export function computePatientSpend(
  records: SaleRecord[],
  range: DateRange,
  history: Map<string, PatientVisitSummary>,
  providerGroups: ProviderGroup[],
  overrides: ProviderAssignmentOverride[],
  /**
   * Collections rows, when a Collections export has been imported. Omitted rather than empty when
   * there are none, so "nothing collected" and "nothing to go on" stay distinguishable on screen.
   */
  collections?: CollectionRecord[],
): PatientSpendSummary {
  interface Acc {
    spend: PatientSpend;
    days: Set<string>;
    invoiceNos: Set<string>;
    byProvider: Map<string, number>;
  }

  const byPatient = new Map<string, Acc>();
  let totalRevenue = 0;
  let totalDeliveredValue = 0;

  for (const r of records) {
    if (!isInRange(r.date, range)) continue;

    let acc = byPatient.get(r.patientId);
    if (!acc) {
      const h = history.get(r.patientId);
      acc = {
        spend: {
          patientId: r.patientId,
          patientName: r.patientName,
          revenue: 0,
          redeemed: 0,
          deliveredValue: 0,
          visits: 0,
          invoices: 0,
          lastVisit: r.date,
          topProvider: '',
          providerCount: 0,
          topProviderShare: 0,
          firstVisit: h?.firstVisit ?? null,
          lifetimeRevenue: h?.lifetimeRevenue ?? 0,
          collected: null,
          refunded: null,
          netCollected: null,
        },
        days: new Set(),
        invoiceNos: new Set(),
        byProvider: new Map(),
      };
      byPatient.set(r.patientId, acc);
    }

    const s = acc.spend;
    s.revenue += r.amount;
    s.redeemed += r.redeemedAmount;
    s.deliveredValue += r.amount + r.redeemedAmount;
    if (r.patientName) s.patientName = r.patientName;
    if (r.date > s.lastVisit) s.lastVisit = r.date;
    acc.days.add(r.date);
    if (r.invoiceNo) acc.invoiceNos.add(r.invoiceNo);

    // Credited on delivered value, so a provider who worked through a package is not shown as
    // having contributed nothing to a patient they in fact spent the period treating.
    const provider = resolveProvider(r.staff, r.date, providerGroups, overrides);
    acc.byProvider.set(provider, (acc.byProvider.get(provider) ?? 0) + r.amount + r.redeemedAmount);

    totalRevenue += r.amount;
    totalDeliveredValue += r.amount + r.redeemedAmount;
  }

  const patients: PatientSpend[] = [];
  for (const acc of byPatient.values()) {
    const s = acc.spend;
    s.visits = acc.days.size;
    s.invoices = acc.invoiceNos.size;
    s.providerCount = acc.byProvider.size;

    let top = '';
    let topValue = -Infinity;
    for (const [provider, value] of acc.byProvider) {
      if (value > topValue) {
        top = provider;
        topValue = value;
      }
    }
    s.topProvider = top;
    // Against the patient's own delivered value, so the share reads as "how much of this patient
    // belongs to that provider" rather than being distorted by a refund elsewhere in the period.
    s.topProviderShare = s.deliveredValue > 0 ? (Math.max(topValue, 0) / s.deliveredValue) * 100 : 0;

    patients.push(s);
  }

  // Collections are keyed by patient in the export itself, so no invoice lookup is needed. Only
  // patients who already appear above are filled in: someone who paid in the period but was billed
  // outside it belongs to whichever period billed them, and inventing a row for them here would put
  // a patient with no spend at the top of a spend ranking.
  if (collections) {
    for (const p of patients) {
      p.collected = 0;
      p.refunded = 0;
      p.netCollected = 0;
    }
    const byId = new Map(patients.map((p) => [p.patientId, p]));
    for (const c of collections) {
      if (!isInRange(c.date, range)) continue;
      // Package, gift-card and prepaid-card settlements are a redemption of money banked earlier,
      // and an internal transfer never leaves the clinic - none of it is cash collected now.
      if (!isCashCollection(methodOf(c))) continue;
      const row = byId.get(c.patientId);
      if (!row) continue;
      if (c.amount < 0) row.refunded = (row.refunded ?? 0) + c.amount;
      else row.collected = (row.collected ?? 0) + c.amount;
      row.netCollected = (row.netCollected ?? 0) + c.amount;
    }
  }

  return {
    patients,
    totalRevenue,
    totalDeliveredValue,
    totalPatients: patients.length,
  };
}

/** The top `limit` patients on the chosen basis, highest first. Ties keep insertion order. */
export function topSpenders(summary: PatientSpendSummary, basis: SpendBasis, limit: number): PatientSpend[] {
  return [...summary.patients]
    .sort((a, b) => spendOf(b, basis) - spendOf(a, basis))
    .slice(0, limit);
}

/**
 * What share of the period's takings the listed patients account for.
 *
 * The number that makes the list worth reading: ten patients carrying half the month is a
 * concentration risk, and the same ten carrying a twentieth of it is not.
 */
export function spendConcentration(
  summary: PatientSpendSummary,
  rows: PatientSpend[],
  basis: SpendBasis,
): number | null {
  const total = basis === 'revenue' ? summary.totalRevenue : summary.totalDeliveredValue;
  if (total <= 0) return null;
  const listed = rows.reduce((sum, p) => sum + spendOf(p, basis), 0);
  return (listed / total) * 100;
}
