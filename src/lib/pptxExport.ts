import type PptxGenJS from 'pptxgenjs';
import type { DiscountSummary } from './discounts';
import type { KpiResult, MonthlyTrendPoint, ReturnedPatient, ServiceStat } from './metrics';
import { formatCurrency, formatMonthLabel, formatNumber, formatPercent } from './format';

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
  white: 'FFFFFF',
};

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
  trend: MonthlyTrendPoint[];
  topServices: ServiceStat[];
  atRiskCount: number;
  returnedPatients: ReturnedPatient[];
}

function toneColor(tone: KpiTile['tone']): string {
  if (tone === 'good') return COLOR.emerald;
  if (tone === 'bad') return COLOR.rose;
  return COLOR.ink;
}

function addTitleSlide(pptx: PptxGenJS, params: DashboardPptxParams) {
  const slide = pptx.addSlide();
  slide.background = { color: COLOR.indigo };
  slide.addText('Patient Matrix', {
    x: 0.5, y: 1.7, w: 9, h: 0.8, fontSize: 36, bold: true, color: COLOR.white, fontFace: 'Arial',
  });
  slide.addText('Dashboard Report', {
    x: 0.5, y: 2.45, w: 9, h: 0.5, fontSize: 20, color: COLOR.indigoLight, fontFace: 'Arial',
  });
  slide.addText(
    `${params.periodLabel} (${params.rangeStart} to ${params.rangeEnd})  ·  Data as of ${params.asOfISO}`,
    { x: 0.5, y: 3.05, w: 9, h: 0.4, fontSize: 13, color: COLOR.white, fontFace: 'Arial' },
  );
  slide.addText(`Generated ${new Date().toLocaleDateString('en-GB')}`, {
    x: 0.5, y: 5.05, w: 9, h: 0.3, fontSize: 10, color: COLOR.indigoLight, fontFace: 'Arial',
  });
}

function addKpiSlide(pptx: PptxGenJS, params: DashboardPptxParams) {
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
  slide.addText('Headline Numbers', { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: COLOR.ink, fontFace: 'Arial' });
  slide.addText(params.periodLabel, { x: 0.4, y: 0.68, w: 9.2, h: 0.3, fontSize: 12, color: COLOR.muted, fontFace: 'Arial' });

  const cols = 3;
  const gap = 0.15;
  const startX = 0.4;
  const startY = 0.95;
  const colW = (10 - startX * 2 - gap * (cols - 1)) / cols;
  const rowH = 1.35;

  tiles.forEach((tile, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (colW + gap);
    const y = startY + row * (rowH + gap);
    slide.addShape('roundRect', { x, y, w: colW, h: rowH, rectRadius: 0.06, fill: { color: 'F8F8F7' }, line: { color: COLOR.faint, width: 1 } });
    slide.addText(tile.label.toUpperCase(), { x: x + 0.15, y: y + 0.12, w: colW - 0.3, h: 0.3, fontSize: 10, color: COLOR.muted, fontFace: 'Arial' });
    slide.addText(tile.value, {
      x: x + 0.15, y: y + 0.4, w: colW - 0.3, h: 0.55, fontSize: 24, bold: true, color: toneColor(tile.tone), fontFace: 'Arial',
    });
    if (tile.hint) {
      slide.addText(tile.hint, { x: x + 0.15, y: y + 0.95, w: colW - 0.3, h: 0.35, fontSize: 9, color: COLOR.muted, fontFace: 'Arial' });
    }
  });
}

function addPatientTrendSlide(pptx: PptxGenJS, trend: MonthlyTrendPoint[]) {
  const slide = pptx.addSlide();
  slide.addText('New vs Returning Patients', { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: COLOR.ink, fontFace: 'Arial' });
  slide.addText('Trailing 12 months', { x: 0.4, y: 0.68, w: 9.2, h: 0.3, fontSize: 12, color: COLOR.muted, fontFace: 'Arial' });

  if (trend.length === 0) {
    slide.addText('No data available.', { x: 0.4, y: 2.5, w: 9.2, h: 0.5, fontSize: 14, color: COLOR.muted, fontFace: 'Arial' });
    return;
  }

  const labels = trend.map((d) => formatMonthLabel(d.month));
  slide.addChart(
    pptx.ChartType.bar,
    [
      { name: 'New', labels, values: trend.map((d) => d.newPatients) },
      { name: 'Returning', labels, values: trend.map((d) => d.returningPatients) },
    ],
    {
      x: 0.4, y: 1.1, w: 9.2, h: 4.2,
      barGrouping: 'stacked',
      chartColors: [COLOR.indigo, COLOR.indigoLight],
      showLegend: true,
      legendPos: 'b',
      legendFontSize: 10,
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
      dataLabelFontSize: 8,
    },
  );
}

function addRevenueTrendSlide(pptx: PptxGenJS, trend: MonthlyTrendPoint[]) {
  const slide = pptx.addSlide();
  slide.addText('Revenue Trend', { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: COLOR.ink, fontFace: 'Arial' });
  slide.addText('Trailing 12 months (OMR)', { x: 0.4, y: 0.68, w: 9.2, h: 0.3, fontSize: 12, color: COLOR.muted, fontFace: 'Arial' });

  if (trend.length === 0) {
    slide.addText('No data available.', { x: 0.4, y: 2.5, w: 9.2, h: 0.5, fontSize: 14, color: COLOR.muted, fontFace: 'Arial' });
    return;
  }

  const labels = trend.map((d) => formatMonthLabel(d.month));
  slide.addChart(
    pptx.ChartType.area,
    [{ name: 'Revenue', labels, values: trend.map((d) => Math.round(d.revenue)) }],
    {
      x: 0.4, y: 1.1, w: 9.2, h: 4.2,
      chartColors: [COLOR.emerald],
      showLegend: false,
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
    },
  );
}

function addTopServicesSlide(pptx: PptxGenJS, topServices: ServiceStat[]) {
  const slide = pptx.addSlide();
  slide.addText('Top Selling Services', { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: COLOR.ink, fontFace: 'Arial' });
  slide.addText('By revenue, selected period', { x: 0.4, y: 0.68, w: 9.2, h: 0.3, fontSize: 12, color: COLOR.muted, fontFace: 'Arial' });

  const top = [...topServices].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  if (top.length === 0) {
    slide.addText('No sales in this period.', { x: 0.4, y: 2.5, w: 9.2, h: 0.5, fontSize: 14, color: COLOR.muted, fontFace: 'Arial' });
    return;
  }

  const headerRow = ['Service', 'Type', 'Times Sold', 'Revenue'].map((text) => ({
    text,
    options: { bold: true, color: COLOR.white, fill: { color: COLOR.indigo }, fontSize: 11 },
  }));
  const rows = top.map((s) => [
    { text: s.serviceName, options: { fontSize: 10 } },
    { text: s.itemType, options: { fontSize: 10, color: COLOR.muted } },
    { text: formatNumber(s.count), options: { fontSize: 10, align: 'right' as const } },
    { text: formatCurrency(s.revenue), options: { fontSize: 10, align: 'right' as const, bold: true } },
  ]);

  slide.addTable([headerRow, ...rows], {
    x: 0.4, y: 1.1, w: 9.2,
    colW: [4.4, 1.6, 1.4, 1.8],
    border: { type: 'solid', color: COLOR.faint, pt: 0.5 },
    autoPage: false,
  });
}

function addPatientHealthSlide(pptx: PptxGenJS, params: DashboardPptxParams) {
  const { atRiskCount, returnedPatients, inactivityDays } = params;
  const stillActive = returnedPatients.filter((p) => p.currentlyActive).length;

  const slide = pptx.addSlide();
  slide.addText('Patient Retention Health', { x: 0.4, y: 0.25, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: COLOR.ink, fontFace: 'Arial' });
  slide.addText(`Inactivity threshold: ${inactivityDays} days`, { x: 0.4, y: 0.68, w: 9.2, h: 0.3, fontSize: 12, color: COLOR.muted, fontFace: 'Arial' });

  const cards = [
    { label: 'Stopped Visiting', value: formatNumber(atRiskCount), hint: `Inactive ${inactivityDays}+ days as of today`, color: COLOR.rose },
    { label: 'Returned After Going Quiet', value: formatNumber(returnedPatients.length), hint: 'Had a qualifying gap, then came back', color: COLOR.amber },
    { label: 'Still Active Since Returning', value: formatNumber(stillActive), hint: 'Of those who returned', color: COLOR.emerald },
  ];

  const gap = 0.25;
  const startX = 0.4;
  const colW = (10 - startX * 2 - gap * 2) / 3;
  cards.forEach((c, i) => {
    const x = startX + i * (colW + gap);
    slide.addShape('roundRect', { x, y: 1.2, w: colW, h: 2, rectRadius: 0.08, fill: { color: 'F8F8F7' }, line: { color: COLOR.faint, width: 1 } });
    slide.addText(c.label, { x: x + 0.2, y: 1.4, w: colW - 0.4, h: 0.5, fontSize: 12, color: COLOR.muted, fontFace: 'Arial' });
    slide.addText(c.value, { x: x + 0.2, y: 1.85, w: colW - 0.4, h: 0.7, fontSize: 32, bold: true, color: c.color, fontFace: 'Arial' });
    slide.addText(c.hint, { x: x + 0.2, y: 2.6, w: colW - 0.4, h: 0.5, fontSize: 9, color: COLOR.muted, fontFace: 'Arial' });
  });

  if (returnedPatients.length > 0) {
    slide.addText('Most recent returns', { x: 0.4, y: 3.5, w: 9.2, h: 0.35, fontSize: 13, bold: true, color: COLOR.ink, fontFace: 'Arial' });
    const headerRow = ['Patient', 'Went Quiet On', 'Returned On', 'Status'].map((text) => ({
      text,
      options: { bold: true, color: COLOR.white, fill: { color: COLOR.indigo }, fontSize: 10 },
    }));
    const rows = returnedPatients.slice(0, 5).map((p) => [
      { text: p.patientName, options: { fontSize: 9 } },
      { text: p.wentQuietOn, options: { fontSize: 9, color: COLOR.muted } },
      { text: p.returnedOn, options: { fontSize: 9 } },
      { text: p.currentlyActive ? 'Still active' : 'Went quiet again', options: { fontSize: 9, color: p.currentlyActive ? COLOR.emerald : COLOR.rose } },
    ]);
    slide.addTable([headerRow, ...rows], {
      x: 0.4, y: 3.9, w: 9.2,
      colW: [3.4, 2, 2, 1.8],
      border: { type: 'solid', color: COLOR.faint, pt: 0.5 },
      autoPage: false,
    });
  }
}

/** Builds and downloads an executive-summary PowerPoint of the main Dashboard tab - headline KPIs plus the key trend/retention charts, using the exact same computed numbers already shown on screen. */
export async function exportDashboardPptx(params: DashboardPptxParams): Promise<void> {
  // Loaded lazily so pptxgenjs (a sizeable library) only ships to the browser when someone
  // actually clicks "Download PowerPoint", not on initial page load - same reasoning as
  // excelParser.ts's lazy `xlsx` import.
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.author = 'Patient Matrix';
  pptx.company = 'Bio Thrive International';
  pptx.title = 'Patient Matrix - Dashboard Report';
  pptx.layout = 'LAYOUT_16x9';

  addTitleSlide(pptx, params);
  addKpiSlide(pptx, params);
  addPatientTrendSlide(pptx, params.trend);
  addRevenueTrendSlide(pptx, params.trend);
  addTopServicesSlide(pptx, params.topServices);
  addPatientHealthSlide(pptx, params);

  await pptx.writeFile({ fileName: `patient-matrix-dashboard-${params.rangeEnd}.pptx` });
}
