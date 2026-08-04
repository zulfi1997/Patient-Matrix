import type { SaleRecord } from '../types';
import { resolveProvider, type ProviderAssignmentOverride, type ProviderGroup } from './conversionMetrics';
import { daysBetween } from './metrics';

/** One holder of a role, from `fromDate` until the next holder starts (or indefinitely). */
export interface RoleHolder {
  provider: string;
  /** ISO yyyy-mm-dd, inclusive - the day this holder took over. */
  fromDate: string;
}

/**
 * What became of one inherited patient. Deliberately four outcomes, not two: "lost" conflates
 * three different problems with three different remedies.
 *
 *  - stillWithRole: seen by whoever holds the role now.
 *  - lostMidChain:  stayed with the role through a handover, then dropped off before the current
 *                   holder. The role had them and lost them - which pinpoints where.
 *  - wentElsewhere: still a patient of the clinic, just not of this role. Redistributed, not lost.
 *  - notSeenSince:  no visit anywhere. The only one that is a lost customer.
 */
export type RoleOutcome = 'stillWithRole' | 'lostMidChain' | 'wentElsewhere' | 'notSeenSince';

export interface RolePatient {
  patientId: string;
  patientName: string;
  outcome: RoleOutcome;
  lastVisitWithOriginal: string;
  visitsWithOriginal: number;
  /**
   * Sales (Exc. Tax) with the original holder: cash plus the value of package sessions consumed.
   * Deliberately a wider basis than the Dashboard's Revenue KPI, which nets off redemption - a
   * patient working through a prepaid package takes almost no new cash at the moment they are
   * seen, so on a Revenue basis the most committed patients would look worthless to retain.
   */
  valueWithOriginal: number;
  /** The portion of valueWithOriginal that was package sessions consumed rather than new cash. */
  redeemedWithOriginal: number;
  /** Role holders who saw them after the original, in tenure order. */
  seenWithHolders: string[];
  /** Providers seen since the handover who were not holding the role at that time. */
  otherProvidersSeen: string[];
  visitsSinceHandover: number;
  valueSinceHandover: number;
  daysSinceLastVisit: number;
}

export interface HandoverBucket {
  patients: number;
  /** Combined value those patients had with the original holder - their share of the book. */
  valueWithOriginal: number;
  /** How much of that was package sessions consumed rather than new cash. */
  redeemedWithOriginal: number;
}

/** How much of the original book a given holder saw during their own tenure. */
export interface RoleStage {
  provider: string;
  fromDate: string;
  /** Null for the final holder, whose tenure is still open. */
  untilDate: string | null;
  patients: number;
  value: number;
}

export interface RoleHandoverSummary {
  holders: RoleHolder[];
  /** Start of the window defining the book; null when all-time. */
  bookFrom: string | null;
  /** The day the original holder handed over - the second holder's start date. */
  handoverDate: string;
  inherited: HandoverBucket;
  stillWithRole: HandoverBucket;
  lostMidChain: HandoverBucket;
  wentElsewhere: HandoverBucket;
  notSeenSince: HandoverBucket;
  /** stillWithRole / inherited, as a percentage. Null when nothing was inherited. */
  retentionRate: number | null;
  /** Value delivered since the handover by patients the role still has. */
  valueRecovered: number;
  /** One per holder, so attrition can be read off hop by hop. Stage 0 is the book itself. */
  stages: RoleStage[];
  patients: RolePatient[];
}

interface Agg {
  patientName: string;
  originalDates: Set<string>;
  valueWithOriginal: number;
  redeemedWithOriginal: number;
  lastVisitWithOriginal: string;
  sinceDates: Set<string>;
  valueSinceHandover: number;
  /** Indices of holders who saw this patient during their own tenure. */
  holdersSeen: Set<number>;
  otherProviders: Set<string>;
  lastVisitAnywhere: string;
}

const lineValue = (r: SaleRecord) => r.amount + r.redeemedAmount;
const emptyBucket = (): HandoverBucket => ({ patients: 0, valueWithOriginal: 0, redeemedWithOriginal: 0 });

/** Index of the holder whose tenure covers `date`, or -1 if it predates the first. */
function holderIndexAt(holders: RoleHolder[], date: string): number {
  let idx = -1;
  for (let i = 0; i < holders.length; i++) {
    if (date >= holders[i].fromDate) idx = i;
    else break;
  }
  return idx;
}

/**
 * Follows a role through any number of successions and reports what became of the book the first
 * holder built.
 *
 * A single outgoing/incoming pair cannot describe a chain: patients who dutifully moved to an
 * interim holder look like they went to "another provider", while the same patients moving on
 * again to the current holder look retained - so the two buckets end up measuring different
 * things at once. Modelling the role as a timeline of holders removes the ambiguity, and the
 * per-stage counts show at which handover the book actually thinned.
 *
 * Staff names resolve through resolveProvider, so an assisting nurse counts under whichever
 * doctor she assisted on the day; without that her visits would look like yet another provider
 * and the book would be understated at every hop.
 *
 * The book is bounded by `lookbackDays` before the handover rather than all-time. A patient last
 * seen a year before the original holder left had already gone, and counting them charges
 * pre-existing churn to the handover.
 */
export function computeRoleHandover(
  records: SaleRecord[],
  params: {
    holders: RoleHolder[];
    asOfISO: string;
    lookbackDays?: number;
    providerGroups?: ProviderGroup[];
    overrides?: ProviderAssignmentOverride[];
  },
): RoleHandoverSummary | null {
  const { asOfISO, lookbackDays = 0, providerGroups = [], overrides = [] } = params;
  const holders = [...params.holders].sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  if (holders.length < 2) return null;

  const handoverDate = holders[1].fromDate;
  const bookFrom = lookbackDays > 0 ? isoDaysBefore(handoverDate, lookbackDays) : null;
  const original = holders[0];

  const byPatient = new Map<string, Agg>();

  // Pass 1: the book - patients the original holder saw during their own tenure.
  for (const r of records) {
    if (r.date >= handoverDate) continue;
    if (r.date < original.fromDate) continue;
    if (bookFrom && r.date < bookFrom) continue;
    if (resolveProvider(r.staff, r.date, providerGroups, overrides) !== original.provider) continue;

    let agg = byPatient.get(r.patientId);
    if (!agg) {
      agg = {
        patientName: r.patientName,
        originalDates: new Set(),
        valueWithOriginal: 0,
        redeemedWithOriginal: 0,
        lastVisitWithOriginal: r.date,
        sinceDates: new Set(),
        valueSinceHandover: 0,
        holdersSeen: new Set(),
        otherProviders: new Set(),
        lastVisitAnywhere: r.date,
      };
      byPatient.set(r.patientId, agg);
    }
    agg.originalDates.add(r.date);
    agg.valueWithOriginal += lineValue(r);
    agg.redeemedWithOriginal += r.redeemedAmount;
    if (r.date > agg.lastVisitWithOriginal) agg.lastVisitWithOriginal = r.date;
    if (r.patientName) agg.patientName = r.patientName;
  }

  // Pass 2: what those patients did afterwards, and whether it was with the role.
  for (const r of records) {
    const agg = byPatient.get(r.patientId);
    if (!agg) continue;
    if (r.date > agg.lastVisitAnywhere) agg.lastVisitAnywhere = r.date;
    if (r.date < handoverDate) continue;

    const provider = resolveProvider(r.staff, r.date, providerGroups, overrides);
    agg.sinceDates.add(r.date);
    agg.valueSinceHandover += lineValue(r);

    const idx = holderIndexAt(holders, r.date);
    if (idx >= 1 && holders[idx].provider === provider) agg.holdersSeen.add(idx);
    else agg.otherProviders.add(provider);
  }

  const inherited = emptyBucket();
  const stillWithRole = emptyBucket();
  const lostMidChain = emptyBucket();
  const wentElsewhere = emptyBucket();
  const notSeenSince = emptyBucket();
  let valueRecovered = 0;
  const patients: RolePatient[] = [];
  const stageCounts = holders.map(() => ({ patients: 0, value: 0 }));

  const finalIndex = holders.length - 1;

  for (const [patientId, agg] of byPatient) {
    const outcome: RoleOutcome = agg.holdersSeen.has(finalIndex)
      ? 'stillWithRole'
      : agg.holdersSeen.size > 0
        ? 'lostMidChain'
        : agg.sinceDates.size > 0
          ? 'wentElsewhere'
          : 'notSeenSince';

    const bucket =
      outcome === 'stillWithRole' ? stillWithRole
      : outcome === 'lostMidChain' ? lostMidChain
      : outcome === 'wentElsewhere' ? wentElsewhere
      : notSeenSince;

    bucket.patients += 1;
    bucket.valueWithOriginal += agg.valueWithOriginal;
    bucket.redeemedWithOriginal += agg.redeemedWithOriginal;
    inherited.patients += 1;
    inherited.valueWithOriginal += agg.valueWithOriginal;
    inherited.redeemedWithOriginal += agg.redeemedWithOriginal;
    if (outcome === 'stillWithRole') valueRecovered += agg.valueSinceHandover;

    // Stage 0 is the book; later stages count who each holder actually saw.
    stageCounts[0].patients += 1;
    stageCounts[0].value += agg.valueWithOriginal;
    for (const i of agg.holdersSeen) {
      stageCounts[i].patients += 1;
      stageCounts[i].value += agg.valueWithOriginal;
    }

    patients.push({
      patientId,
      patientName: agg.patientName || patientId,
      outcome,
      lastVisitWithOriginal: agg.lastVisitWithOriginal,
      visitsWithOriginal: agg.originalDates.size,
      valueWithOriginal: agg.valueWithOriginal,
      redeemedWithOriginal: agg.redeemedWithOriginal,
      seenWithHolders: [...agg.holdersSeen].sort((a, b) => a - b).map((i) => holders[i].provider),
      otherProvidersSeen: [...agg.otherProviders].sort(),
      visitsSinceHandover: agg.sinceDates.size,
      valueSinceHandover: agg.valueSinceHandover,
      daysSinceLastVisit: Math.max(0, daysBetween(agg.lastVisitAnywhere, asOfISO)),
    });
  }

  const order: Record<RoleOutcome, number> = { notSeenSince: 0, lostMidChain: 1, wentElsewhere: 2, stillWithRole: 3 };
  patients.sort((a, b) => order[a.outcome] - order[b.outcome] || b.valueWithOriginal - a.valueWithOriginal);

  return {
    holders,
    bookFrom,
    handoverDate,
    inherited,
    stillWithRole,
    lostMidChain,
    wentElsewhere,
    notSeenSince,
    retentionRate: inherited.patients > 0 ? (stillWithRole.patients / inherited.patients) * 100 : null,
    valueRecovered,
    stages: holders.map((h, i) => ({
      provider: h.provider,
      fromDate: h.fromDate,
      untilDate: i + 1 < holders.length ? holders[i + 1].fromDate : null,
      patients: stageCounts[i].patients,
      value: stageCounts[i].value,
    })),
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

/** How a patient of the current holder came to them. */
export type PatientOrigin = 'inherited' | 'newToClinic' | 'fromElsewhere';

/**
 * Whether the provider kept the patient. "Seen once" is split by what happened next, because the
 * remedy differs: a patient who tried this provider once and then saw a colleague is a fit or
 * scheduling problem inside the clinic, while one who tried once and vanished is a lost customer.
 */
export type ProviderPatientOutcome = 'repeat' | 'onceThenElsewhere' | 'onceThenQuiet';

export interface ProviderPatient {
  patientId: string;
  patientName: string;
  outcome: ProviderPatientOutcome;
  origin: PatientOrigin;
  firstVisitWithProvider: string;
  lastVisitWithProvider: string;
  visitsWithProvider: number;
  /** Sales (Exc. Tax) with this provider - cash plus package sessions consumed. */
  valueWithProvider: number;
  /** Providers seen after this provider last saw them. */
  seenAfterElsewhere: string[];
  daysSinceLastVisit: number;
}

export interface ProviderPatientSummary {
  provider: string;
  fromDate: string;
  total: HandoverBucketLite;
  repeat: HandoverBucketLite;
  onceThenElsewhere: HandoverBucketLite;
  onceThenQuiet: HandoverBucketLite;
  /** Share of patients who came back at least once. Null when the provider saw nobody. */
  repeatRate: number | null;
  byOrigin: Record<PatientOrigin, HandoverBucketLite>;
  patients: ProviderPatient[];
}

export interface HandoverBucketLite {
  patients: number;
  value: number;
}

const emptyLite = (): HandoverBucketLite => ({ patients: 0, value: 0 });

/**
 * Every patient a provider has seen since taking over - not only the ones they inherited - and
 * whether each came back.
 *
 * The handover view answers "how much of the book survived", which deliberately counts a patient
 * as kept the moment they appear once. That is the right test for whether the book transferred,
 * and the wrong one for whether the provider is holding onto people: a single visit followed by
 * silence looks identical to an established relationship. Splitting by repeat visit separates
 * them, and tagging each patient's origin shows whether a weak repeat rate is confined to the
 * inherited book or applies to everyone the provider sees, including patients arriving from other
 * departments and those new to the clinic.
 */
export function computeProviderPatients(
  records: SaleRecord[],
  params: {
    provider: string;
    /** Usually the date they took over; patients seen before it are out of scope. */
    fromDate: string;
    asOfISO: string;
    /** Patient ids from the inherited book, so origin can be attributed. */
    inheritedIds?: Set<string>;
    providerGroups?: ProviderGroup[];
    overrides?: ProviderAssignmentOverride[];
  },
): ProviderPatientSummary {
  const { provider, fromDate, asOfISO, inheritedIds, providerGroups = [], overrides = [] } = params;

  const firstVisitAnywhere = new Map<string, string>();
  const lastVisitAnywhere = new Map<string, string>();
  for (const r of records) {
    const f = firstVisitAnywhere.get(r.patientId);
    if (f === undefined || r.date < f) firstVisitAnywhere.set(r.patientId, r.date);
    const l = lastVisitAnywhere.get(r.patientId);
    if (l === undefined || r.date > l) lastVisitAnywhere.set(r.patientId, r.date);
  }

  interface Acc {
    patientName: string;
    dates: Set<string>;
    value: number;
    first: string;
    last: string;
  }
  const byPatient = new Map<string, Acc>();

  for (const r of records) {
    if (r.date < fromDate) continue;
    if (resolveProvider(r.staff, r.date, providerGroups, overrides) !== provider) continue;
    let acc = byPatient.get(r.patientId);
    if (!acc) {
      acc = { patientName: r.patientName, dates: new Set(), value: 0, first: r.date, last: r.date };
      byPatient.set(r.patientId, acc);
    }
    acc.dates.add(r.date);
    acc.value += lineValue(r);
    if (r.date < acc.first) acc.first = r.date;
    if (r.date > acc.last) acc.last = r.date;
    if (r.patientName) acc.patientName = r.patientName;
  }

  // Who they saw afterwards, which needs each patient's last visit with this provider first.
  const afterElsewhere = new Map<string, Set<string>>();
  for (const r of records) {
    const acc = byPatient.get(r.patientId);
    if (!acc || r.date <= acc.last) continue;
    const other = resolveProvider(r.staff, r.date, providerGroups, overrides);
    if (other === provider) continue;
    if (!afterElsewhere.has(r.patientId)) afterElsewhere.set(r.patientId, new Set());
    afterElsewhere.get(r.patientId)!.add(other);
  }

  const total = emptyLite();
  const repeat = emptyLite();
  const onceThenElsewhere = emptyLite();
  const onceThenQuiet = emptyLite();
  const byOrigin: Record<PatientOrigin, HandoverBucketLite> = {
    inherited: emptyLite(), newToClinic: emptyLite(), fromElsewhere: emptyLite(),
  };
  const patients: ProviderPatient[] = [];

  for (const [patientId, acc] of byPatient) {
    const others = [...(afterElsewhere.get(patientId) ?? [])].sort();
    const outcome: ProviderPatientOutcome =
      acc.dates.size > 1 ? 'repeat' : others.length > 0 ? 'onceThenElsewhere' : 'onceThenQuiet';

    const origin: PatientOrigin = inheritedIds?.has(patientId)
      ? 'inherited'
      : firstVisitAnywhere.get(patientId) === acc.first
        ? 'newToClinic'
        : 'fromElsewhere';

    const bucket = outcome === 'repeat' ? repeat : outcome === 'onceThenElsewhere' ? onceThenElsewhere : onceThenQuiet;
    for (const b of [total, bucket, byOrigin[origin]]) {
      b.patients += 1;
      b.value += acc.value;
    }

    patients.push({
      patientId,
      patientName: acc.patientName || patientId,
      outcome,
      origin,
      firstVisitWithProvider: acc.first,
      lastVisitWithProvider: acc.last,
      visitsWithProvider: acc.dates.size,
      valueWithProvider: acc.value,
      seenAfterElsewhere: others,
      daysSinceLastVisit: Math.max(0, daysBetween(lastVisitAnywhere.get(patientId) ?? acc.last, asOfISO)),
    });
  }

  const order: Record<ProviderPatientOutcome, number> = { onceThenQuiet: 0, onceThenElsewhere: 1, repeat: 2 };
  patients.sort((a, b) => order[a.outcome] - order[b.outcome] || b.valueWithProvider - a.valueWithProvider);

  return {
    provider,
    fromDate,
    total,
    repeat,
    onceThenElsewhere,
    onceThenQuiet,
    repeatRate: total.patients > 0 ? (repeat.patients / total.patients) * 100 : null,
    byOrigin,
    patients,
  };
}
