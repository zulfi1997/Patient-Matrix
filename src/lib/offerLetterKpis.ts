import type { DocxBlock } from './docxParser';

export interface ExtractedKpi {
  category: string;
  metric: string;
  target: string;
  measurementMethod: string;
}

export interface ExtractedScorecard {
  employeeName: string | null;
  roleTitle: string | null;
  kpis: ExtractedKpi[];
}

/** A paragraph like "4.1 Revenue & Financial Performance" - this HR template's convention for a KPI subsection heading. */
function isSectionHeading(text: string): boolean {
  return /^\d+\.\d+\s+\S/.test(text.trim());
}

function stripHeadingNumber(text: string): string {
  return text.replace(/^\d+\.\d+\s+/, '').trim();
}

/** Recognizes this template's 3-column KPI table by its header row, tolerant of minor header wording differences. */
function isKpiTableHeader(row: string[]): boolean {
  if (row.length < 2) return false;
  const [a, b] = row.map((c) => c.toLowerCase());
  return a.includes('kpi') || (a.includes('metric') && b.includes('target'));
}

export function extractKpisFromBlocks(blocks: DocxBlock[]): ExtractedScorecard['kpis'] {
  const kpis: ExtractedKpi[] = [];
  let currentCategory = 'General';

  for (const block of blocks) {
    if (block.type === 'paragraph') {
      if (isSectionHeading(block.text)) {
        currentCategory = stripHeadingNumber(block.text);
      }
      continue;
    }

    // block.type === 'table'
    const [header, ...body] = block.rows;
    if (!header || !isKpiTableHeader(header)) continue;

    for (const row of body) {
      const [metric, target, measurementMethod] = row;
      if (!metric || !target) continue;
      kpis.push({ category: currentCategory, metric: metric.trim(), target: target.trim(), measurementMethod: (measurementMethod ?? '').trim() });
    }
  }

  return kpis;
}

/** Best-effort employee name/role from the letter's opening lines - this template's "Ms./Mr./Dr. <Name>" and "Subject: Offer of Employment – <Role>" lines. Falls back to null so the UI can ask for manual confirmation instead of guessing wrong. */
export function extractEmployeeInfo(blocks: DocxBlock[]): { employeeName: string | null; roleTitle: string | null } {
  const paragraphs = blocks.filter((b): b is Extract<DocxBlock, { type: 'paragraph' }> => b.type === 'paragraph').slice(0, 15);

  let employeeName: string | null = null;
  let roleTitle: string | null = null;

  for (const p of paragraphs) {
    const nameMatch = /^(?:Ms\.|Mr\.|Dr\.|Mrs\.)\s+(.+)$/.exec(p.text.trim());
    if (nameMatch && !employeeName) employeeName = nameMatch[1].trim();

    const subjectMatch = /Subject:\s*Offer of Employment\s*[-–—]\s*(.+)$/i.exec(p.text.trim());
    if (subjectMatch && !roleTitle) roleTitle = subjectMatch[1].trim();
  }

  return { employeeName, roleTitle };
}

export function extractScorecardFromBlocks(blocks: DocxBlock[]): ExtractedScorecard {
  const { employeeName, roleTitle } = extractEmployeeInfo(blocks);
  return { employeeName, roleTitle, kpis: extractKpisFromBlocks(blocks) };
}
