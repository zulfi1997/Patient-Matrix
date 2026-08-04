import type { SaleRecord } from '../types';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';
import { daysBetween } from './metrics';

/**
 * What became of one inherited patient after the handover. Exactly one applies, and `retained`
 * wins outright: a patient who saw the successor counts as kept even if they also saw others.
 */
export type HandoverOutcome = 'retained' | 'movedToOther' | 'notSeenSince';

export interface HandoverPatient {
  patientId: string;
  patientName: string;
  outcome: HandoverOutcome;
  /** Their last visit with the outgoing provider, on or before the handover date. */
  lastVisitWithOutgoing: string;
  visitsWithOutgoing: number;
  /** What they were worth to the outgoing provider - cash plus package value consumed. */
  valueWithOutgoing: number;
  /** First visit with the successor after the handover; null unless retained. */
  firstVisitWithIncoming: string | null;
  /** Visit days anywhere in the clinic since the handover. */
  visitsSinceHandover: number;
  valueSinceHandover: number;
  /** Providers actually seen since the handover, for a patient who went elsewhere. */
  seenBy: string[];
  /** Days since their last visit anywhere, as of the report date. */
  daysSinceLastVisit: number;
}

export interface HandoverBucket {
  patients: number;
  /** Combined value those patients had with the outgoing provider - the share of the book. */
  valueWithOutgoing: number;
}

export interface HandoverSummary {
  outgoing: string;
  incoming: string;
  handoverDate: string;
  /** Start of the window defining the inherited book; null when it is all-time. */
  bookFrom: string | null;
  inherited: HandoverBucket;
  retained: HandoverBucket;
  movedToOther: HandoverBucket;
  notSeenSince: HandoverBucket;
  /** retained / inherited, as a percentage. Null when nothing was inherited. */
  retentionRate: number | null;
  /** Value those retained patients have delivered since the handover - the book actually recovered. */
  valueRecovered: number;
  patients: HandoverPatient[];
}

interface Agg {
  patientName: string;
  withOutgoingDates: Set<string>;
  valueWithOutgoing: number;
  lastVisitWithOutgoing: string;
  sinceDates: Set<string>;
  valueSinceHandover: number;
  firstVisitWithIncoming: string | null;
  seenBy: Set<string>;
  lastVisitAnywhere: string;
}

const lineValue = (r: SaleRecord) => r.amount + r.redeemedAmount;

function emptyBucket(): HandoverBucket {
  return { patients: 0, valueWithOutgoing: 0 };
}

/**
 * Measures what happened to a departing provider's patients after a successor took over.
 *
 * The question a handover actually raises is not how the successor is performing in isolation -
 * it is how much of the book they kept. Every inherited patient lands in exactly one of three
 * outcomes, which is deliberately finer than "retained vs lost": a patient who is still visiting
 * the clinic but seeing someone else has not been lost, they have been redistributed, and that is
 * a different problem from one who has not come back at all.
 *
 * Staff names are folded through resolveProvider, so an assisting nurse's lines count under
 * whichever doctor she was assisting on that date - without that, a nurse's visits would look
 * like a separate provider and the book would be understated on both sides of the handover.
 *
 * The inherited book is defined by `lookbackDays` before the handover. All-time is rarely what
 * you want: a patient seen once years ago was never really part of what changed hands, and
 * counting them depresses the retention rate with people who had already left.
 */
export function computeProviderHandover(
  records: SaleRecord[],
  params: {
    outgoing: string;
    incoming: string;
    handoverDate: string;
    asOfISO: string;
    /** Days before the handover that define the inherited book; 0 or undefined means all-time. */
    lookbackDays?: number;
    providerGroups?: ProviderGroup[];
    overrides?: ProviderAssignmentOverride[];
  },
): HandoverSummary {
  const { outgoing, incoming, handoverDate, asOfISO, lookbackDays = 0, providerGroups = [], overrides = [] } = params;

  const bookFrom = lookbackDays > 0 ? isoDaysBefore(handoverDate, lookbackDays) : null;
  const byPatient = new Map<string, Agg>();

  for (const r of records) {
    const provider = resolveProvider(r.staff, r.date, providerGroups, overrides);
    const isBookWindow = r.date <= handoverDate && (!bookFrom || r.date >= bookFrom);

    // Only patients the outgoing provider actually saw in the window are part of the book, so
    // build the entry lazily from those lines and enrich it afterwards.
    if (isBookWindow && provider === outgoing) {
      let agg = byPatient.get(r.patientId);
      if (!agg) {
        agg = {
          patientName: r.patientName,
          withOutgoingDates: new Set(),
          valueWithOutgoing: 0,
          lastVisitWithOutgoing: r.date,
          sinceDates: new Set(),
          valueSinceHandover: 0,
          firstVisitWithIncoming: null,
          seenBy: new Set(),
          lastVisitAnywhere: r.date,
        };
        byPatient.set(r.patientId, agg);
      }
      agg.withOutgoingDates.add(r.date);
      agg.valueWithOutgoing += lineValue(r);
      if (r.date > agg.lastVisitWithOutgoing) agg.lastVisitWithOutgoing = r.date;
      if (r.patientName) agg.patientName = r.patientName;
    }
  }

  // Second pass for post-handover activity: a patient's later visits matter only once we know
  // they are in the book, which the first pass has just established.
  for (const r of records) {
    const agg = byPatient.get(r.patientId);
    if (!agg) continue;
    if (r.date > agg.lastVisitAnywhere) agg.lastVisitAnywhere = r.date;
    if (r.date <= handoverDate) continue;

    const provider = resolveProvider(r.staff, r.date, providerGroups, overrides);
    agg.sinceDates.add(r.date);
    agg.valueSinceHandover += lineValue(r);
    agg.seenBy.add(provider);
    if (provider === incoming && (agg.firstVisitWithIncoming === null || r.date < agg.firstVisitWithIncoming)) {
      agg.firstVisitWithIncoming = r.date;
    }
  }

  const inherited = emptyBucket();
  const retained = emptyBucket();
  const movedToOther = emptyBucket();
  const notSeenSince = emptyBucket();
  let valueRecovered = 0;
  const patients: HandoverPatient[] = [];

  for (const [patientId, agg] of byPatient) {
    const outcome: HandoverOutcome = agg.firstVisitWithIncoming
      ? 'retained'
      : agg.sinceDates.size > 0
        ? 'movedToOther'
        : 'notSeenSince';

    const bucket = outcome === 'retained' ? retained : outcome === 'movedToOther' ? movedToOther : notSeenSince;
    bucket.patients += 1;
    bucket.valueWithOutgoing += agg.valueWithOutgoing;
    inherited.patients += 1;
    inherited.valueWithOutgoing += agg.valueWithOutgoing;
    if (outcome === 'retained') valueRecovered += agg.valueSinceHandover;

    patients.push({
      patientId,
      patientName: agg.patientName || patientId,
      outcome,
      lastVisitWithOutgoing: agg.lastVisitWithOutgoing,
      visitsWithOutgoing: agg.withOutgoingDates.size,
      valueWithOutgoing: agg.valueWithOutgoing,
      firstVisitWithIncoming: agg.firstVisitWithIncoming,
      visitsSinceHandover: agg.sinceDates.size,
      valueSinceHandover: agg.valueSinceHandover,
      seenBy: [...agg.seenBy].sort(),
      daysSinceLastVisit: Math.max(0, daysBetween(agg.lastVisitAnywhere, asOfISO)),
    });
  }

  // Biggest slice of the book first, so the most consequential departures lead.
  const order: Record<HandoverOutcome, number> = { notSeenSince: 0, movedToOther: 1, retained: 2 };
  patients.sort((a, b) => order[a.outcome] - order[b.outcome] || b.valueWithOutgoing - a.valueWithOutgoing);

  return {
    outgoing,
    incoming,
    handoverDate,
    bookFrom,
    inherited,
    retained,
    movedToOther,
    notSeenSince,
    retentionRate: inherited.patients > 0 ? (retained.patients / inherited.patients) * 100 : null,
    valueRecovered,
    patients,
  };
}

function isoDaysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Distinct canonical provider names present in the data, for populating the pickers. */
export function listProviders(
  records: SaleRecord[],
  providerGroups: ProviderGroup[] = [],
  overrides: ProviderAssignmentOverride[] = [],
): string[] {
  const names = new Set<string>();
  for (const r of records) names.add(resolveProvider(r.staff, r.date, providerGroups, overrides));
  return [...names].sort((a, b) => a.localeCompare(b));
}
