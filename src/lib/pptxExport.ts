import type PptxGenJS from 'pptxgenjs';
import type { DiscountBreakdownStat, DiscountSummary } from './discounts';
import type { AgingBucketStat, InvoiceAgingRow, KpiResult, MonthlyTrendPoint, RedeemedPackageStat, ReturnedPatient, ServiceStat } from './metrics';
import { formatCurrency, formatMonthLabel, formatNumber, formatPercent } from './format';
import { orderedSections, type DeckConfig, type DeckSectionId } from './deckSections';

// Same hex values already used on-screen (PatientTrendChart/RevenueTrendChart/KpiCard tones),
// stripped of "#" - pptxgenjs wants bare hex - so the exported deck's colors match the dashboard.
const COLOR = {
  indigo: '6366F1',
  indigoLight: 'A5B4FC',
  emerald: '10B981',
  rose: 'E11D48',
  amber: 'D97706',
  ink: '27272A',
  muted: '71717A',
  faint: 'E4E4E7',
  panel: 'F8F8F7',
  white: 'FFFFFF',
};

/** 16:9 slide is 10 x 5.63in. Content starts below the heading and stops above the note band. */
const CONTENT_TOP = 1.1;
const CONTENT_BOTTOM = 5.25;
const NOTE_HEIGHT = 0.95;

interface KpiTile {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'bad';
}

export interface DashboardPptxParams {
  periodLabel: string;
  rangeStart: string;
  rangeEnd: string;
  asOfISO: string;
  inactivityDays: number;
  serviceType: string;
  kpis: KpiResult;
  discountSummary: DiscountSummary;
  discountBreakdown: DiscountBreakdownStat[];
  trend: MonthlyTrendPoint[];
  topServices: ServiceStat[];
  redeemedPackages: RedeemedPackageStat[];
  invoiceAging: InvoiceAgingRow[];
  agingBucketSummary: AgingBucketStat[];
  atRiskCount: number;
  returnedPatients: ReturnedPatient[];
}

function toneColor(tone: KpiTile['tone']): string {
  if (tone === 'good') return COLOR.emerald;
  if (tone === 'bad') return COLOR.rose;
  return COLOR.ink;
}

/** Heading plus subheading, returning the y the body may start at. */
function addHeading(slide: PptxGenJS.Slide, title: string, subtitle: string): void {
  slide.addText(title, { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: COLOR.ink, fontFace: 'Arial' });
  slide.addText(subtitle, { x: 0.4, y: 0.68, w: 9.2, h: 0.3, fontSize: 12, color: COLOR.muted, fontFace: 'Arial' });
}

/**
 * Prints the author's commentary in a band at the foot of the slide. Body content is given the
 * space above it, so a slide with a note is laid out shorter rather than overlapping.
 */
function addNote(slide: PptxGenJS.Slide, note: string | undefined): number {
  if (!note?.trim()) return CONTENT_BOTTOM;
  const y = CONTENT_BOTTOM - NOTE_HEIGHT;
  slide.addShape('roundRect', {
    x: 0.4, y, w: 9.2, h: NOTE_HEIGHT, rectRadius: 0.06,
    fill: { color: COLOR.panel }, line: { color: COLOR.faint, width: 1 },
  });
  slide.addText(note.trim(), {
    x: 0.55, y: y + 0.08, w: 8.9, h: NOTE_HEIGHT - 0.16,
    fontSize: 11, color: COLOR.ink, fontFace: 'Arial', valign: 'top', shrinkText: true,
  });
  return y - 0.15;
}

function addEmpty(slide: PptxGenJS.Slide, message: string): void {
  slide.addText(message, { x: 0.4, y: 2.4, w: 9.2, h: 0.5, fontSize: 14, color: COLOR.muted, fontFace: 'Arial', align: 'center' });
}

function headerRow(labels: string[], fontSize = 11) {
  return labels.map((text) => ({
    text,
    options: { bold: true, color: COLOR.white, fill: { color: COLOR.indigo }, fontSize },
  }));
}

function addTitleSlide(pptx: PptxGenJS, config: DeckConfig, params: DashboardPptxParams) {
  const slide = pptx.addSlide();
  slide.background = { color: COLOR.indigo };
  slide.addText(config.title || 'Patient Matrix', {
    x: 0.5, y: 1.7, w: 9, h: 0.8, fontSize: 36, bold: true, color: COLOR.white, fontFace: 'Arial', shrinkText: true,
  });
  if (config.subtitle) {
    slide.addText(config.subtitle, { x: 0.5, y: 2.45, w: 9, h: 0.5, fontSize: 20, color: COLOR.indigoLight, fontFace: 'Arial', shrinkText: true });
  }
  slide.addText(
    `${params.periodLabel} (${params.rangeStart} to ${params.rangeEnd})  ·  Data as of ${params.asOfISO}`,
    { x: 0.5, y: 3.05, w: 9, h: 0.4, fontSize: 13, color: COLOR.white, fontFace: 'Arial' },
  );
  slide.addText(`Generated ${new Date().toLocaleDateString('en-GB')}`, {
    x: 0.5, y: 5.05, w: 9, h: 0.3, fontSize: 10, color: COLOR.indigoLight, fontFace: 'Arial',
  });
}

function addKpiSlide(pptx: PptxGenJS, params: DashboardPptxParams, note?: string) {
  const { kpis, discountSummary, inactivityDays } = params;
  const tiles: KpiTile[] = [
    { label: 'Revenue', value: formatCurrency(kpis.periodRevenue), hint: `${formatNumber(kpis.periodTransactions)} line items` },
    { label: 'Redeemed Revenue', value: formatCurrency(kpis.periodRedeemedRevenue), hint: 'value delivered via package redemption' },
    { label: 'Active Patients', value: formatNumber(kpis.activePatients) },
    { label: 'New Patients', value: formatNumber(kpis.newPatients), tone: 'good' },
    { label: 'Returning Patients', value: formatNumber(kpis.returningPatients) },
    {
      label: 'Retention Rate',
      value: formatPercent(kpis.retentionRate),
      tone: kpis.retentionRate != null && kpis.retentionRate < 50 ? 'bad' : 'good',
    },
    {
      label: 'Turnover Rate',
      value: formatPercent(kpis.turnoverRate),
      tone: kpis.turnoverRate != null && kpis.turnoverRate > 50 ? 'bad' : undefined,
    },
    { label: 'Stopped Visiting', value: formatNumber(kpis.stoppedVisiting), hint: `${inactivityDays}+ days inactive`, tone: 'bad' },
    { label: 'Total Discount', value: formatCurrency(discountSummary.totalDiscount), tone: 'bad' },
  ];

  const slide = pptx.addSlide();
  addHeading(slide, 'Headline Numbers', params.periodLabel);
  const bodyBottom = addNote(slide, note);

  const cols = 3;
  const gap = 0.15;
  const startX = 0.4;
  const colW = (10 - startX * 2 - gap * (cols - 1)) / cols;
  const rows = Math.ceil(tiles.length / cols);
  const rowH = Math.min(1.35, (bodyBottom - CONTENT_TOP - gap * (rows - 1)) / rows);

  tiles.forEach((tile, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (colW + gap);
    const y = CONTENT_TOP + row * (rowH + gap);
    slide.addShape('roundRect', { x, y, w: colW, h: rowH, rectRadius: 0.06, fill: { color: COLOR.panel }, line: { color: COLOR.faint, width: 1 } });
    slide.addText(tile.label.toUpperCase(), { x: x + 0.15, y: y + 0.1, w: colW - 0.3, h: 0.28, fontSize: 10, color: COLOR.muted, fontFace: 'Arial' });
    slide.addText(tile.value, {
      x: x + 0.15, y: y + 0.34, w: colW - 0.3, h: 0.5, fontSize: 22, bold: true, color: toneColor(tile.tone), fontFace: 'Arial', shrinkText: true,
    });
    if (tile.hint && rowH > 1.0) {
      slide.addText(tile.hint, { x: x + 0.15, y: y + 0.85, w: colW - 0.3, h: 0.35, fontSize: 9, color: COLOR.muted, fontFace: 'Arial', shrinkText: true });
    }
  });
}

function addPatientTrendSlide(pptx: PptxGenJS, trend: MonthlyTrendPoint[], note?: string) {
  const slide = pptx.addSlide();
  addHeading(slide, 'New vs Returning Patients', 'Trailing 12 months');
  const bodyBottom = addNote(slide, note);
  if (trend.length === 0) return addEmpty(slide, 'No data available.');

  const labels = trend.map((d) => formatMonthLabel(d.month));
  slide.addChart(
    pptx.ChartType.bar,
    [
      { name: 'New', labels, values: trend.map((d) => d.newPatients) },
      { name: 'Returning', labels, values: trend.map((d) => d.returningPatients) },
    ],
    {
      x: 0.4, y: CONTENT_TOP, w: 9.2, h: bodyBottom - CONTENT_TOP,
      barGrouping: 'stacked',
      chartColors: [COLOR.indigo, COLOR.indigoLight],
      showLegend: true, legendPos: 'b', legendFontSize: 10,
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
    },
  );
}

function addRevenueTrendSlide(pptx: PptxGenJS, trend: MonthlyTrendPoint[], note?: string) {
  const slide = pptx.addSlide();
  addHeading(slide, 'Revenue Trend', 'Trailing 12 months (OMR)');
  const bodyBottom = addNote(slide, note);
  if (trend.length === 0) return addEmpty(slide, 'No data available.');

  const labels = trend.map((d) => formatMonthLabel(d.month));
  slide.addChart(
    pptx.ChartType.area,
    [{ name: 'Revenue', labels, values: trend.map((d) => Math.round(d.revenue)) }],
    {
      x: 0.4, y: CONTENT_TOP, w: 9.2, h: bodyBottom - CONTENT_TOP,
      chartColors: [COLOR.emerald], showLegend: false,
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
    },
  );
}

function addTopServicesSlide(pptx: PptxGenJS, topServices: ServiceStat[], note?: string) {
  const slide = pptx.addSlide();
  addHeading(slide, 'Top Selling Services', 'By value delivered, selected period');
  const bodyBottom = addNote(slide, note);

  const rowLimit = bodyBottom < CONTENT_BOTTOM ? 6 : 8;
  const top = [...topServices].sort((a, b) => b.deliveredValue - a.deliveredValue).slice(0, rowLimit);
  if (top.length === 0) return addEmpty(slide, 'No sales in this period.');

  slide.addTable(
    [
      headerRow(['Service', 'Times Sold', 'New Cash', 'Via Packages', 'Delivered']),
      ...top.map((s) => [
        { text: s.serviceName, options: { fontSize: 10 } },
        { text: formatNumber(s.count), options: { fontSize: 10, align: 'right' as const } },
        { text: formatCurrency(s.revenue), options: { fontSize: 10, align: 'right' as const } },
        { text: formatCurrency(s.redeemedRevenue), options: { fontSize: 10, align: 'right' as const, color: COLOR.muted } },
        { text: formatCurrency(s.deliveredValue), options: { fontSize: 10, align: 'right' as const, bold: true } },
      ]),
    ],
    { x: 0.4, y: CONTENT_TOP, w: 9.2, colW: [3.4, 1.2, 1.5, 1.6, 1.5], border: { type: 'solid', color: COLOR.faint, pt: 0.5 }, autoPage: false },
  );
}

function addRetentionSlide(pptx: PptxGenJS, params: DashboardPptxParams, note?: string) {
  const { atRiskCount, returnedPatients, inactivityDays } = params;
  const stillActive = returnedPatients.filter((p) => p.currentlyActive).length;

  const slide = pptx.addSlide();
  addHeading(slide, 'Patient Retention Health', `Inactivity threshold: ${inactivityDays} days`);
  const bodyBottom = addNote(slide, note);

  const cards = [
    { label: 'Stopped Visiting', value: formatNumber(atRiskCount), hint: `Inactive ${inactivityDays}+ days as of today`, color: COLOR.rose },
    { label: 'Returned After Going Quiet', value: formatNumber(returnedPatients.length), hint: 'Had a qualifying gap, then came back', color: COLOR.amber },
    { label: 'Still Active Since Returning', value: formatNumber(stillActive), hint: 'Of those who returned', color: COLOR.emerald },
  ];

  const gap = 0.25;
  const colW = (10 - 0.8 - gap * 2) / 3;
  cards.forEach((c, i) => {
    const x = 0.4 + i * (colW + gap);
    slide.addShape('roundRect', { x, y: CONTENT_TOP, w: colW, h: 2, rectRadius: 0.08, fill: { color: COLOR.panel }, line: { color: COLOR.faint, width: 1 } });
    slide.addText(c.label, { x: x + 0.2, y: CONTENT_TOP + 0.2, w: colW - 0.4, h: 0.5, fontSize: 12, color: COLOR.muted, fontFace: 'Arial', shrinkText: true });
    slide.addText(c.value, { x: x + 0.2, y: CONTENT_TOP + 0.65, w: colW - 0.4, h: 0.7, fontSize: 30, bold: true, color: c.color, fontFace: 'Arial' });
    slide.addText(c.hint, { x: x + 0.2, y: CONTENT_TOP + 1.4, w: colW - 0.4, h: 0.5, fontSize: 9, color: COLOR.muted, fontFace: 'Arial', shrinkText: true });
  });

  const tableTop = CONTENT_TOP + 2.3;
  if (returnedPatients.length > 0 && bodyBottom - tableTop > 0.9) {
    slide.addText('Most recent returns', { x: 0.4, y: tableTop, w: 9.2, h: 0.3, fontSize: 12, bold: true, color: COLOR.ink, fontFace: 'Arial' });
    slide.addTable(
      [
        headerRow(['Patient', 'Went Quiet On', 'Returned On', 'Status'], 10),
        ...returnedPatients.slice(0, 4).map((p) => [
          { text: p.patientName, options: { fontSize: 9 } },
          { text: p.wentQuietOn, options: { fontSize: 9, color: COLOR.muted } },
          { text: p.returnedOn, options: { fontSize: 9 } },
          { text: p.currentlyActive ? 'Still active' : 'Went quiet again', options: { fontSize: 9, color: p.currentlyActive ? COLOR.emerald : COLOR.rose } },
        ]),
      ],
      { x: 0.4, y: tableTop + 0.35, w: 9.2, colW: [3.4, 2, 2, 1.8], border: { type: 'solid', color: COLOR.faint, pt: 0.5 }, autoPage: false },
    );
  }
}

function addRedeemedPackagesSlide(pptx: PptxGenJS, packages: RedeemedPackageStat[], note?: string) {
  const slide = pptx.addSlide();
  addHeading(slide, 'Redeemed Packages', 'Value delivered by consuming previously-sold packages');
  const bodyBottom = addNote(slide, note);

  const rowLimit = bodyBottom < CONTENT_BOTTOM ? 6 : 9;
  const top = [...packages].sort((a, b) => b.redeemedAmount - a.redeemedAmount).slice(0, rowLimit);
  if (top.length === 0) return addEmpty(slide, 'No package sessions were consumed in this period.');

  const total = packages.reduce((s, p) => s + p.redeemedAmount, 0);
  slide.addTable(
    [
      headerRow(['Package', 'Sessions Consumed', 'Value Delivered']),
      ...top.map((p) => [
        { text: p.packageName, options: { fontSize: 10 } },
        { text: formatNumber(p.count), options: { fontSize: 10, align: 'right' as const } },
        { text: formatCurrency(p.redeemedAmount), options: { fontSize: 10, align: 'right' as const, bold: true } },
      ]),
      [
        { text: 'Total (all packages)', options: { fontSize: 10, bold: true, fill: { color: COLOR.panel } } },
        { text: '', options: { fill: { color: COLOR.panel } } },
        { text: formatCurrency(total), options: { fontSize: 10, align: 'right' as const, bold: true, fill: { color: COLOR.panel } } },
      ],
    ],
    { x: 0.4, y: CONTENT_TOP, w: 9.2, colW: [5.4, 1.9, 1.9], border: { type: 'solid', color: COLOR.faint, pt: 0.5 }, autoPage: false },
  );
}

function addDiscountsSlide(pptx: PptxGenJS, summary: DiscountSummary, breakdown: DiscountBreakdownStat[], note?: string) {
  const slide = pptx.addSlide();
  addHeading(slide, 'Discounts', 'Every discount except package redemption');
  const bodyBottom = addNote(slide, note);

  const cards = [
    { label: 'Total Discount', value: formatCurrency(summary.totalDiscount), color: COLOR.rose },
    { label: 'Share of Gross Sales', value: formatPercent(summary.discountPct), color: COLOR.ink },
    { label: 'Discounted Lines', value: formatNumber(summary.discountedLineCount), color: COLOR.ink },
  ];
  const gap = 0.25;
  const colW = (10 - 0.8 - gap * 2) / 3;
  cards.forEach((c, i) => {
    const x = 0.4 + i * (colW + gap);
    slide.addShape('roundRect', { x, y: CONTENT_TOP, w: colW, h: 1.2, rectRadius: 0.08, fill: { color: COLOR.panel }, line: { color: COLOR.faint, width: 1 } });
    slide.addText(c.label.toUpperCase(), { x: x + 0.2, y: CONTENT_TOP + 0.15, w: colW - 0.4, h: 0.3, fontSize: 10, color: COLOR.muted, fontFace: 'Arial' });
    slide.addText(c.value, { x: x + 0.2, y: CONTENT_TOP + 0.5, w: colW - 0.4, h: 0.6, fontSize: 24, bold: true, color: c.color, fontFace: 'Arial', shrinkText: true });
  });

  const tableTop = CONTENT_TOP + 1.5;
  const rowLimit = bodyBottom - tableTop > 2 ? 6 : 4;
  const top = [...breakdown].sort((a, b) => b.amount - a.amount).slice(0, rowLimit);
  if (top.length > 0) {
    slide.addTable(
      [
        headerRow(['Discount', 'Lines', 'Amount'], 10),
        ...top.map((b) => [
          { text: b.label, options: { fontSize: 10 } },
          { text: formatNumber(b.count), options: { fontSize: 10, align: 'right' as const } },
          { text: formatCurrency(b.amount), options: { fontSize: 10, align: 'right' as const, bold: true } },
        ]),
      ],
      { x: 0.4, y: tableTop, w: 9.2, colW: [5.4, 1.9, 1.9], border: { type: 'solid', color: COLOR.faint, pt: 0.5 }, autoPage: false },
    );
  }
}

function addInvoiceAgingSlide(pptx: PptxGenJS, buckets: AgingBucketStat[], rows: InvoiceAgingRow[], note?: string) {
  const slide = pptx.addSlide();
  addHeading(slide, 'Invoice Due & Ageing', 'Outstanding balances across all sales data');
  const bodyBottom = addNote(slide, note);

  if (rows.length === 0) return addEmpty(slide, 'No outstanding invoices.');

  const totalDue = rows.reduce((s, r) => s + r.dueAmount, 0);
  const gap = 0.15;
  const colW = (10 - 0.8 - gap * 3) / 4;
  buckets.forEach((b, i) => {
    const x = 0.4 + i * (colW + gap);
    const tone = b.bucket === '60+' ? COLOR.rose : b.bucket === '31-60' ? COLOR.amber : COLOR.ink;
    slide.addShape('roundRect', { x, y: CONTENT_TOP, w: colW, h: 1.15, rectRadius: 0.06, fill: { color: COLOR.panel }, line: { color: COLOR.faint, width: 1 } });
    slide.addText(`${b.bucket} DAYS`, { x: x + 0.12, y: CONTENT_TOP + 0.12, w: colW - 0.24, h: 0.28, fontSize: 10, color: COLOR.muted, fontFace: 'Arial' });
    slide.addText(formatCurrency(b.amount), { x: x + 0.12, y: CONTENT_TOP + 0.42, w: colW - 0.24, h: 0.45, fontSize: 16, bold: true, color: tone, fontFace: 'Arial', shrinkText: true });
    slide.addText(`${formatNumber(b.count)} invoices`, { x: x + 0.12, y: CONTENT_TOP + 0.85, w: colW - 0.24, h: 0.25, fontSize: 9, color: COLOR.muted, fontFace: 'Arial' });
  });

  slide.addText(`Total outstanding: ${formatCurrency(totalDue)} across ${formatNumber(rows.length)} invoices`, {
    x: 0.4, y: CONTENT_TOP + 1.3, w: 9.2, h: 0.3, fontSize: 12, bold: true, color: COLOR.ink, fontFace: 'Arial',
  });

  const tableTop = CONTENT_TOP + 1.7;
  const rowLimit = bodyBottom - tableTop > 2 ? 6 : 4;
  const oldest = [...rows].sort((a, b) => b.ageDays - a.ageDays).slice(0, rowLimit);
  slide.addTable(
    [
      headerRow(['Invoice', 'Patient', 'Age', 'Due'], 10),
      ...oldest.map((r) => [
        { text: r.invoiceNo, options: { fontSize: 9 } },
        { text: r.patientName, options: { fontSize: 9 } },
        { text: `${formatNumber(r.ageDays)}d`, options: { fontSize: 9, align: 'right' as const, color: COLOR.rose } },
        { text: formatCurrency(r.dueAmount), options: { fontSize: 9, align: 'right' as const, bold: true } },
      ]),
    ],
    { x: 0.4, y: tableTop, w: 9.2, colW: [1.8, 4.2, 1.4, 1.8], border: { type: 'solid', color: COLOR.faint, pt: 0.5 }, autoPage: false },
  );
}

const RENDERERS: Record<DeckSectionId, (pptx: PptxGenJS, p: DashboardPptxParams, note?: string) => void> = {
  kpis: (pptx, p, note) => addKpiSlide(pptx, p, note),
  patientTrend: (pptx, p, note) => addPatientTrendSlide(pptx, p.trend, note),
  revenueTrend: (pptx, p, note) => addRevenueTrendSlide(pptx, p.trend, note),
  topServices: (pptx, p, note) => addTopServicesSlide(pptx, p.topServices, note),
  retention: (pptx, p, note) => addRetentionSlide(pptx, p, note),
  redeemedPackages: (pptx, p, note) => addRedeemedPackagesSlide(pptx, p.redeemedPackages, note),
  discounts: (pptx, p, note) => addDiscountsSlide(pptx, p.discountSummary, p.discountBreakdown, note),
  invoiceAging: (pptx, p, note) => addInvoiceAgingSlide(pptx, p.agingBucketSummary, p.invoiceAging, note),
};

/**
 * Builds and downloads a PowerPoint of the chosen dashboard sections, each optionally carrying the
 * author's own commentary, using the same computed figures shown on screen.
 *
 * Slides are laid out around the note rather than assuming its absence: a section with commentary
 * gets a shorter chart or fewer table rows, so the text never overlaps the figures it explains.
 */
export async function exportDashboardPptx(params: DashboardPptxParams, config: DeckConfig): Promise<void> {
  // Loaded lazily so pptxgenjs (a sizeable library) only ships to the browser when someone
  // actually builds a deck, not on initial page load - same reasoning as excelParser.ts's
  // lazy `xlsx` import.
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.author = 'Patient Matrix';
  pptx.company = 'Bio Thrive International';
  pptx.title = config.title || 'Patient Matrix - Dashboard Report';
  pptx.layout = 'LAYOUT_16x9';

  addTitleSlide(pptx, config, params);
  for (const id of orderedSections(config.sections)) {
    RENDERERS[id](pptx, params, config.notes[id]);
  }

  const safeTitle = (config.title || 'patient-matrix-dashboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await pptx.writeFile({ fileName: `${safeTitle || 'presentation'}-${params.rangeEnd}.pptx` });
}
