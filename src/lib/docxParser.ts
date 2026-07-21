import JSZip from 'jszip';

export type DocxBlock = { type: 'paragraph'; text: string; bold: boolean } | { type: 'table'; rows: string[][] };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractRunsText(xml: string): string {
  // Must require a tag boundary right after "w:t" ('>' or whitespace-then-attributes) - a bare
  // [^>]* here would also match <w:tcPr>, <w:tcW>, <w:tblGrid>, <w:top> etc., since they all
  // start with the literal characters "w:t" too.
  const texts = [...xml.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)].map((m) => decodeEntities(m[1]));
  return texts.join('');
}

/** A paragraph counts as "bold" if every text run in it is bold - a reasonable proxy for a heading in these HR templates, which bold whole heading lines but not body text. */
function isBoldParagraph(xml: string): boolean {
  const runs = [...xml.matchAll(/<w:r(?:\s[^>]*)?>(.*?)<\/w:r>/gs)];
  if (runs.length === 0) return false;
  return runs.every((r) => /<w:b\/>|<w:b w:val="(true|1)"\/>/.test(r[1]) && /<w:t(?:\s[^>]*)?>/.test(r[1]));
}

/**
 * Extracts a Word document's body as an ordered sequence of paragraphs and tables, preserving
 * document order so a table can be associated with whichever heading paragraph preceded it -
 * exactly what's needed to recover "4.1 Revenue & Financial Performance" as the label for the
 * KPI table that follows it, without needing full DOCX->HTML rendering fidelity.
 */
export async function parseDocxBlocks(file: File): Promise<DocxBlock[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docXml = await zip.file('word/document.xml')?.async('text');
  if (!docXml) throw new Error('Not a valid .docx file (missing word/document.xml).');

  const bodyMatch = /<w:body>([\s\S]*)<\/w:body>/.exec(docXml);
  const body = bodyMatch ? bodyMatch[1] : docXml;

  // Split into top-level <w:p> (paragraph) and <w:tbl> (table) elements, in document order.
  const blocks: DocxBlock[] = [];
  const topLevelRegex = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let match: RegExpExecArray | null;
  while ((match = topLevelRegex.exec(body))) {
    const chunk = match[0];
    if (chunk.startsWith('<w:tbl>')) {
      const rowXmls = [...chunk.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
      const rows = rowXmls.map((rowXml) => {
        const cellXmls = [...rowXml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
        return cellXmls.map((cellXml) => extractRunsText(cellXml).trim());
      });
      if (rows.length > 0) blocks.push({ type: 'table', rows });
    } else {
      const text = extractRunsText(chunk).trim();
      if (text) blocks.push({ type: 'paragraph', text, bold: isBoldParagraph(chunk) });
    }
  }

  return blocks;
}
