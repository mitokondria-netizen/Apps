import JSZip from 'jszip';

interface NumLevel {
  numFmt: string;
  lvlText: string;
  start: number;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function numberToLowerLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(97 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function numberToLowerRoman(n: number): string {
  const romanMap: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
  ];
  let res = '';
  for (const [val, sym] of romanMap) {
    while (n >= val) { res += sym; n -= val; }
  }
  return res;
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'decimal': return String(n);
    case 'decimalZero': return n < 10 ? '0' + n : String(n);
    case 'lowerLetter': return numberToLowerLetter(n);
    case 'upperLetter': return numberToLowerLetter(n).toUpperCase();
    case 'lowerRoman': return numberToLowerRoman(n);
    case 'upperRoman': return numberToLowerRoman(n).toUpperCase();
    case 'none': return '';
    default: return String(n);
  }
}

function parseNumbering(xml: string): Record<string, NumLevel[]> {
  const abstractNums: Record<string, NumLevel[]> = {};
  const abstractBlockRe = /<w:abstractNum\s+w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g;
  let am;
  while ((am = abstractBlockRe.exec(xml)) !== null) {
    const abstractId = am[1];
    const body = am[2];
    const levels: NumLevel[] = [];
    const lvlRe = /<w:lvl\s+w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
    let lm;
    while ((lm = lvlRe.exec(body)) !== null) {
      const ilvl = parseInt(lm[1], 10);
      const lvlBody = lm[2];
      const startMatch = lvlBody.match(/<w:start\s+w:val="(\d+)"/);
      const fmtMatch = lvlBody.match(/<w:numFmt\s+w:val="([a-zA-Z]+)"/);
      const textMatch = lvlBody.match(/<w:lvlText\s+w:val="([^"]*)"/);
      levels[ilvl] = {
        start: startMatch ? parseInt(startMatch[1], 10) : 1,
        numFmt: fmtMatch ? fmtMatch[1] : 'decimal',
        lvlText: textMatch ? decodeXmlEntities(textMatch[1]) : '%1.'
      };
    }
    abstractNums[abstractId] = levels;
  }

  const numIdToAbstract: Record<string, string> = {};
  const numRe = /<w:num\s+w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g;
  let nm;
  while ((nm = numRe.exec(xml)) !== null) {
    const numId = nm[1];
    const body = nm[2];
    const absMatch = body.match(/<w:abstractNumId\s+w:val="(\d+)"/);
    if (absMatch) numIdToAbstract[numId] = absMatch[1];
  }

  const result: Record<string, NumLevel[]> = {};
  for (const numId of Object.keys(numIdToAbstract)) {
    const absId = numIdToAbstract[numId];
    if (abstractNums[absId]) {
      result[numId] = abstractNums[absId];
    }
  }
  return result;
}

interface ParagraphInfo {
  text: string;
  numId: string | null;
  ilvl: number;
}

function parseParagraphs(documentXml: string): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  // Match each <w:p ...>...</w:p> block (paragraphs never nest in OOXML body)
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm;
  while ((pm = pRe.exec(documentXml)) !== null) {
    const body = pm[1];

    // Skip text that lives inside deleted-tracked-changes runs
    const cleanedBody = body.replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '');

    // numPr (list numbering) info, if any - only meaningful inside w:pPr
    const pPrMatch = cleanedBody.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
    let numId: string | null = null;
    let ilvl = 0;
    if (pPrMatch) {
      const pPrBody = pPrMatch[1];
      const numPrMatch = pPrBody.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
      if (numPrMatch) {
        const numPrBody = numPrMatch[1];
        const numIdMatch = numPrBody.match(/<w:numId\s+w:val="(\d+)"/);
        const ilvlMatch = numPrBody.match(/<w:ilvl\s+w:val="(\d+)"/);
        if (numIdMatch) numId = numIdMatch[1];
        ilvl = ilvlMatch ? parseInt(ilvlMatch[1], 10) : 0;
      }
    }

    // Extract visible text runs in order: w:t, w:tab, w:br/w:cr
    let text = '';
    const tokenRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^/]*\/>|<w:(?:br|cr)\b[^/]*\/>/g;
    let tm;
    while ((tm = tokenRe.exec(cleanedBody)) !== null) {
      if (tm[1] !== undefined) {
        text += decodeXmlEntities(tm[1]);
      } else if (tm[0].startsWith('<w:tab')) {
        text += '\t';
      } else {
        text += '\n';
      }
    }

    paragraphs.push({ text, numId, ilvl });
  }
  return paragraphs;
}

/**
 * Reads a .docx file and extracts its body text, restoring Word's
 * auto-generated list numbers (e.g. "(1)", "(2)", "a.", "b.") which
 * mammoth.extractRawText silently drops since those markers are
 * list-numbering metadata, not literal characters in the XML.
 *
 * This matters a lot for Indonesian Perda/Ranperda documents, where
 * ayat (verse) numbers like "(1)", "(2)", "(3)" are almost always done
 * via Word's multilevel-list feature rather than typed manually -
 * without restoring them, downstream pasal/ayat-boundary detection has
 * no way to tell where one ayat ends and the next begins.
 */
export async function extractDocxTextWithListNumbers(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error('word/document.xml tidak ditemukan di dalam file .docx');
  }
  const documentXml = await documentFile.async('string');

  const numberingFile = zip.file('word/numbering.xml');
  const numberingXml = numberingFile ? await numberingFile.async('string') : '';
  const numbering = numberingXml ? parseNumbering(numberingXml) : {};

  const paragraphs = parseParagraphs(documentXml);

  // Counters per (numId -> ilvl -> current count). Word resets deeper
  // levels back to their start value whenever a shallower level advances.
  const counters: Record<string, number[]> = {};

  const lines: string[] = [];
  for (const para of paragraphs) {
    let marker = '';
    if (para.numId && numbering[para.numId] && numbering[para.numId][para.ilvl]) {
      const levels = numbering[para.numId];
      if (!counters[para.numId]) {
        counters[para.numId] = levels.map(lvl => (lvl ? lvl.start - 1 : 0));
      }
      const counterArr = counters[para.numId];
      counterArr[para.ilvl] = (counterArr[para.ilvl] ?? levels[para.ilvl].start - 1) + 1;
      // Reset any deeper levels back to their start
      for (let deeper = para.ilvl + 1; deeper < levels.length; deeper++) {
        if (levels[deeper]) counterArr[deeper] = levels[deeper].start - 1;
      }

      const level = levels[para.ilvl];
      marker = level.lvlText.replace(/%(\d)/g, (_match, digit) => {
        const lvlIdx = parseInt(digit, 10) - 1;
        const lvlDef = levels[lvlIdx];
        const count = counterArr[lvlIdx] ?? (lvlDef ? lvlDef.start : 1);
        return lvlDef ? formatNumber(count, lvlDef.numFmt) : String(count);
      });
    }

    const trimmedText = para.text.trim();
    const fullLine = marker ? `${marker} ${trimmedText}` : trimmedText;
    lines.push(fullLine);
  }

  // Join the same way mammoth.extractRawText does: each paragraph on its
  // own line, separated by a blank line, so the rest of the app's regex
  // (which already expects this layout) keeps working unchanged.
  return lines.join('\n\n');
}
