export type DeckSectionId =
  | 'kpis'
  | 'patientTrend'
  | 'revenueTrend'
  | 'topServices'
  | 'retention'
  | 'redeemedPackages'
  | 'discounts'
  | 'invoiceAging';

export interface DeckSectionMeta {
  id: DeckSectionId;
  label: string;
  /** What the slide shows, so a section can be chosen without generating the deck to find out. */
  description: string;
}

/**
 * The slides available to a deck, in the order they appear when selected. Order is fixed rather
 * than arrangeable: it runs from summary to detail, which is the order these read in, and a
 * rearrangeable list is a lot of interface for a choice rarely worth making.
 */
export const DECK_SECTIONS: DeckSectionMeta[] = [
  { id: 'kpis', label: 'Headline numbers', description: 'Revenue, redeemed revenue, patient counts, retention and discount, as on the dashboard.' },
  { id: 'patientTrend', label: 'New vs returning patients', description: 'Stacked monthly chart over the trailing 12 months.' },
  { id: 'revenueTrend', label: 'Revenue trend', description: 'Monthly revenue over the trailing 12 months.' },
  { id: 'topServices', label: 'Top selling services', description: 'Ranked by value delivered, splitting new cash from package sessions consumed.' },
  { id: 'retention', label: 'Patient retention health', description: 'Stopped visiting, returned after going quiet, and how many of those are still active.' },
  { id: 'redeemedPackages', label: 'Redeemed packages', description: 'Which packages are being consumed, and how much value that represents.' },
  { id: 'discounts', label: 'Discounts', description: 'Total given away, share of gross sales, and the breakdown by type and campaign.' },
  { id: 'invoiceAging', label: 'Invoice due & ageing', description: 'Outstanding balances by age bucket, and the oldest unpaid invoices.' },
];

export const DEFAULT_DECK_SECTIONS: DeckSectionId[] = ['kpis', 'patientTrend', 'revenueTrend', 'topServices', 'retention'];

export interface DeckConfig {
  title: string;
  subtitle: string;
  /** Selected sections; rendered in DECK_SECTIONS order regardless of selection order. */
  sections: DeckSectionId[];
  /** Commentary per section, printed on the slide beneath the figures. */
  notes: Partial<Record<DeckSectionId, string>>;
}

export function orderedSections(selected: DeckSectionId[]): DeckSectionId[] {
  const chosen = new Set(selected);
  return DECK_SECTIONS.filter((s) => chosen.has(s.id)).map((s) => s.id);
}
