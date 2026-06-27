import { MapItem, EXCEL_MAPPING, RanperdaData, PivotItem, ConsistencyResult, SummaryStats, StrukturPivotItem, StrukturConsistencyResult, StrukturSummaryStats } from './types';
import * as XLSX from 'xlsx';

/**
 * Restricts the document to the "BAB ... POLA RUANG" chapter, so that
 * unrelated chapters (Ketentuan Umum, Rencana Struktur Ruang, Kawasan
 * Strategis, Ketentuan Pengendalian, etc.) can't accidentally feed numbers
 * into the pola-ruang consistency check - e.g. a stray "luas wilayah
 * kabupaten 1.200.000 hektare" sentence in Ketentuan Umum should never be
 * mistaken for a kawasan's area.
 *
 * Falls back to the original full text if no "BAB ... POLA RUANG" heading
 * can be found (e.g. the uploaded file is already just an excerpt of that
 * chapter), so this never makes things worse than before.
 */
export function extractPolaRuangSection(text: string): string {
  const babMatches = Array.from(text.matchAll(/\bBAB\s+([IVXLCDM]+|\d+)\b/gi));
  if (babMatches.length === 0) return text;

  for (let i = 0; i < babMatches.length; i++) {
    const m = babMatches[i];
    const idx = m.index ?? -1;
    if (idx === -1) continue;
    const headingArea = text.substring(idx, idx + 200).toUpperCase();
    if (headingArea.includes('POLA RUANG')) {
      const endIdx = i + 1 < babMatches.length ? (babMatches[i + 1].index ?? text.length) : text.length;
      return text.substring(idx, endIdx);
    }
  }
  // No BAB explicitly mentions "POLA RUANG" - leave the text untouched
  // rather than guessing wrong and silently dropping real content.
  return text;
}

export interface DiscoveredKawasan {
  nama: string;
  kode: string;
  pasalAyatLabel: string;
  textBlock: string;
  isTotal: boolean;
  orderIndex: number;
}

interface ParaInfo {
  text: string;
  label: string;
  isClauseBoundary: boolean;
}

const NAME_KODE_RE = /^(?:\(\s*\d+\s*\)\s*|[a-z]\.\s*)*([A-Za-z][A-Za-z\s]*?)\s+dengan\s+kode\s+([A-Z0-9\-]+)\b/i;
const LUAS_RE = /\b(?:seluas|luas)\b(?:\s+\w+)?(?:\s+kurang\s+lebih)?\s+[\d.,]+/i;
const DISTRIK_RE = /berada\s*(?:di)?\s*:|berada\s+di\s+(?:distrik|kecamatan)\b/i;

/**
 * Splits text into paragraphs and tags each one with its current "Pasal N
 * ayat (M)" label and whether it itself starts a new clause boundary
 * ("Pasal N" heading or a "(N)" verse marker at the start of the
 * paragraph). Shared by discoverKawasanFromText and buildKodeAliasMap so
 * both see the exact same paragraph/clause structure.
 */
function buildParaInfos(text: string): ParaInfo[] {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  const infos: ParaInfo[] = [];
  let currentPasal = '';
  let currentAyat: string | null = null;

  for (const para of paragraphs) {
    let isClauseBoundary = false;

    // Match "Pasal N" either as the entire paragraph, or as the first line
    // of a paragraph that continues with other text right after (no blank
    // line separating the "Pasal N" heading from its body / first ayat -
    // common when a .docx export collapses a Pasal and its content into a
    // single paragraph).
    const pasalHeadingMatch = para.match(/^Pasal\s+(\d+)\s*(?:$|\n)/i);
    if (pasalHeadingMatch) {
      currentPasal = `Pasal ${pasalHeadingMatch[1]}`;
      currentAyat = null;
      isClauseBoundary = true;

      // The rest of the paragraph (after the "Pasal N" line) may itself
      // start with an ayat marker "(N)" - pick that up too so the label
      // reflects "Pasal N ayat (M)" instead of just "Pasal N".
      const rest = para.slice(pasalHeadingMatch[0].length);
      const ayatAfterPasal = rest.match(/^\(\s*(\d+)\s*\)/);
      if (ayatAfterPasal) {
        currentAyat = `ayat (${ayatAfterPasal[1]})`;
      }
    } else {
      const ayatMatch = para.match(/^\(\s*(\d+)\s*\)/);
      if (ayatMatch) {
        currentAyat = `ayat (${ayatMatch[1]})`;
        isClauseBoundary = true;
      }
    }
    const label = currentPasal ? (currentAyat ? `${currentPasal} ${currentAyat}` : currentPasal) : '';
    infos.push({ text: para, label, isClauseBoundary });
  }
  return infos;
}

/**
 * Merges paragraph `i` forward with every following paragraph up to (not
 * including) the next real clause boundary - a new "Pasal"/"(N)" marker, or
 * another paragraph that itself defines a different kawasan-with-luas. This
 * is what pulls lettered sub-items ("a. Cagar Alam dengan kode CA; dan",
 * district lists, etc.) into the same block as the clause that introduces
 * them.
 */
function mergeClauseBlock(infos: ParaInfo[], i: number): string {
  const blockParts = [infos[i].text];
  for (let j = i + 1; j < infos.length; j++) {
    if (infos[j].isClauseBoundary) break;
    const otherMatch = infos[j].text.match(NAME_KODE_RE);
    if (otherMatch && LUAS_RE.test(infos[j].text)) break;
    blockParts.push(infos[j].text);
  }
  return blockParts.join('\n\n');
}

/**
 * Scans the (already BAB-scoped) Ranperda text and automatically finds
 * every "<Nama Kawasan> dengan kode <KODE> ... seluas/luas kurang lebih
 * <angka> hektar..." clause, wherever it happens to live in the document -
 * no fixed Pasal/ayat table required. This is what lets the checker work
 * on any kabupaten's Ranperda, including kawasan categories nobody
 * hardcoded in advance (Kawasan Pertambangan, Kawasan Rawan Bencana, dst).
 *
 * Pasal/ayat numbering is still recovered for display purposes by tracking
 * "Pasal N" headings and "(N)" verse markers as we walk through the
 * document in order.
 */
export function discoverKawasanFromText(text: string): DiscoveredKawasan[] {
  const infos = buildParaInfos(text);
  const found: DiscoveredKawasan[] = [];

  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    const nameKodeMatch = info.text.match(NAME_KODE_RE);
    if (!nameKodeMatch || !LUAS_RE.test(info.text)) continue;

    const nama = nameKodeMatch[1].trim();
    const kode = nameKodeMatch[2].trim();
    const textBlock = mergeClauseBlock(infos, i);

    found.push({
      nama,
      kode,
      pasalAyatLabel: info.label || '(Pasal tidak diketahui)',
      textBlock,
      isTotal: !DISTRIK_RE.test(textBlock),
      orderIndex: i
    });
  }

  return found;
}

/**
 * Scans every clause block in the text (regardless of whether it carries
 * its own luas figure) for "<Nama> dengan kode <KODE> ..." definitions that
 * also reference other "dengan kode <X>" kode's within the same merged
 * block (including its lettered sub-items), recording kode -> [child
 * kode...] links.
 *
 * This catches umbrella/alias relationships that discoverKawasanFromText
 * intentionally skips because they don't carry their own area figure -
 * e.g. "(2) Kawasan Suaka Alam dengan kode KSA ... meliputi:\n\na. Cagar
 * Alam dengan kode CA; dan\n\nb. Kawasan Suaka Alam dengan kode KSA." (no
 * luas, but tells us KSA's real-world area is split across CA and KSA), or
 * "(3) Kawasan Pelestarian Alam dengan kode KPA ... berupa Taman Nasional
 * dengan kode TN." (a 1:1 alias). Needed so multi-level aggregates (a
 * "total" whose children are themselves further broken down) can be
 * resolved recursively instead of only one level deep.
 */
export function buildKodeAliasMap(text: string): Map<string, string[]> {
  const infos = buildParaInfos(text);
  const map = new Map<string, string[]>();

  for (let i = 0; i < infos.length; i++) {
    // Lettered sub-items ("a. Badan Air dengan kode BA;") belong to an
    // enclosing list (e.g. Pasal 21's master table-of-contents enumerating
    // every category) rather than being their own clause head. Scanning
    // from them directly would merge-forward through the rest of that
    // enclosing list (since plain enumeration items carry no luas/clause
    // marker to stop at), producing bogus alias relationships.
    if (/^[a-z]\.\s/i.test(infos[i].text)) continue;

    const headMatch = infos[i].text.match(NAME_KODE_RE);
    if (!headMatch) continue;
    const ownKode = headMatch[2].trim().toUpperCase();

    // Look at this paragraph merged with its lettered sub-items (e.g. the
    // "a. ...; b. ...;" list that follows a "meliputi:"/"terdiri dari:"
    // paragraph), not just the single isolated paragraph - otherwise the
    // child kode mentions (which live in their own separate paragraphs)
    // would never be seen.
    const block = mergeClauseBlock(infos, i);
    const allKodes = Array.from(block.matchAll(/dengan\s+kode\s+([A-Z0-9\-]+)\b/gi)).map(m => m[1].toUpperCase());
    const children = Array.from(new Set(allKodes.filter(k => k !== ownKode)));
    if (children.length > 0) {
      const existing = map.get(ownKode) || [];
      map.set(ownKode, Array.from(new Set([...existing, ...children])));
    }
  }

  return map;
}

/**
 * Generic fuzzy name matcher: given a target string and a list of candidate
 * strings, returns the index of the best match (or -1). Used both to match
 * Pivot NAMOBJ entries against names discovered in the Ranperda text, and
 * vice versa - deliberately NOT tied to any fixed category list, so it
 * works for kawasan types nobody anticipated in advance.
 */
export function fuzzyMatchNameIndex(target: string, candidates: string[]): number {
  if (!target) return -1;
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const cleanTarget = clean(target);
  if (!cleanTarget) return -1;

  // 1. Exact match
  for (let i = 0; i < candidates.length; i++) {
    if (clean(candidates[i]) === cleanTarget) return i;
  }
  // 2. One starts with the other
  for (let i = 0; i < candidates.length; i++) {
    const c = clean(candidates[i]);
    if (c && (cleanTarget.startsWith(c) || c.startsWith(cleanTarget))) return i;
  }
  // 3. One contains the other (only for reasonably specific names)
  for (let i = 0; i < candidates.length; i++) {
    const c = clean(candidates[i]);
    if (c.length >= 4 && (cleanTarget.includes(c) || c.includes(cleanTarget))) return i;
  }
  // 4. Word-level overlap with crude stemming, to tolerate minor
  // inflectional differences in Indonesian wording between the Pivot and
  // the Ranperda text (e.g. "Pembangkit" vs "Pembangkitan"). Generic
  // structural words are filtered out first so they don't inflate the
  // denominator (e.g. "Kawasan Hutan Produksi yang dapat Dikonversi" vs
  // "Hutan Produksi Dapat Dikonversi" should still match well).
  const STOPWORDS = new Set(['kawasan', 'yang', 'dengan', 'dan', 'atau', 'di', 'ke', 'dari', 'pada', 'untuk']);
  const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const stem = (w: string) => w.slice(0, Math.min(6, w.length));
  const targetWords = wordsOf(target).map(stem);
  if (targetWords.length > 0) {
    let bestIdx = -1;
    let bestRatio = 0;
    for (let i = 0; i < candidates.length; i++) {
      const candWords = wordsOf(candidates[i]).map(stem);
      if (candWords.length === 0) continue;
      const matchCount = targetWords.filter(w => candWords.includes(w)).length;
      const ratio = matchCount / Math.max(targetWords.length, candWords.length);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestIdx = i;
      }
    }
    if (bestRatio >= 0.7) return bestIdx;
  }
  return -1;
}

// Helper to convert number to Indonesian words (Terbilang)
// Internal recursive worker: returns "" for 0 (instead of "nol"), since 0
// only needs to be spelled out as "nol" when it is the WHOLE number, not
// when it's a remainder inside a bigger number (e.g. 80.000 must read
// "delapan puluh ribu", not "delapan puluh nol ribu nol").
function terbilangPart(n: number): string {
  const ones = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  if (n === 0) return "";

  let temp = "";
  if (n < 12) {
    temp = ones[n];
  } else if (n < 20) {
    temp = terbilangPart(n - 10) + " belas";
  } else if (n < 100) {
    const rest = terbilangPart(n % 10);
    temp = terbilangPart(Math.floor(n / 10)) + " puluh" + (rest ? " " + rest : "");
  } else if (n < 200) {
    const rest = terbilangPart(n - 100);
    temp = "seratus" + (rest ? " " + rest : "");
  } else if (n < 1000) {
    const rest = terbilangPart(n % 100);
    temp = terbilangPart(Math.floor(n / 100)) + " ratus" + (rest ? " " + rest : "");
  } else if (n < 2000) {
    const rest = terbilangPart(n - 1000);
    temp = "seribu" + (rest ? " " + rest : "");
  } else if (n < 1000000) {
    const rest = terbilangPart(n % 1000);
    temp = terbilangPart(Math.floor(n / 1000)) + " ribu" + (rest ? " " + rest : "");
  } else if (n < 1000000000) {
    const rest = terbilangPart(n % 1000000);
    temp = terbilangPart(Math.floor(n / 1000000)) + " juta" + (rest ? " " + rest : "");
  } else if (n < 1000000000000) {
    const rest = terbilangPart(n % 1000000000);
    temp = terbilangPart(Math.floor(n / 1000000000)) + " milyar" + (rest ? " " + rest : "");
  } else if (n < 1000000000000000) {
    const rest = terbilangPart(n % 1000000000000);
    temp = terbilangPart(Math.floor(n / 1000000000000)) + " triliun" + (rest ? " " + rest : "");
  }
  return temp.trim().replace(/\s+/g, " ");
}

export function terbilang(n: number): string {
  if (n < 0) return "minus " + terbilang(-n);
  if (n === 0) return "nol";
  return terbilangPart(n);
}

// Normalize strings for uniform comparison
export function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function normalizeDistrict(s: string): string {
  if (!s) return "";
  let normalized = s.trim().toLowerCase();
  
  // Strip parentheses and anything inside them (e.g., "Naikere (Utara)" -> "Naikere")
  normalized = normalized.replace(/\s*\(.*?\)\s*/g, ' ');
  
  // Replace multiple spaces with single space
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Strip "distrik " or "kecamatan " from the start
  if (normalized.startsWith('distrik ')) {
    normalized = normalized.slice(8);
  } else if (normalized.startsWith('kecamatan ')) {
    normalized = normalized.slice(10);
  }
  
  // Strip word boundaries for distrik or kecamatan in between or at the end
  normalized = normalized.replace(/\bdistrik\b/g, '').replace(/\bkecamatan\b/g, '');
  
  // Remove punctuation at character start/end
  normalized = normalized.replace(/[,;.\s]+$/, '').replace(/^[:\-–—\s]+/, '');
  
  return normalized.trim().replace(/\s+/g, ' ');
}

// Map combined or messy category strings to key names defined in EXCEL_MAPPING
export function findMatchingCategory(rawName: string): string | null {
  if (!rawName) return null;
  const cleanRaw = rawName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  if (cleanRaw.length === 0) return null;

  // 1. Exact alphanumeric match
  for (const item of EXCEL_MAPPING) {
    const cleanMapping = item.namobj.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    if (cleanRaw === cleanMapping) {
      return item.namobj;
    }
  }

  // 2. Starts with / Ends with match
  for (const item of EXCEL_MAPPING) {
    const cleanMapping = item.namobj.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    if (cleanRaw.startsWith(cleanMapping) || cleanMapping.startsWith(cleanRaw)) {
      return item.namobj;
    }
  }

  // 3. Simple includes match
  for (const item of EXCEL_MAPPING) {
    const cleanMapping = item.namobj.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    if (cleanMapping.length >= 4 && (cleanRaw.includes(cleanMapping) || cleanMapping.includes(cleanRaw))) {
      return item.namobj;
    }
  }

  return null;
}

// Custom parser to handle structural variations in Excel Pivot Sheets
export function parsePivotExcel(worksheet: any): Record<string, PivotItem> {
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
  
  let namobjIdx = 0;
  let wadmkcIdx = 1;
  let luashaIdx = 2;
  
  // Dynamic header search to binding index
  let startRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const row = rows[i];
    if (!row) continue;
    
    const namobjPos = row.findIndex(c => String(c).toUpperCase().trim() === 'NAMOBJ');
    if (namobjPos !== -1) {
      namobjIdx = namobjPos;
      
      const wadmkcPos = row.findIndex(c => {
        const val = String(c).toUpperCase().trim();
        return val === 'WADMKC' || val === 'DISTRIK' || val === 'KECAMATAN' || val === 'KECAMATAN_1';
      });
      if (wadmkcPos !== -1) wadmkcIdx = wadmkcPos;
      
      const luashaPos = row.findIndex(c => {
        const val = String(c).toUpperCase().trim();
        return val.includes('LUAS') || val.includes('HA') || val.includes('SUM OF');
      });
      if (luashaPos !== -1) luashaIdx = luashaPos;
      
      startRowIdx = i + 1;
      break;
    }
  }
  
  const result: Record<string, PivotItem> = {};
  
  // Pre-initialize all standard keys from EXCEL_MAPPING so they are present
  for (const item of EXCEL_MAPPING) {
    if (!item.isTotal) {
      result[item.namobj] = { namobj: item.namobj, districts: [], totalLuas: 0 };
    }
  }

  let currentNAMOBJ: string | null = null;
  const accumulatedTotals: Record<string, number> = {};
  
  for (let i = startRowIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    let namobjVal = row[namobjIdx] ? String(row[namobjIdx]).trim() : null;
    let wadmkcVal = row[wadmkcIdx] ? String(row[wadmkcIdx]).trim() : null;
    const luashaVal = row[luashaIdx] != null ? Number(row[luashaIdx]) : 0;
    
    if (!namobjVal && !wadmkcVal) continue;

    // Check if namobjVal is a header or has a merged format.
    // E.g., namobjVal = "badan air distrik naikere"
    let categoryPart: string | null = null;
    let districtPart: string | null = null;

    if (namobjVal && !namobjVal.toLowerCase().includes('total') && namobjVal !== 'NAMOBJ' && !namobjVal.toLowerCase().includes('grand')) {
      // 1. Try keyword split
      const keywordMatch = namobjVal.match(/(.*?)\b(distrik|kecamatan)\b\s*(.*)/i);
      if (keywordMatch) {
        categoryPart = keywordMatch[1].trim();
        districtPart = (keywordMatch[2] + ' ' + keywordMatch[3]).trim();
      } else {
        // 2. Try prefix matching from standard categories
        for (const item of EXCEL_MAPPING) {
          const catName = item.namobj.toLowerCase();
          const valLower = namobjVal.toLowerCase();
          if (valLower.startsWith(catName) && valLower.length > catName.length) {
            categoryPart = item.namobj;
            districtPart = namobjVal.substring(catName.length).trim();
            break;
          }
        }
      }
    }

    if (categoryPart) {
      // Combined format row label
      const matchedCategory = findMatchingCategory(categoryPart);
      if (matchedCategory) {
        currentNAMOBJ = matchedCategory;
        if (!result[currentNAMOBJ]) {
          result[currentNAMOBJ] = { namobj: currentNAMOBJ, districts: [], totalLuas: 0 };
        }
        
        const finalDistrict = districtPart || wadmkcVal;
        if (finalDistrict && finalDistrict.toLowerCase() !== 'total') {
          if (!result[currentNAMOBJ].districts.includes(finalDistrict)) {
            result[currentNAMOBJ].districts.push(finalDistrict);
          }
        }
        
        if (!accumulatedTotals[currentNAMOBJ]) {
          accumulatedTotals[currentNAMOBJ] = 0;
        }
        accumulatedTotals[currentNAMOBJ] += luashaVal;
      }
    } else {
      // Standard flow
      if (namobjVal && !namobjVal.toLowerCase().includes('total') && namobjVal !== 'NAMOBJ' && !namobjVal.toLowerCase().includes('grand')) {
        const matchedCategory = findMatchingCategory(namobjVal);
        if (matchedCategory) {
          currentNAMOBJ = matchedCategory;
        } else {
          currentNAMOBJ = namobjVal;
        }
        
        if (!result[currentNAMOBJ]) {
          result[currentNAMOBJ] = { namobj: currentNAMOBJ, districts: [], totalLuas: 0 };
        }
      }
      
      if (namobjVal && namobjVal.toLowerCase().includes('total') && !namobjVal.toLowerCase().includes('grand')) {
        const matchName = namobjVal.replace(/Total/i, '').trim();
        const matchedCategory = findMatchingCategory(matchName);
        const targetCategory = matchedCategory || matchName || currentNAMOBJ;
        
        if (targetCategory && result[targetCategory]) {
          result[targetCategory].totalLuas = luashaVal;
          accumulatedTotals[targetCategory] = luashaVal;
        } else if (currentNAMOBJ && result[currentNAMOBJ]) {
          result[currentNAMOBJ].totalLuas = luashaVal;
          accumulatedTotals[currentNAMOBJ] = luashaVal;
        }
      }
      
      const finalDistrict = wadmkcVal;
      if (currentNAMOBJ && finalDistrict && finalDistrict !== 'WADMKC' && finalDistrict.toLowerCase() !== 'total') {
        if (result[currentNAMOBJ]) {
          if (!result[currentNAMOBJ].districts.includes(finalDistrict)) {
            result[currentNAMOBJ].districts.push(finalDistrict);
          }
          if (!accumulatedTotals[currentNAMOBJ]) {
            accumulatedTotals[currentNAMOBJ] = 0;
          }
          accumulatedTotals[currentNAMOBJ] += luashaVal;
        }
      }
    }
  }

  // Populate totalLuas from accumulated sums when explicit totals are 0
  for (const key of Object.keys(result)) {
    if (result[key].totalLuas === 0 && accumulatedTotals[key] > 0) {
      result[key].totalLuas = accumulatedTotals[key];
    }
  }
  
  return result;
}

// Clean and parse Indonesian numbers
export function parseIndonesianNumber(numStr: string, terbilangStr?: string): number {
  let cleaned = numStr.trim().replace(/\s+/g, '');
  
  if (cleaned.includes(',')) {
    // Standard Indonesian format: thousands is dot, decimal is comma
    cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
    return parseFloat(cleaned);
  }
  
  if (cleaned.includes('.')) {
    // Ambiguity exists if only dots are used: "129.259" or "7.30"
    const hasKomaInTerbilang = terbilangStr && /koma/i.test(terbilangStr);
    const hasRibuInTerbilang = terbilangStr && /ribu/i.test(terbilangStr);
    
    if (hasKomaInTerbilang) {
      return parseFloat(cleaned); // treat as decimal 7.30
    }
    if (hasRibuInTerbilang) {
      return parseFloat(cleaned.replace(/\./g, '')); // treat as thousands 129259
    }
    
    const parts = cleaned.split('.');
    const lastPart = parts[parts.length - 1];
    
    // Default heuristic: If followed by exactly 3 digits, it's a thousands separator
    if (lastPart.length === 3) {
      return parseFloat(cleaned.replace(/\./g, ''));
    } else {
      return parseFloat(cleaned);
    }
  }
  
  return parseFloat(cleaned);
}

// Extract kabupaten name from full text title
export function extractKabupatenName(text: string): string {
  const stopWords = new Set([
    "TAHUN", "RENCANA", "PROVINSI", "BUPATI", "DENGAN", "RANCANGAN", "PROV", "BAB",
    "SEBAGAIMANA", "DIMAKSUD", "WILAYAH", "BAGIAN", "UMUM", "INI", "PASAL", "AYAT", "DALAM"
  ]);

  // Collect every "Kabupaten <Name...>" candidate in the document. A generic
  // legal phrase like "Wilayah Kabupaten" happening to be followed by an
  // unrelated heading (e.g. "Bagian Kesatu") only ever appears once, while
  // the actual kabupaten's name is repeated many times throughout a real
  // Ranperda - so picking the most frequent candidate is far more reliable
  // than just taking the first regex match.
  const regex = /Kabupaten\s+((?:[A-Z][a-zA-Z]*\s*){1,4})/g;
  const counts = new Map<string, number>();
  let m;
  while ((m = regex.exec(text)) !== null) {
    const words = m[1].trim().split(/\s+/);
    const cleanWords: string[] = [];
    for (const w of words) {
      if (stopWords.has(w.toUpperCase())) break;
      cleanWords.push(w);
    }
    const candidate = cleanWords.join(' ').trim();
    if (!candidate) continue;
    counts.set(candidate, (counts.get(candidate) || 0) + 1);
  }

  if (counts.size === 0) return "(Tidak terdeteksi)";

  let best = "";
  let bestCount = 0;
  for (const [candidate, count] of counts) {
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return toTitleCase(best);
}

// Slices text to get the block corresponding to articles or sub-sections
export function getPasalTextSection(text: string, pasal: string, ayat: string | null): string {
  // Find "Pasal <No>" first
  const pasalNum = pasal.replace(/Pasal\s+/i, '').trim();
  const pasalRegex = new RegExp(`Pasal\\s+${pasalNum}\\b`, 'i');
  const matchPasal = text.match(pasalRegex);
  if (!matchPasal || matchPasal.index === undefined) {
    return "";
  }
  
  const startPasalIdx = matchPasal.index;
  
  // Find start of NEXT Pasal (e.g., Pasal X+1) to bound the search
  // We'll search for any "Pasal <No>" further in the text and find the closest one
  let nextPasalIdx = text.length;
  const nextPasalsRegex = /Pasal\s+(\d+)\b/ig;
  nextPasalsRegex.lastIndex = startPasalIdx + 10; // offset a bit
  
  let m;
  while ((m = nextPasalsRegex.exec(text)) !== null) {
    if (m.index > startPasalIdx) {
      const parsedNum = m[1];
      if (parseInt(parsedNum) > parseInt(pasalNum)) {
        nextPasalIdx = m.index;
        break;
      }
    }
  }
  
  // Entire pasal block
  const pasalBlock = text.substring(startPasalIdx, nextPasalIdx);
  
  if (!ayat) {
    return pasalBlock;
  }
  
  // If ayat is specified (e.g., "Pasal 25 ayat (4)" or "ayat (4)")
  // Find start of that verse inside the pasal block
  // Verses are usually designated by "(1)", "(2)", "(3)" as a clause marker
  // at the START of a line. We must NOT match a bare in-sentence mention
  // like "...dirinci pada ayat (4)." which merely refers to another verse —
  // only a genuine "(N)" marker sitting at the beginning of its own line
  // counts as the real clause boundary.
  const numMatch = ayat.match(/ayat\s*\(?(\d+)\)?/i) || ayat.match(/\((\d+)\)/);
  const ayatClean = numMatch ? numMatch[1] : ayat.replace(/[^0-9]/g, '');
  
  const ayatRegex = new RegExp(`^[ \\t]*\\(\\s*${ayatClean}\\s*\\)`, 'm');
  const matchAyat = pasalBlock.match(ayatRegex);
  
  if (!matchAyat || matchAyat.index === undefined) {
    return pasalBlock; // fallback to full pasal block if specific ayat is not found
  }
  
  const startAyatIdx = matchAyat.index;
  
  // Find next verse boundary - again, only a clause marker at the start of
  // its own line counts, not an in-sentence reference to another ayat.
  let nextAyatIdx = pasalBlock.length;
  const nextAyatsRegex = /^[ \t]*\(\s*(\d+)\s*\)/mg;
  nextAyatsRegex.lastIndex = startAyatIdx + 1;
  
  let mAyat;
  while ((mAyat = nextAyatsRegex.exec(pasalBlock)) !== null) {
    if (mAyat.index > startAyatIdx) {
      const parsedAyatNum = mAyat[1];
      if (parseInt(parsedAyatNum) > parseInt(ayatClean)) {
        nextAyatIdx = mAyat.index;
        break;
      }
    }
  }
  
  return pasalBlock.substring(startAyatIdx, nextAyatIdx);
}

// Extract information (kode, nama, luas, terbilang, distrik) from a scoped text block
export function extractDataFromSection(textBlock: string, mapItem: MapItem): RanperdaData {
  const isPasalTotal = !!mapItem.isTotal;
  
  // 1. Luas and Terbilang
  let luasRaw = "";
  let luasAngka = 0;
  let luasTerbilang = "";
  
  // Robust pattern like "seluas kurang lebih 129.259" or "luas total kurang lebih..."
  const luasReg = /(?:seluas|luas)(?:\s+total)?[\s:±\-–—]*(?:kurang\s+lebih\s+)?([\d.,]+)/i;
  const luasMatch = textBlock.match(luasReg);
  
  if (luasMatch) {
    luasRaw = luasMatch[1];
    
    // Look for parentheses following this or in proximity for the terbilang representation
    const textAfterLuas = textBlock.substring(luasMatch.index! + luasMatch[0].length, luasMatch.index! + 300);
    const terbilangMatch = textAfterLuas.match(/^\s*\(\s*([^)]+)\s*\)/);
    if (terbilangMatch) {
      luasTerbilang = terbilangMatch[1].trim();
    } else {
      // generic search in the block
      const genericTerbilang = textBlock.match(/\(\s*([A-Za-z\s–—\-]+?)\s*\)\s*hektar/i) || textBlock.match(/\(\s*([A-Za-z\s–—\-]+?)\s*\)/);
      if (genericTerbilang) {
        luasTerbilang = genericTerbilang[1].trim();
      }
    }
    
    luasAngka = parseIndonesianNumber(luasRaw, luasTerbilang);
  }
  
  // 2. Kode & Nama (mostly to verify if the text block matches expectations)
  let kode = mapItem.kode;
  const kodeMatch = textBlock.match(/dengan\s+kode\s+([A-Z0-9-]+)\b/i);
  if (kodeMatch) {
    kode = kodeMatch[1].trim();
  }
  
  // Actually read the kawasan name as written in the Ranperda text, e.g.
  // "(4) Cagar Alam dengan kode CA ..." -> "Cagar Alam", or
  // "Kawasan Badan Air dengan kode BA ..." -> "Kawasan Badan Air".
  // This is then cross-checked against the expected name from EXCEL_MAPPING
  // so a wrong/renamed kawasan in the draft text actually gets flagged
  // instead of silently being labeled with the expected name regardless.
  let namaKawasanRaw = "";
  const namaMatch = textBlock.match(/^[ \t]*\(?\d*\)?\s*([A-Za-z][A-Za-z\s]*?)\s+dengan\s+kode\s+/mi);
  if (namaMatch) {
    namaKawasanRaw = namaMatch[1].trim();
  }
  
  const namaKawasan = mapItem.namaRanperda;
  
  return {
    pasalAyatRaw: mapItem.pasalUtama,
    pasal: mapItem.pasalUtama.split(' ayat')[0],
    ayat: mapItem.pasalUtama.includes('ayat') ? mapItem.pasalUtama.split('ayat')[1].trim() : null,
    kode,
    namaKawasan,
    namaKawasanRaw,
    luasRaw,
    luasAngka,
    luasTerbilang,
    distrikRaw: "", // populated downstream if needed
    distrikList: [], // populated downstream
    isPasalTotal
  };
}

// Robust district parser from text block
export function extractDistrictsFromText(textBlock: string, knownDistricts: string[] = []): string[] {
  const districts = new Set<string>();
  
  // Clean text lines
  const lines = textBlock.split(/\r?\n/);
  
  // 1 & 2. Match known district names against the text. Some kabupaten have
  // genuinely distinct districts where one name is a substring of another
  // (e.g. "Wamesa" and "Kuri Wamesa" are two separate, real districts here).
  // A naive word-boundary search for "Wamesa" would also match inside
  // "Kuri Wamesa" (word boundaries exist on both sides of "Wamesa" there
  // too), wrongly reporting "Wamesa" as present whenever only "Kuri Wamesa"
  // was actually written. To avoid that, we match longest names first and
  // skip any shorter match whose span is fully contained inside a match
  // that's already been recorded.
  const sortedKnown = [...knownDistricts].sort((a, b) => b.length - a.length);
  const matchedSpans: { start: number; end: number }[] = [];
  for (const kd of sortedKnown) {
    const escaped = kd.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    let m;
    while ((m = regex.exec(textBlock)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const isContained = matchedSpans.some(s => start >= s.start && end <= s.end);
      if (!isContained) {
        matchedSpans.push({ start, end });
        districts.add(toTitleCase(kd));
      }
    }
  }

  // 3. Extract literally written district names in common list formats (bullet point layout).
  // NOTE: requires an explicit "Distrik"/"Kecamatan" keyword - without it, this heuristic
  // would also match unrelated capitalized phrases such as section headers
  // ("Bagian Kedua", "Kawasan Budi Daya"), which are NOT district names.
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    
    // Matches bullet patterns like: "a. Distrik Kuri Wamesa;" or "1. Kecamatan Rasiei;"
    const pattern = /^(?:[a-z0-9][\.\-\)]\s*)?(?:distrik|kecamatan)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/i;
    const match = cleanLine.match(pattern);
    if (match) {
      let candidate = match[1].trim();
      candidate = candidate.replace(/[,;.\s]+$/, '').replace(/^[:\-–—\s]+/, '').trim();
      
      // Filter out general Indonesian stopwords that are not district names
      if (candidate && candidate.length > 2 && !/sebagaimana|dengan|seluas|hektar|dan|atau|dalam|meliputi|tersebar|berada|pasal|ayat|kabupaten/i.test(candidate)) {
        districts.add(toTitleCase(candidate));
      }
    }
  }

  // 4. Fallback inline lists parser for "berada di: ..." AND "melintas di: ..."
  // Accepts the "berada:" / "melintas:" variant (some documents drop "di").
  // "melintas di:" is the standard phrasing for Jaringan objects (roads,
  // power lines, sea lanes) and was previously not handled here, causing
  // every Jaringan item to have zero districts extracted from the ranperda.
  const locationKeywordMatch = textBlock.match(/(?:berada|melintas)\s*(?:di)?\s*:/i);
  if (locationKeywordMatch && locationKeywordMatch.index !== undefined) {
    let afterListText = textBlock.substring(locationKeywordMatch.index + locationKeywordMatch[0].length);
    // Only the current sentence is the district list - cut it off at the
    // sentence-ending period, otherwise unrelated trailing content (like the
    // next section's heading, e.g. "Bagian Kedua") gets parsed as if it
    // were part of the list.
    const sentenceEndIdx = afterListText.indexOf('.');
    if (sentenceEndIdx !== -1) {
      afterListText = afterListText.substring(0, sentenceEndIdx);
    }
    const parts = afterListText.split(/[,;:\r\n]|\bdan\b/);
    for (let part of parts) {
      part = part.trim();
      // Strip leading punctuation/bullets FIRST (e.g. the ":" right after
      // "berada di:") - this must happen before checking for the
      // "distrik "/"kecamatan " prefix below, otherwise a leading ":" hides
      // the prefix and it never gets stripped, leaving "Distrik X" as a
      // stray duplicate of the already-captured "X".
      part = part.replace(/^[a-z0-9][\.\-\)]\s*/i, '').trim();
      part = part.replace(/^[:\-–—\s]+/, '').trim();
      if (part.toLowerCase().startsWith('distrik ')) {
        part = part.substring(8).trim();
      } else if (part.toLowerCase().startsWith('kecamatan ')) {
        part = part.substring(10).trim();
      }
      part = part.replace(/[,;.\s]+$/, '').replace(/^[:\-–—\s]+/, '').trim();
      
      if (part && part.length > 2 && !/sebagaimana|dengan|seluas|hektar|dalam|berada|berupa|meliputi|terdiri|untuk|pada|pasal|ayat/i.test(part)) {
        districts.add(toTitleCase(part));
      }
    }
  }

  return Array.from(districts);
}

// Compute the standard rounded value
export function getRoundedValue(val: number): number {
  return Math.round(val);
}

// Comparison Core Logic
export function analyzeConsistency(
  ranperdaText: string, 
  pivotData: Record<string, PivotItem>
): { results: ConsistencyResult[]; stats: SummaryStats; kabupaten: string } {
  const kabupaten = extractKabupatenName(ranperdaText);
  const results: (ConsistencyResult & { _orderIndex: number })[] = [];

  // Restrict to the BAB that actually covers Pola Ruang, so other chapters
  // (Ketentuan Umum, Struktur Ruang, Kawasan Strategis, dst) can't leak
  // unrelated figures into the check (see extractPolaRuangSection docs).
  const scopedText = extractPolaRuangSection(ranperdaText);

  // Collect all known districts from pivot to feed the regex extractor
  const allKnownDistricts = new Set<string>();
  Object.values(pivotData).forEach(item => {
    item.districts.forEach(d => allKnownDistricts.add(normalizeDistrict(d)));
  });
  const allKnownDistrictsList = Array.from(allKnownDistricts).map(d => toTitleCase(d));

  // Dynamically discover every "<Nama> dengan kode <KODE> ... seluas ..."
  // clause actually present in the text. This - together with the Pivot's
  // own NAMOBJ list - is now the source of truth, instead of a fixed
  // pasal-number table, so the checker isn't tied to one kabupaten's
  // specific Ranperda structure.
  const discovered = discoverKawasanFromText(scopedText);
  const discoveredNames = discovered.map(d => d.nama);
  const pivotKeys = Object.keys(pivotData);
  const excelMappingNames = EXCEL_MAPPING.map(m => m.namobj);

  // Optional cosmetic hint: if a category happens to match one of the
  // categories we already know nice Indonesian labels for, use that label.
  // Purely decorative - never required for the comparison itself.
  const lookupHint = (name: string): MapItem | null => {
    const idx = fuzzyMatchNameIndex(name, excelMappingNames);
    return idx !== -1 ? EXCEL_MAPPING[idx] : null;
  };

  // Pre-pass: match every discovered clause to a pivot entry (regardless of
  // whether it's an aggregate/"total" clause), so we can build a kode ->
  // pivot-namobj registry. This is what lets aggregate clauses ("Kawasan
  // Hutan Produksi ... terdiri dari: a. HPT; b. HP; c. HPK.") sum up their
  // children's pivot values dynamically, without a hardcoded child list.
  const kodeToNamobj = new Map<string, string>();
  const discToNamobj = new Map<number, string>();
  const kodeIsTotal = new Map<string, boolean>();
  discovered.forEach((disc, idx) => {
    kodeIsTotal.set(disc.kode.toUpperCase(), disc.isTotal);
    const pivotIdx = fuzzyMatchNameIndex(disc.nama, pivotKeys);
    if (pivotIdx !== -1) {
      const namobj = pivotKeys[pivotIdx];
      kodeToNamobj.set(disc.kode.toUpperCase(), namobj);
      discToNamobj.set(idx, namobj);
    }
  });

  // Some umbrella/alias kode's are mentioned with child kode's but never
  // carry their own luas (e.g. "(3) Kawasan Pelestarian Alam dengan kode
  // KPA ... berupa Taman Nasional dengan kode TN." - KPA's real area lives
  // entirely under TN). These never show up in `discovered` at all, but we
  // still need their kode->children links to resolve multi-level nesting.
  const kodeAliasMap = buildKodeAliasMap(scopedText);

  // Recursively resolve a kode down to pivot leaf values - handles
  // multi-level nesting (a "total" whose children are themselves further
  // broken down into their own children) by walking the alias map / child
  // kode mentions until reaching kode's that have a genuine, non-aggregate
  // Pivot match.
  function resolveKodeLeaves(kode: string, visited: Set<string>): { sumReal: number; sumRounded: number; labels: string[] } {
    const upper = kode.toUpperCase();
    if (visited.has(upper)) return { sumReal: 0, sumRounded: 0, labels: [] };

    const namobj = kodeToNamobj.get(upper);
    const isAggregate = kodeIsTotal.get(upper) === true;

    let sumReal = 0;
    let sumRounded = 0;
    const labels: string[] = [];

    // Always count this kode's own direct pivot value, if it has one and
    // isn't itself flagged as an aggregate-only umbrella.
    if (namobj && !isAggregate && pivotData[namobj]) {
      sumReal += pivotData[namobj].totalLuas;
      sumRounded += Math.round(pivotData[namobj].totalLuas);
      labels.push(upper);
    }

    // ALSO expand any declared children (umbrella/alias breakdown) - some
    // documents sloppily reuse the same kode both as a leaf and as one of
    // its own breakdown items (e.g. "Suaka Alam (KSA) meliputi: a. Cagar
    // Alam; b. Suaka Alam (KSA) again"), so a self-reference among the
    // children is excluded here rather than blocking the whole branch.
    const children = (kodeAliasMap.get(upper) || []).filter(c => c.toUpperCase() !== upper);
    const newVisited = new Set(visited);
    newVisited.add(upper);
    for (const child of children) {
      const r = resolveKodeLeaves(child, newVisited);
      sumReal += r.sumReal;
      sumRounded += r.sumRounded;
      labels.push(...r.labels);
    }
    return { sumReal, sumRounded, labels };
  }

  const matchedDiscoveredIdx = new Set<number>();
  const matchedPivotKeys = new Set<string>();

  // --- Pass A: aggregate ("total") clauses - e.g. "Kawasan Hutan Produksi
  // ... terdiri dari: a. HPT; b. HP; c. HPK." These almost never have their
  // own single row in the Pivot Excel (only their children do), so they're
  // processed unconditionally here via sum-of-children, rather than relying
  // on finding a matching Pivot NAMOBJ first.
  discovered.forEach((disc, idx) => {
    if (!disc.isTotal) return;
    matchedDiscoveredIdx.add(idx);

    const cleanFn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    const exactSelfPivot = pivotKeys.find(k => cleanFn(k) === cleanFn(disc.nama));
    if (exactSelfPivot) matchedPivotKeys.add(exactSelfPivot);

    const hint = lookupHint(disc.nama);
    const pseudoItem: MapItem = {
      namobj: disc.nama,
      kode: hint?.kode || disc.kode,
      namaRanperda: hint?.namaRanperda || disc.nama,
      pasalUtama: disc.pasalAyatLabel,
      isTotal: true
    };
    const extracted = extractDataFromSection(disc.textBlock, pseudoItem);
    const ranperdaLuas = extracted.luasAngka;

    const directChildKodes = Array.from(disc.textBlock.matchAll(/dengan\s+kode\s+([A-Z0-9\-]+)\b/gi))
      .map(m => m[1].toUpperCase())
      .filter(k => k !== disc.kode.toUpperCase());
    const uniqueChildKodes = Array.from(new Set(directChildKodes));

    let sumReal = 0;
    let sumRounded = 0;
    const childLabels: string[] = [];
    const visited = new Set<string>([disc.kode.toUpperCase()]);
    for (const childKode of uniqueChildKodes) {
      const resolved = resolveKodeLeaves(childKode, visited);
      sumReal += resolved.sumReal;
      sumRounded += resolved.sumRounded;
      childLabels.push(...resolved.labels);
    }

    let luasStatus: 'SESUAI' | 'TIDAK_SESUAI' | 'PERLU_DICEK' | 'INFO' = 'INFO';
    let luasCatatan = '';
    if (uniqueChildKodes.length === 0) {
      luasStatus = 'PERLU_DICEK';
      luasCatatan = 'Tidak ditemukan rincian sub-kawasan (kode anak) di dalam klausul ini.';
    } else if (childLabels.length === 0) {
      luasStatus = 'PERLU_DICEK';
      luasCatatan = `Sub-kawasan (${uniqueChildKodes.join(', ')}) yang disebut di klausul ini tidak ditemukan padanannya di Pivot Excel.`;
    } else if (ranperdaLuas != null) {
      const selisih = ranperdaLuas - sumRounded;
      if (selisih === 0) {
        luasStatus = 'SESUAI';
        luasCatatan = `Penjumlahan sub-kawasan sesuai: ${ranperdaLuas} ha.`;
      } else {
        luasStatus = 'TIDAK_SESUAI';
        luasCatatan = `Selisih penjumlahan ${selisih} ha. Ranperda: ${ranperdaLuas} ha. Penjumlahan pivot: ${sumRounded} ha.`;
      }
    } else {
      luasCatatan = 'Pasal total, nilai luas di draf Ranperda tidak terbaca.';
    }

    results.push({
      pasalAyat: disc.pasalAyatLabel,
      kode: hint?.kode || disc.kode,
      namaKawasan: hint?.namaRanperda || disc.nama,
      ranperdaLuas,
      pivotLuasReal: childLabels.length > 0 ? sumReal : null,
      pivotLuasRounded: childLabels.length > 0 ? sumRounded : null,
      luasStatus,
      luasCatatan,
      ranperdaDistrik: [],
      pivotDistrik: [],
      distrikStatus: 'INFO',
      distrikCatatan: [childLabels.length > 0 ? `Pasal total, sebaran distrik dirinci di kawasan: ${childLabels.join(', ')}.` : 'Pasal total, sub-kawasan turunan tidak ditemukan padanannya.'],
      keterangan: '',
      isPasalTotal: true,
      _orderIndex: disc.orderIndex
    });
  });

  // --- Pass B: walk the Pivot Excel (what SHOULD exist) for everything not
  // already claimed by an aggregate clause, and try to find a matching
  // (non-total) clause in the Ranperda.
  for (const namobj of pivotKeys) {
    if (matchedPivotKeys.has(namobj)) continue;
    const pivotItem = pivotData[namobj];
    const hint = lookupHint(namobj);

    const eligibleIndices = discovered
      .map((_, i) => i)
      .filter(i => !matchedDiscoveredIdx.has(i) && !discovered[i].isTotal);
    const eligibleNames = eligibleIndices.map(i => discoveredNames[i]);
    const matchPos = fuzzyMatchNameIndex(namobj, eligibleNames);
    let discIdx = matchPos !== -1 ? eligibleIndices[matchPos] : -1;

    if (discIdx === -1) {
      // Fallback: this category might be mentioned inside a clause titled
      // after a different/broader term rather than being its own subject
      // (e.g. "...berupa kawasan hutan lindung (HL)..." written inside a
      // clause titled after an umbrella term). Search clause bodies
      // directly rather than just their captured name.
      const cleanNamobj = namobj.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      if (cleanNamobj.length >= 6) {
        for (let i = 0; i < discovered.length; i++) {
          if (matchedDiscoveredIdx.has(i) || discovered[i].isTotal) continue;
          const cleanBlock = discovered[i].textBlock.toLowerCase().replace(/[^a-z0-9\s]/g, '');
          if (cleanBlock.includes(cleanNamobj)) {
            discIdx = i;
            break;
          }
        }
      }
    }

    if (discIdx === -1) {
      // Genuinely absent from the draft text - surface this explicitly
      // instead of silently dropping it.
      results.push({
        pasalAyat: '-',
        kode: hint?.kode || '-',
        namaKawasan: hint?.namaRanperda || namobj,
        ranperdaLuas: null,
        pivotLuasReal: pivotItem.totalLuas,
        pivotLuasRounded: getRoundedValue(pivotItem.totalLuas),
        luasStatus: 'PERLU_DICEK',
        luasCatatan: `⚠ TIDAK DITEMUKAN DI RANPERDA - kawasan "${namobj}" ada di Pivot Excel (±${getRoundedValue(pivotItem.totalLuas)} ha) tapi tidak ditemukan klausulnya di draf Ranperda.`,
        ranperdaDistrik: [],
        pivotDistrik: pivotItem.districts.map(d => toTitleCase(d)),
        distrikStatus: 'INFO',
        distrikCatatan: ['Draf Ranperda tidak memuat kawasan ini sama sekali.'],
        keterangan: '',
        isPasalTotal: false,
        _orderIndex: Infinity
      });
      continue;
    }

    matchedDiscoveredIdx.add(discIdx);
    matchedPivotKeys.add(namobj);
    const disc = discovered[discIdx];

    const pseudoItem: MapItem = {
      namobj,
      kode: hint?.kode || disc.kode,
      namaRanperda: hint?.namaRanperda || disc.nama,
      pasalUtama: disc.pasalAyatLabel,
      isTotal: false
    };

    const extracted = extractDataFromSection(disc.textBlock, pseudoItem);
    const ranperdaLuas = extracted.luasAngka;
    const ranperdaDistrik = extractDistrictsFromText(disc.textBlock, allKnownDistrictsList);

    const pivotLuasReal: number | null = pivotItem.totalLuas;
    const pivotLuasRounded: number | null = getRoundedValue(pivotItem.totalLuas);
    const pivotDistrik: string[] = pivotItem.districts.map(d => toTitleCase(d));

    let luasStatus: 'SESUAI' | 'TIDAK_SESUAI' | 'PERLU_DICEK' | 'INFO' = 'PERLU_DICEK';
    let luasCatatan = "";
    let distrikStatus: 'SESUAI' | 'TIDAK_SESUAI' | 'INFO' = 'SESUAI';
    const distrikCatatan: string[] = [];
    let keterangan = "";

    // Cross-check the kawasan name actually written in the Ranperda text
    // against the Pivot's NAMOBJ for this entry (fuzzy match, so minor
    // wording differences aren't flagged as errors).
    if (extracted.namaKawasanRaw) {
      const cleanFn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isMatch = cleanFn(extracted.namaKawasanRaw).includes(cleanFn(namobj))
        || cleanFn(namobj).includes(cleanFn(extracted.namaKawasanRaw))
        || (hint && (cleanFn(extracted.namaKawasanRaw).includes(cleanFn(hint.namaRanperda)) || cleanFn(hint.namaRanperda).includes(cleanFn(extracted.namaKawasanRaw))));
      if (!isMatch) {
        keterangan = `Nama kawasan di draf berbeda: tertulis "${extracted.namaKawasanRaw}", seharusnya "${namobj}".`;
      }
    }

    if (ranperdaLuas == null || pivotLuasRounded == null || isNaN(ranperdaLuas)) {
      luasStatus = 'PERLU_DICEK';
      luasCatatan = isNaN(ranperdaLuas || 0) || ranperdaLuas == null
        ? `Nilai luas draf tidak valid atau tidak terbaca (${extracted.luasRaw || "Format kosong"}).`
        : `Kategori '${namobj}' tidak ditemukan dalam pivot Excel.`;
    } else {
      const selisih = ranperdaLuas - pivotLuasRounded;
      if (selisih === 0) {
        luasStatus = 'SESUAI';
        const formatReal = pivotLuasReal ? pivotLuasReal.toLocaleString('id-ID', { maximumFractionDigits: 3 }) : '0';
        luasCatatan = `Pivot: ${formatReal} ha → ${pivotLuasRounded} ha.`;

        const correctTerbilang = terbilang(ranperdaLuas);
        if (extracted.luasTerbilang) {
          const cleanText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanText(extracted.luasTerbilang) !== cleanText(correctTerbilang)) {
            const terbilangNote = `Terbilang salah di Ranperda: tertulis "${extracted.luasTerbilang}" seharusnya "${correctTerbilang}"`;
            keterangan = keterangan ? `${keterangan} ${terbilangNote}` : terbilangNote;
          }
        }
      } else {
        luasStatus = 'TIDAK_SESUAI';
        const direction = selisih > 0 ? "pembulatan ke bawah" : "pembulatan ke atas";
        const formatReal = pivotLuasReal ? pivotLuasReal.toLocaleString('id-ID', { maximumFractionDigits: 3 }) : '0';
        luasCatatan = `Selisih ${selisih} ha (${direction}). Pivot: ${formatReal} ha → ${pivotLuasRounded} ha.`;
      }
    }

    const ranperdaSet = new Set(ranperdaDistrik.map(d => normalizeDistrict(d)));
    const pivotSet = new Set(pivotDistrik.map(d => normalizeDistrict(d)));
    const hanyaDiPivot = pivotDistrik.filter(d => !ranperdaSet.has(normalizeDistrict(d)));
    const hanyaDiRanperda = ranperdaDistrik.filter(d => !pivotSet.has(normalizeDistrict(d)));

    if (hanyaDiPivot.length === 0 && hanyaDiRanperda.length === 0) {
      distrikStatus = 'SESUAI';
    } else {
      distrikStatus = 'TIDAK_SESUAI';
      if (hanyaDiPivot.length > 0) {
        distrikCatatan.push(`Distrik [${hanyaDiPivot.join(', ')}] ada di pivot tapi tidak di Ranperda`);
      }
      if (hanyaDiRanperda.length > 0) {
        distrikCatatan.push(`Distrik [${hanyaDiRanperda.join(', ')}] ada di Ranperda tapi tidak di pivot`);
      }
    }

    results.push({
      pasalAyat: disc.pasalAyatLabel,
      kode: hint?.kode || disc.kode,
      namaKawasan: hint?.namaRanperda || namobj,
      ranperdaLuas,
      pivotLuasReal,
      pivotLuasRounded,
      luasStatus,
      luasCatatan,
      ranperdaDistrik,
      pivotDistrik,
      distrikStatus,
      distrikCatatan,
      keterangan,
      isPasalTotal: false,
      _orderIndex: disc.orderIndex
    });
  }

  // --- Pass C: discovered clauses that found NO matching Pivot entry at
  // all. These are genuinely "ada di Ranperda tapi tidak ada di Pivot" -
  // they used to disappear silently; now they're surfaced explicitly.
  discovered.forEach((disc, idx) => {
    if (matchedDiscoveredIdx.has(idx)) return;
    const hint = lookupHint(disc.nama);
    const extracted = extractDataFromSection(disc.textBlock, {
      namobj: disc.nama,
      kode: hint?.kode || disc.kode,
      namaRanperda: hint?.namaRanperda || disc.nama,
      pasalUtama: disc.pasalAyatLabel,
      isTotal: disc.isTotal
    });

    results.push({
      pasalAyat: disc.pasalAyatLabel,
      kode: hint?.kode || disc.kode,
      namaKawasan: hint?.namaRanperda || disc.nama,
      ranperdaLuas: extracted.luasAngka,
      pivotLuasReal: null,
      pivotLuasRounded: null,
      luasStatus: 'PERLU_DICEK',
      luasCatatan: `⚠ Kawasan "${disc.nama}" (kode ${disc.kode}) ada di draf Ranperda (${disc.pasalAyatLabel}) tapi TIDAK ADA padanannya di Pivot Excel.`,
      ranperdaDistrik: disc.isTotal ? [] : extractDistrictsFromText(disc.textBlock, allKnownDistrictsList),
      pivotDistrik: [],
      distrikStatus: 'INFO',
      distrikCatatan: ['Tidak ada data pivot untuk dibandingkan.'],
      keterangan: '',
      isPasalTotal: disc.isTotal,
      _orderIndex: disc.orderIndex
    });
  });

  // Restore document order - the matching passes above (aggregate-first,
  // then walking the Pivot, then leftover Ranperda clauses) don't run in
  // document order, so without this the result list would come out
  // scrambled instead of following the Ranperda's actual structure (Bagian
  // Kesatu/Kawasan Lindung before Bagian Kedua/Kawasan Budi Daya, Pasal
  // numbers ascending). Entries with no real position in the document
  // (genuinely missing from the Ranperda) sort to the end.
  results.sort((a, b) => a._orderIndex - b._orderIndex);
  const orderedResults: ConsistencyResult[] = results.map(({ _orderIndex, ...r }) => r);

  // Calculate stats summary
  let luasSesuai = 0, luasTidakSesuai = 0, luasPerluDicek = 0, luasInfo = 0;
  let distrikSesuai = 0, distrikTidakSesuai = 0, distrikInfo = 0;
  
  orderedResults.forEach(r => {
    // Luas Stats
    if (r.luasStatus === 'SESUAI') luasSesuai++;
    else if (r.luasStatus === 'TIDAK_SESUAI') luasTidakSesuai++;
    else if (r.luasStatus === 'PERLU_DICEK') luasPerluDicek++;
    else if (r.luasStatus === 'INFO') luasInfo++;
    
    // Distrik Stats
    if (r.distrikStatus === 'SESUAI') distrikSesuai++;
    else if (r.distrikStatus === 'TIDAK_SESUAI') distrikTidakSesuai++;
    else if (r.distrikStatus === 'INFO') distrikInfo++;
  });
  
  const stats: SummaryStats = {
    luasSesuai,
    luasTidakSesuai,
    luasPerluDicek,
    luasInfo,
    distrikSesuai,
    distrikTidakSesuai,
    distrikInfo
  };
  
  return { results: orderedResults, stats, kabupaten };
}

/**
 * Restricts the document text to the "BAB ... STRUKTUR RUANG" section to prevent
 * leaking content from other sections or chapters.
 */
export function extractStrukturRuangSection(text: string): string {
  const babMatches = Array.from(text.matchAll(/\bBAB\s+([IVXLCDM]+|\d+)\b/gi));
  if (babMatches.length === 0) return text;

  for (let i = 0; i < babMatches.length; i++) {
    const m = babMatches[i];
    const idx = m.index ?? -1;
    if (idx === -1) continue;
    const headingArea = text.substring(idx, idx + 200).toUpperCase();
    if (headingArea.includes('STRUKTUR RUANG')) {
      const endIdx = i + 1 < babMatches.length ? (babMatches[i + 1].index ?? text.length) : text.length;
      return text.substring(idx, endIdx);
    }
  }
  return text;
}

/**
 * Classifies a paragraph into 'Infrastruktur' or 'Jaringan' by identifying phrasing markers.
 */
function getParagraphType(text: string): 'Infrastruktur' | 'Jaringan' | null {
  const isInfra = /berada\s*(?:di)?\s*:/i.test(text) || /berada\s+di\b/i.test(text) || text.toLowerCase().includes('berada di');
  const isJar = /melintas\s*(?:di)?\s*:/i.test(text) || /melintas\s+di\b/i.test(text) || text.toLowerCase().includes('melintas di');
  if (isInfra && !isJar) return 'Infrastruktur';
  if (isJar && !isInfra) return 'Jaringan';
  return null;
}

function cleanStringForLookup(s: string): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-0A-Z]/g, '').trim();
}

export interface MasterRefEntry {
  jenisName: string;
  jenisKd: string;
  orde1Name: string;
  orde1Kd: string;
  orde2Name: string;
  orde2Kd: string;
  orde3Name: string;
  orde3Kd: string;
  orde4Name: string;
  orde4Kd: string;
}

export const STRUCTURE_MASTER_REFS: MasterRefEntry[] = [
  // Sistem Pusat Permukiman
  {
    jenisName: "Sistem Pusat Permukiman", jenisKd: "11000000",
    orde1Name: "Pusat Pelayanan Lingkungan", orde1Kd: "11024000",
    orde2Name: "Pusat Pelayanan Lingkungan", orde2Kd: "11024000",
    orde3Name: "Pusat Pelayanan Lingkungan", orde3Kd: "11024000",
    orde4Name: "Pusat Pelayanan Lingkungan", orde4Kd: "11024000"
  },
  {
    jenisName: "Sistem Pusat Permukiman", jenisKd: "11000000",
    orde1Name: "Pusat Pelayanan Kawasan", orde1Kd: "11021000",
    orde2Name: "Pusat Pelayanan Kawasan", orde2Kd: "11021000",
    orde3Name: "Pusat Pelayanan Kawasan", orde3Kd: "11021000",
    orde4Name: "Pusat Pelayanan Kawasan", orde4Kd: "11021000"
  },
  {
    jenisName: "Sistem Pusat Permukiman", jenisKd: "11000000",
    orde1Name: "Pusat Kegiatan Lokal (PKL)", orde1Kd: "11014000",
    orde2Name: "Pusat Kegiatan Lokal (PKL)", orde2Kd: "11014000",
    orde3Name: "Pusat Kegiatan Lokal (PKL)", orde3Kd: "11014000",
    orde4Name: "Pusat Kegiatan Lokal (PKL)", orde4Kd: "11014000"
  },
  {
    jenisName: "Sistem Pusat Permukiman", jenisKd: "11000000",
    orde1Name: "Pusat Kegiatan Wilayah (PKW)", orde1Kd: "11012000",
    orde2Name: "Pusat Kegiatan Wilayah (PKW)", orde2Kd: "11012000",
    orde3Name: "Pusat Kegiatan Wilayah (PKW)", orde3Kd: "11012000",
    orde4Name: "Pusat Kegiatan Wilayah (PKW)", orde4Kd: "11012000"
  },
  {
    jenisName: "Sistem Pusat Permukiman", jenisKd: "11000000",
    orde1Name: "Pusat Kegiatan Nasional (PKN)", orde1Kd: "11011000",
    orde2Name: "Pusat Kegiatan Nasional (PKN)", orde2Kd: "11011000",
    orde3Name: "Pusat Kegiatan Nasional (PKN)", orde3Kd: "11011000",
    orde4Name: "Pusat Kegiatan Nasional (PKN)", orde4Kd: "11011000"
  },
  {
    jenisName: "Sistem Pusat Permukiman", jenisKd: "11000000",
    orde1Name: "Pusat Kegiatan Strategis Nasional (PKSN)", orde1Kd: "11013000",
    orde2Name: "Pusat Kegiatan Strategis Nasional (PKSN)", orde2Kd: "11013000",
    orde3Name: "Pusat Kegiatan Strategis Nasional (PKSN)", orde3Kd: "11013000",
    orde4Name: "Pusat Kegiatan Strategis Nasional (PKSN)", orde4Kd: "11013000"
  },
  // Sistem Jaringan Transportasi
  // Sungai, Danau, Penyeberangan
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Alur-Pelayaran Sungai dan Alur-Pelayaran Danau", orde2Kd: "22031000",
    orde3Name: "Alur-Pelayaran Kelas I", orde3Kd: "22031100",
    orde4Name: "Alur-Pelayaran Kelas I", orde4Kd: "22031100"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Alur-Pelayaran Sungai dan Alur-Pelayaran Danau", orde2Kd: "22031000",
    orde3Name: "Alur-Pelayaran Kelas II", orde3Kd: "22031200",
    orde4Name: "Alur-Pelayaran Kelas II", orde4Kd: "22031200"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Alur-Pelayaran Sungai dan Alur-Pelayaran Danau", orde2Kd: "22031000",
    orde3Name: "Alur-Pelayaran Kelas III", orde3Kd: "22031300",
    orde4Name: "Alur-Pelayaran Kelas III", orde4Kd: "22031300"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Pelabuhan Sungai dan Danau", orde2Kd: "12031000",
    orde3Name: "Pelabuhan Sungai dan Danau Utama", orde3Kd: "12031400",
    orde4Name: "Pelabuhan Sungai dan Danau Utama", orde4Kd: "12031400"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Pelabuhan Sungai dan Danau", orde2Kd: "12031000",
    orde3Name: "Pelabuhan Sungai dan Danau Pengumpul", orde3Kd: "12031500",
    orde4Name: "Pelabuhan Sungai dan Danau Pengumpul", orde4Kd: "12031500"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Pelabuhan Sungai dan Danau", orde2Kd: "12031000",
    orde3Name: "Pelabuhan Sungai dan Danau Pengumpan", orde3Kd: "12031600",
    orde4Name: "Pelabuhan Sungai dan Danau Pengumpan", orde4Kd: "12031600"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Pelabuhan Penyeberangan", orde2Kd: "12032000",
    orde3Name: "Pelabuhan Penyeberangan Kelas I", orde3Kd: "12032500",
    orde4Name: "Pelabuhan Penyeberangan Kelas I", orde4Kd: "12032500"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Pelabuhan Penyeberangan", orde2Kd: "12032000",
    orde3Name: "Pelabuhan Penyeberangan Kelas II", orde3Kd: "12032600",
    orde4Name: "Pelabuhan Penyeberangan Kelas II", orde4Kd: "12032600"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Pelabuhan Penyeberangan", orde2Kd: "12032000",
    orde3Name: "Pelabuhan Penyeberangan Kelas III", orde3Kd: "12032700",
    orde4Name: "Pelabuhan Penyeberangan Kelas III", orde4Kd: "12032700"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Lintas Penyeberangan Antarkabupaten/Kota dalam Provinsi", orde2Kd: "22032300",
    orde3Name: "Lintas Penyeberangan Antarkabupaten/Kota dalam Provinsi", orde3Kd: "22032300",
    orde4Name: "Lintas Penyeberangan Antarkabupaten/Kota dalam Provinsi", orde4Kd: "22032300"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Lintas Penyeberangan Antarnegara", orde2Kd: "22032100",
    orde3Name: "Lintas Penyeberangan Antarnegara", orde3Kd: "22032100",
    orde4Name: "Lintas Penyeberangan Antarnegara", orde4Kd: "22032100"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Lintas Penyeberangan Antarprovinsi", orde2Kd: "22032200",
    orde3Name: "Lintas Penyeberangan Antarprovinsi", orde3Kd: "22032200",
    orde4Name: "Lintas Penyeberangan Antarprovinsi", orde4Kd: "22032200"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Sungai, Danau, dan Penyeberangan", orde1Kd: "42030000",
    orde2Name: "Lintas Penyeberangan dalam Kabupaten", orde2Kd: "22032401",
    orde3Name: "Lintas Penyeberangan dalam Kabupaten", orde3Kd: "22032401",
    orde4Name: "Lintas Penyeberangan dalam Kabupaten", orde4Kd: "22032401"
  },
  // Bandar Udara
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Bandar Udara Umum dan Bandar Udara Khusus", orde1Kd: "42050000",
    orde2Name: "Bandar Udara Khusus", orde2Kd: "12053000",
    orde3Name: "Bandar Udara Khusus", orde3Kd: "12053000",
    orde4Name: "Bandar Udara Khusus", orde4Kd: "12053000"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Bandar Udara Umum dan Bandar Udara Khusus", orde1Kd: "42050000",
    orde2Name: "Bandar Udara Pengumpul", orde2Kd: "12051000",
    orde3Name: "Bandar Udara Pengumpul Skala Pelayanan Primer", orde3Kd: "12051100",
    orde4Name: "Bandar Udara Pengumpul Skala Pelayanan Primer", orde4Kd: "12051100"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Bandar Udara Umum dan Bandar Udara Khusus", orde1Kd: "42050000",
    orde2Name: "Bandar Udara Pengumpul", orde2Kd: "12051000",
    orde3Name: "Bandar Udara Pengumpul Skala Pelayanan Sekunder", orde3Kd: "12051200",
    orde4Name: "Bandar Udara Pengumpul Skala Pelayanan Sekunder", orde4Kd: "12051200"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Bandar Udara Umum dan Bandar Udara Khusus", orde1Kd: "42050000",
    orde2Name: "Bandar Udara Pengumpul", orde2Kd: "12051000",
    orde3Name: "Bandar Udara Pengumpul Skala Pelayanan Tersier", orde3Kd: "12051300",
    orde4Name: "Bandar Udara Pengumpul Skala Pelayanan Tersier", orde4Kd: "12051300"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Bandar Udara Umum dan Bandar Udara Khusus", orde1Kd: "42050000",
    orde2Name: "Bandar Udara Pengumpan", orde2Kd: "12052000",
    orde3Name: "Bandar Udara Pengumpan", orde3Kd: "12052000",
    orde4Name: "Bandar Udara Pengumpan", orde4Kd: "12052000"
  },
  // Jalan
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Umum", orde2Kd: "22011000",
    orde3Name: "Jalan Arteri", orde3Kd: "22011100",
    orde4Name: "Jalan Arteri Primer", orde4Kd: "22011101"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Umum", orde2Kd: "22011000",
    orde3Name: "Jalan Arteri", orde3Kd: "22011100",
    orde4Name: "Jalan Arteri Sekunder", orde4Kd: "22011102"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Umum", orde2Kd: "22011000",
    orde3Name: "Jalan Kolektor", orde3Kd: "22011200",
    orde4Name: "Jalan Kolektor Primer", orde4Kd: "22011201"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Umum", orde2Kd: "22011000",
    orde3Name: "Jalan Kolektor", orde3Kd: "22011200",
    orde4Name: "Jalan Kolektor Sekunder", orde4Kd: "22011202"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Umum", orde2Kd: "22011000",
    orde3Name: "Jalan Lokal", orde3Kd: "22011300",
    orde4Name: "Jalan Lokal Primer", orde4Kd: "22011301"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Umum", orde2Kd: "22011000",
    orde3Name: "Jalan Lokal", orde3Kd: "22011300",
    orde4Name: "Jalan Lokal Sekunder", orde4Kd: "22011302"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Umum", orde2Kd: "22011000",
    orde3Name: "Jalan Lingkungan", orde3Kd: "22011400",
    orde4Name: "Jalan Lingkungan Primer", orde4Kd: "22011401"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Umum", orde2Kd: "22011000",
    orde3Name: "Jalan Lingkungan", orde3Kd: "22011400",
    orde4Name: "Jalan Lingkungan Sekunder", orde4Kd: "22011402"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jalan Tol", orde2Kd: "22013000",
    orde3Name: "Jalan Tol", orde3Kd: "22013000",
    orde4Name: "Jalan Tol", orde4Kd: "22013000"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Jembatan Timbang", orde2Kd: "12015000",
    orde3Name: "Jembatan Timbang", orde3Kd: "12015000",
    orde4Name: "Jembatan Timbang", orde4Kd: "12015000"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Terminal Penumpang", orde2Kd: "12016000",
    orde3Name: "Terminal Penumpang Tipe A", orde3Kd: "12016100",
    orde4Name: "Terminal Penumpang Tipe A", orde4Kd: "12016100"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Terminal Penumpang", orde2Kd: "12016000",
    orde3Name: "Terminal Penumpang Tipe B", orde3Kd: "12016200",
    orde4Name: "Terminal Penumpang Tipe B", orde4Kd: "12016200"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Terminal Penumpang", orde2Kd: "12016000",
    orde3Name: "Terminal Penumpang Tipe C", orde3Kd: "12016300",
    orde4Name: "Terminal Penumpang Tipe C", orde4Kd: "12016300"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Jalan", orde1Kd: "42010000",
    orde2Name: "Terminal Barang", orde2Kd: "12017000",
    orde3Name: "Terminal Barang", orde3Kd: "12017000",
    orde4Name: "Terminal Barang", orde4Kd: "12017000"
  },
  // Jaringan Kereta Api
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Kereta Api", orde1Kd: "42020000",
    orde2Name: "Jaringan Jalur Kereta Api", orde2Kd: "22020000",
    orde3Name: "Jaringan Jalur Kereta Api Umum", orde3Kd: "22021000",
    orde4Name: "Jaringan Jalur Kereta Api Antarkota", orde4Kd: "22021100"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Kereta Api", orde1Kd: "42020000",
    orde2Name: "Jaringan Jalur Kereta Api", orde2Kd: "22020000",
    orde3Name: "Jaringan Jalur Kereta Api Umum", orde3Kd: "22021000",
    orde4Name: "Jaringan Jalur Kereta Api Perkotaan", orde4Kd: "22021200"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Kereta Api", orde1Kd: "42020000",
    orde2Name: "Jaringan Jalur Kereta Api", orde2Kd: "22020000",
    orde3Name: "Jaringan Jalur Kereta Api Khusus", orde3Kd: "22022000",
    orde4Name: "Jaringan Jalur Kereta Api Khusus", orde4Kd: "22022000"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Kereta Api", orde1Kd: "42020000",
    orde2Name: "Stasiun Kereta Api", orde2Kd: "12020000",
    orde3Name: "Stasiun Penumpang", orde3Kd: "12023000",
    orde4Name: "Stasiun Penumpang", orde4Kd: "12023000"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42000000",
    orde1Name: "Sistem Jaringan Kereta Api", orde1Kd: "42020000",
    orde2Name: "Stasiun Kereta Api", orde2Kd: "12020000",
    orde3Name: "Stasiun Barang", orde3Kd: "12024000",
    orde4Name: "Stasiun Barang", orde4Kd: "12024000"
  },
  // Pelabuhan Laut
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Pelabuhan Utama", orde3Kd: "12041400",
    orde4Name: "Pelabuhan Utama", orde4Kd: "12041400"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Pelabuhan Pengumpul", orde3Kd: "12041500",
    orde4Name: "Pelabuhan Pengumpul", orde4Kd: "12041500"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Pelabuhan Pengumpan Regional", orde3Kd: "12041601",
    orde4Name: "Pelabuhan Pengumpan Regional", orde4Kd: "12041601"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Pelabuhan Pengumpan Lokal", orde3Kd: "12041700",
    orde4Name: "Pelabuhan Pengumpan Lokal", orde4Kd: "12041700"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Terminal Penumpang", orde3Kd: "12041700",
    orde4Name: "Terminal Umum", orde4Kd: "12041700"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Terminal Khusus", orde3Kd: "12041800",
    orde4Name: "Terminal Khusus", orde4Kd: "12041800"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Pelabuhan Perikanan Samudera", orde3Kd: "12041901",
    orde4Name: "Pelabuhan Perikanan Samudera", orde4Kd: "12041901"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Pelabuhan Perikanan Nusantara", orde3Kd: "12041902",
    orde4Name: "Pelabuhan Perikanan Nusantara", orde4Kd: "12041902"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Pelabuhan Perikanan Pantai", orde3Kd: "12041903",
    orde4Name: "Pelabuhan Perikanan Pantai", orde4Kd: "12041903"
  },
  {
    jenisName: "Sistem Jaringan Transportasi", jenisKd: "42040000",
    orde1Name: "Sistem Jaringan Transportasi Laut", orde1Kd: "42040000",
    orde2Name: "Pelabuhan Laut", orde2Kd: "12041000",
    orde3Name: "Pangkalan Pendaratan Ikan", orde3Kd: "12041904",
    orde4Name: "Pangkalan Pendaratan Ikan", orde4Kd: "12041904"
  },
  // Energi
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Minyak dan Gas Bumi", orde1Kd: "43010000",
    orde2Name: "Infrastruktur Minyak dan Gas Bumi", orde2Kd: "13010000",
    orde3Name: "Infrastruktur Minyak dan Gas Bumi", orde3Kd: "13010000",
    orde4Name: "Infrastruktur Minyak dan Gas Bumi", orde4Kd: "13010000"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Minyak dan Gas Bumi", orde1Kd: "43010000",
    orde2Name: "Jaringan Minyak dan Gas Bumi", orde2Kd: "23010000",
    orde3Name: "Jaringan yang menyalurkan Minyak dan Gas Bumi dari Fasilitas Produksi-Kilang", orde3Kd: "23011000",
    orde4Name: "Jaringan yang menyalurkan Minyak dan Gas Bumi dari Fasilitas Produksi-Kilang", orde4Kd: "23011000"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Minyak dan Gas Bumi", orde1Kd: "43010000",
    orde2Name: "Jaringan Minyak dan Gas Bumi", orde2Kd: "23010000",
    orde3Name: "Jaringan yang menyalurkan Minyak dan Gas Bumi dari Fasilitas Produksi-Tempat", orde3Kd: "23012000",
    orde4Name: "Jaringan yang menyalurkan Minyak dan Gas Bumi dari Fasilitas Produksi-Tempat", orde4Kd: "23012000"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Minyak dan Gas Bumi", orde1Kd: "43010000",
    orde2Name: "Jaringan Minyak dan Gas Bumi", orde2Kd: "23010000",
    orde3Name: "Jaringan yang menyalurkan Gas Bumi dari Kilang-Konsumen", orde3Kd: "23013000",
    orde4Name: "Jaringan yang menyalurkan Gas Bumi dari Kilang-Konsumen", orde4Kd: "23013000"
  },
  // Ketenagalistrikan
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Air (PLTA)", orde3Kd: "13022101",
    orde4Name: "Pembangkit Listrik Tenaga Air (PLTA)", orde4Kd: "13022101"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Uap (PLTU)", orde3Kd: "13022102",
    orde4Name: "Pembangkit Listrik Tenaga Uap (PLTU)", orde4Kd: "13022102"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Gas (PLTG)", orde3Kd: "13022103",
    orde4Name: "Pembangkit Listrik Tenaga Gas (PLTG)", orde4Kd: "13022103"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Diesel (PLTD)", orde3Kd: "13022104",
    orde4Name: "Pembangkit Listrik Tenaga Diesel (PLTD)", orde4Kd: "13022104"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Nuklir (PLTN)", orde3Kd: "13022201",
    orde4Name: "Pembangkit Listrik Tenaga Nuklir (PLTN)", orde4Kd: "13022201"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Surya (PLTS)", orde3Kd: "13022202",
    orde4Name: "Pembangkit Listrik Tenaga Surya (PLTS)", orde4Kd: "13022202"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Bayu (PLTB)", orde3Kd: "13022203",
    orde4Name: "Pembangkit Listrik Tenaga Bayu (PLTB)", orde4Kd: "13022203"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Panas Bumi (PLTP)", orde3Kd: "13022204",
    orde4Name: "Pembangkit Listrik Tenaga Panas Bumi (PLTP)", orde4Kd: "13022204"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Tenaga Mikro Hidro (PLTMH)", orde3Kd: "13022205",
    orde4Name: "Pembangkit Listrik Tenaga Mikro Hidro (PLTMH)", orde4Kd: "13022205"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Infrastruktur Pembangkitan Tenaga Listrik dan Sarana Pendukung", orde2Kd: "13022000",
    orde3Name: "Pembangkit Listrik Lainnya", orde3Kd: "13022300",
    orde4Name: "Pembangkit Listrik Lainnya", orde4Kd: "13022300"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Transmisi Tenaga Listrik Antarsistem", orde3Kd: "23021100",
    orde4Name: "Saluran Udara Tegangan Ultra Tinggi (SUTT)", orde4Kd: "23021101"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Transmisi Tenaga Listrik Antarsistem", orde3Kd: "23021100",
    orde4Name: "Saluran Udara Tegangan Ekstra Tinggi (SUTET)", orde4Kd: "23021102"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Transmisi Tenaga Listrik Antarsistem", orde3Kd: "23021100",
    orde4Name: "Saluran Udara Tegangan Tinggi (SUTT)", orde4Kd: "23021103"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Transmisi Tenaga Listrik Antarsistem", orde3Kd: "23021100",
    orde4Name: "Saluran Udara Tegangan Tinggi Arus Searah (SUTTAS)", orde4Kd: "23021104"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Transmisi Tenaga Listrik Antarsistem", orde3Kd: "23021100",
    orde4Name: "Saluran Transmisi Lainnya", orde4Kd: "23021106"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Distribusi Tenaga Listrik", orde3Kd: "23021200",
    orde4Name: "Saluran Udara Tegangan Menengah (SUTM)", orde4Kd: "23021201"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Distribusi Tenaga Listrik", orde3Kd: "23021200",
    orde4Name: "Saluran Udara Tegangan Rendah (SUTR)", orde4Kd: "23021202"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Distribusi Tenaga Listrik", orde3Kd: "23021200",
    orde4Name: "Saluran Kabel Tegangan Menengah (SKTM)", orde4Kd: "23021203"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Distribusi Tenaga Listrik", orde3Kd: "23021200",
    orde4Name: "Saluran Distribusi Lainnya", orde4Kd: "23021204"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Jaringan Infrastruktur Penyaluran Tenaga Listrik dan Sarana Pendukung", orde2Kd: "43021000",
    orde3Name: "Jaringan Pipa/Kabel Bawah Laut Penyaluran Tenaga Listrik", orde3Kd: "23021300",
    orde4Name: "Jaringan Pipa/Kabel Bawah Laut Penyaluran Tenaga Listrik", orde4Kd: "23021300"
  },
  {
    jenisName: "Sistem Jaringan Energi", jenisKd: "43000000",
    orde1Name: "Jaringan Infrastruktur Ketenagalistrikan", orde1Kd: "43020000",
    orde2Name: "Gardu Induk", orde2Kd: "13021400",
    orde3Name: "Gardu Induk", orde3Kd: "13021400",
    orde4Name: "Gardu Induk", orde4Kd: "13021400"
  },
  // Telekomunikasi
  {
    jenisName: "Sistem Jaringan Telekomunikasi", jenisKd: "44000000",
    orde1Name: "Infrastruktur Jaringan Tetap", orde1Kd: "14010000",
    orde2Name: "Infrastruktur Jaringan Tetap", orde2Kd: "14010000",
    orde3Name: "Infrastruktur Jaringan Tetap", orde3Kd: "14010000",
    orde4Name: "Infrastruktur Jaringan Tetap", orde4Kd: "14010000"
  },
  {
    jenisName: "Sistem Jaringan Telekomunikasi", jenisKd: "44000000",
    orde1Name: "Jaringan Bergerak", orde1Kd: "14020000",
    orde2Name: "Jaringan Bergerak Seluler", orde2Kd: "14021000",
    orde3Name: "Jaringan Bergerak Seluler", orde3Kd: "14021000",
    orde4Name: "Jaringan Bergerak Seluler", orde4Kd: "14021000"
  },
  {
    jenisName: "Sistem Jaringan Telekomunikasi", jenisKd: "44000000",
    orde1Name: "Jaringan Bergerak", orde1Kd: "14020000",
    orde2Name: "Jaringan Bergerak Terestrial", orde2Kd: "14022000",
    orde3Name: "Jaringan Bergerak Terestrial", orde3Kd: "14022000",
    orde4Name: "Jaringan Bergerak Terestrial", orde4Kd: "14022000"
  },
  {
    jenisName: "Sistem Jaringan Telekomunikasi", jenisKd: "44000000",
    orde1Name: "Jaringan Bergerak", orde1Kd: "14020000",
    orde2Name: "Jaringan Bergerak Satelit", orde2Kd: "14023000",
    orde3Name: "Jaringan Bergerak Satelit", orde3Kd: "14023000",
    orde4Name: "Jaringan Bergerak Satelit", orde4Kd: "14023000"
  },
  // Sumber Daya Air
  {
    jenisName: "Sistem Jaringan Sumber Daya Air", jenisKd: "45000000",
    orde1Name: "Prasarana Sumber Daya Air", orde1Kd: "45010000",
    orde2Name: "Sistem Jaringan Irigasi", orde2Kd: "25011000",
    orde3Name: "Jaringan Irigasi Primer", orde3Kd: "25011100",
    orde4Name: "Jaringan Irigasi Primer", orde4Kd: "25011100"
  },
  {
    jenisName: "Sistem Jaringan Sumber Daya Air", jenisKd: "45000000",
    orde1Name: "Prasarana Sumber Daya Air", orde1Kd: "45010000",
    orde2Name: "Sistem Jaringan Irigasi", orde2Kd: "25011000",
    orde3Name: "Jaringan Irigasi Sekunder", orde3Kd: "25011200",
    orde4Name: "Jaringan Irigasi Sekunder", orde4Kd: "25011200"
  },
  {
    jenisName: "Sistem Jaringan Sumber Daya Air", jenisKd: "45000000",
    orde1Name: "Prasarana Sumber Daya Air", orde1Kd: "45010000",
    orde2Name: "Sistem Jaringan Irigasi", orde2Kd: "25011000",
    orde3Name: "Jaringan Irigasi Tersier", orde3Kd: "25011300",
    orde4Name: "Jaringan Irigasi Tersier", orde4Kd: "25011300"
  },
  {
    jenisName: "Sistem Jaringan Sumber Daya Air", jenisKd: "45000000",
    orde1Name: "Prasarana Sumber Daya Air", orde1Kd: "45010000",
    orde2Name: "Sistem Jaringan Irigasi", orde2Kd: "25011000",
    orde3Name: "Jaringan Irigasi Air Tanah", orde3Kd: "25011400",
    orde4Name: "Jaringan Irigasi Air Tanah", orde4Kd: "25011400"
  },
  {
    jenisName: "Sistem Jaringan Sumber Daya Air", jenisKd: "45000000",
    orde1Name: "Prasarana Sumber Daya Air", orde1Kd: "45010000",
    orde2Name: "Air Baku untuk Air Bersih", orde2Kd: "15011000",
    orde3Name: "Bangunan Pengambilan Air Baku", orde3Kd: "15012100",
    orde4Name: "Bangunan Pengambilan Air Baku", orde4Kd: "15012100"
  },
  {
    jenisName: "Sistem Jaringan Sumber Daya Air", jenisKd: "45000000",
    orde1Name: "Prasarana Sumber Daya Air", orde1Kd: "45010000",
    orde2Name: "Sistem Pengendalian Banjir", orde2Kd: "45012000",
    orde3Name: "Bangunan Pengendalian Banjir", orde3Kd: "15012200",
    orde4Name: "Bangunan Pengendalian Banjir", orde4Kd: "15012200"
  },
  // Prasarana Lainnya (SPAM dll)
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Bukan Jaringan Perpipaan", orde2Kd: "16012000",
    orde3Name: "Sumur Dangkal", orde3Kd: "16012100",
    orde4Name: "Sumur Dangkal", orde4Kd: "16012100"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Bukan Jaringan Perpipaan", orde2Kd: "16012000",
    orde3Name: "Sumur Pompa", orde3Kd: "16012200",
    orde4Name: "Sumur Pompa", orde4Kd: "16012200"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Bukan Jaringan Perpipaan", orde2Kd: "16012000",
    orde3Name: "Bak Penampungan Air Hujan", orde3Kd: "16012300",
    orde4Name: "Bak Penampungan Air Hujan", orde4Kd: "16012300"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Bukan Jaringan Perpipaan", orde2Kd: "16012000",
    orde3Name: "Penampungan Mata Air", orde3Kd: "16012400",
    orde4Name: "Penampungan Mata Air", orde4Kd: "16012400"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Bukan Jaringan Perpipaan", orde2Kd: "16012000",
    orde3Name: "Bangunan Penangkap Mata Air", orde3Kd: "16012500",
    orde4Name: "Bangunan Penangkap Mata Air", orde4Kd: "16012500"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Jaringan Perpipaan", orde2Kd: "46011000",
    orde3Name: "Jaringan Air Baku", orde3Kd: "26011100",
    orde4Name: "Jaringan Air Baku", orde4Kd: "26011100"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Jaringan Perpipaan", orde2Kd: "46011000",
    orde3Name: "Unit Distribusi", orde3Kd: "26011100",
    orde4Name: "Unit Distribusi", orde4Kd: "26011100"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Jaringan Perpipaan", orde2Kd: "46011000",
    orde3Name: "Unit Air Baku", orde3Kd: "16011100",
    orde4Name: "Unit Air Baku", orde4Kd: "16011100"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Penyediaan Air Minum (SPAM)", orde1Kd: "46010000",
    orde2Name: "Jaringan Perpipaan", orde2Kd: "46011000",
    orde3Name: "Unit Produksi", orde3Kd: "16011200",
    orde4Name: "Unit Produksi", orde4Kd: "16011200"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Pengelolaan Air Limbah (SPAL)", orde1Kd: "46020000",
    orde2Name: "Infrastruktur Sistem Pengelolaan Air Limbah Domestik", orde2Kd: "16021000",
    orde3Name: "Infrastruktur Sistem Pengelolaan Air Limbah Domestik", orde3Kd: "16021000",
    orde4Name: "Infrastruktur Sistem Pengelolaan Air Limbah Domestik", orde4Kd: "16021000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Pengelolaan Air Limbah (SPAL)", orde1Kd: "46020000",
    orde2Name: "Infrastruktur Sistem Pengelolaan Air Limbah Non Domestik", orde2Kd: "16022000",
    orde3Name: "Infrastruktur Sistem Pengelolaan Air Limbah Non Domestik", orde3Kd: "16022000",
    orde4Name: "Infrastruktur Sistem Pengelolaan Air Limbah Non Domestik", orde4Kd: "16022000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Pengelolaan Air Limbah (SPAL)", orde1Kd: "46020000",
    orde2Name: "Jaringan Sistem Pengelolaan Air Limbah Domestik", orde2Kd: "26021000",
    orde3Name: "Jaringan Sistem Pengelolaan Air Limbah Domestik", orde3Kd: "26021000",
    orde4Name: "Jaringan Sistem Pengelolaan Air Limbah Domestik", orde4Kd: "26021000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Pengelolaan Air Limbah (SPAL)", orde1Kd: "46020000",
    orde2Name: "Jaringan Sistem Pengelolaan Air Limbah Non Domestik", orde2Kd: "26022000",
    orde3Name: "Jaringan Sistem Pengelolaan Air Limbah Non Domestik", orde3Kd: "26022000",
    orde4Name: "Jaringan Sistem Pengelolaan Air Limbah Non Domestik", orde4Kd: "26022000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Pengelolaan Limbah Bahan Berbahaya dan Beracun (B3)", orde1Kd: "16030000",
    orde2Name: "Sistem Pengelolaan Limbah Bahan Berbahaya dan Beracun (B3)", orde2Kd: "16030000",
    orde3Name: "Sistem Pengelolaan Limbah Bahan Berbahaya dan Beracun (B3)", orde3Kd: "16030000",
    orde4Name: "Sistem Pengelolaan Limbah Bahan Berbahaya dan Beracun (B3)", orde4Kd: "16030000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Jaringan Persampahan", orde1Kd: "16040000",
    orde2Name: "Tempat Pemrosesan Akhir (TPA)", orde2Kd: "16044000",
    orde3Name: "Tempat Pemrosesan Akhir (TPA)", orde3Kd: "16044000",
    orde4Name: "Tempat Pemrosesan Akhir (TPA)", orde4Kd: "16044000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Jaringan Persampahan", orde1Kd: "16040000",
    orde2Name: "Stasiun Peralihan Antara (SPA)", orde2Kd: "16041000",
    orde3Name: "Stasiun Peralihan Antara (SPA)", orde3Kd: "16041000",
    orde4Name: "Stasiun Peralihan Antara (SPA)", orde4Kd: "16041000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Jaringan Persampahan", orde1Kd: "16040000",
    orde2Name: "Tempat Pengolahan Sampah Terpadu (TPST)", orde2Kd: "16045000",
    orde3Name: "Tempat Pengolahan Sampah Terpadu (TPST)", orde3Kd: "16045000",
    orde4Name: "Tempat Pengolahan Sampah Terpadu (TPST)", orde4Kd: "16045000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Jaringan Persampahan", orde1Kd: "16040000",
    orde2Name: "Tempat Pengolahan Sampah Reuse, Reduce, Recycle (TPS3R)", orde2Kd: "16042000",
    orde3Name: "Tempat Pengolahan Sampah Reuse, Reduce, Recycle (TPS3R)", orde3Kd: "16042000",
    orde4Name: "Tempat Pengolahan Sampah Reuse, Reduce, Recycle (TPS3R)", orde4Kd: "16042000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Jaringan Evakuasi Bencana", orde1Kd: "46061000",
    orde2Name: "Jalur Evakuasi Bencana", orde2Kd: "26061100",
    orde3Name: "Jalur Evakuasi Bencana", orde3Kd: "26061100",
    orde4Name: "Jalur Evakuasi Bencana", orde4Kd: "26061100"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Sistem Jaringan Evakuasi Bencana", orde1Kd: "46061000",
    orde2Name: "Tempat Evakuasi Bencana", orde2Kd: "16061100",
    orde3Name: "Tempat Evakuasi Bencana", orde3Kd: "16061100",
    orde4Name: "Tempat Evakuasi Bencana", orde4Kd: "16061100"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Jaringan Drainase", orde1Kd: "46050000",
    orde2Name: "Jaringan Drainase Primer", orde2Kd: "26051000",
    orde3Name: "Jaringan Drainase Primer", orde3Kd: "26051000",
    orde4Name: "Jaringan Drainase Primer", orde4Kd: "26051000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Jaringan Drainase", orde1Kd: "46050000",
    orde2Name: "Jaringan Drainase Sekunder", orde2Kd: "26052000",
    orde3Name: "Jaringan Drainase Sekunder", orde3Kd: "26052000",
    orde4Name: "Jaringan Drainase Sekunder", orde4Kd: "26052000"
  },
  {
    jenisName: "Sistem Jaringan Prasarana Lainnya", jenisKd: "46000000",
    orde1Name: "Jaringan Drainase", orde1Kd: "46050000",
    orde2Name: "Jaringan Drainase Tersier", orde2Kd: "26053000",
    orde3Name: "Jaringan Drainase Tersier", orde3Kd: "26053000",
    orde4Name: "Jaringan Drainase Tersier", orde4Kd: "26053000"
  }
];

export function lookupStructureMasterEntry(val: string): MasterRefEntry | null {
  const cleanVal = cleanStringForLookup(val);
  if (!cleanVal) return null;

  // Let's check if it's a numeric code
  const isNumeric = /^\d{4,8}$/.test(cleanVal);
  if (isNumeric) {
    for (const entry of STRUCTURE_MASTER_REFS) {
      if (
        entry.orde4Kd === cleanVal ||
        entry.orde3Kd === cleanVal ||
        entry.orde2Kd === cleanVal ||
        entry.orde1Kd === cleanVal ||
        entry.jenisKd === cleanVal
      ) {
        return entry;
      }
    }
  }

  // Exact name lookups
  for (const entry of STRUCTURE_MASTER_REFS) {
    if (cleanStringForLookup(entry.orde4Name) === cleanVal) return entry;
    if (cleanStringForLookup(entry.orde3Name) === cleanVal) return entry;
    if (cleanStringForLookup(entry.orde2Name) === cleanVal) return entry;
    if (cleanStringForLookup(entry.orde1Name) === cleanVal) return entry;
    if (cleanStringForLookup(entry.jenisName) === cleanVal) return entry;
  }

  // Substring or fuzzy similarity matching fallback
  for (const entry of STRUCTURE_MASTER_REFS) {
    const o4Clean = cleanStringForLookup(entry.orde4Name);
    const o3Clean = cleanStringForLookup(entry.orde3Name);
    const o2Clean = cleanStringForLookup(entry.orde2Name);
    const o1Clean = cleanStringForLookup(entry.orde1Name);
    if (o4Clean.includes(cleanVal) || cleanVal.includes(o4Clean)) return entry;
    if (o3Clean.includes(cleanVal) || cleanVal.includes(o3Clean)) return entry;
    if (o2Clean.includes(cleanVal) || cleanVal.includes(o2Clean)) return entry;
    if (o1Clean.includes(cleanVal) || cleanVal.includes(o1Clean)) return entry;
  }

  return null;
}

export function inferOrde1AndOrde2(type: 'Infrastruktur' | 'Jaringan', namobj: string): { orde1: string; orde2: string } {
  const masterEntry = lookupStructureMasterEntry(namobj);
  if (masterEntry) {
    return { orde1: masterEntry.orde1Name, orde2: masterEntry.orde2Name };
  }
  return { orde1: 'Belum memiliki klasifikasi pada master referensi', orde2: 'Belum memiliki klasifikasi pada master referensi' };
}

export function getJenisRencanaStrukturRuang(type: 'Infrastruktur' | 'Jaringan', namobj: string, orde1?: string): string {
  const masterEntry = lookupStructureMasterEntry(namobj) || (orde1 ? lookupStructureMasterEntry(orde1) : null);
  if (masterEntry) {
    return masterEntry.jenisName;
  }
  return 'Belum memiliki klasifikasi pada master referensi';
}

/**
 * Parses Rencana Struktur Ruang multi-sheet Pivot Excel (Sheet 1: Infrastruktur, Sheet 2: Jaringan)
 */
export function parseStrukturPivotExcel(workbook: XLSX.WorkBook): Record<string, StrukturPivotItem> {
  const result: Record<string, StrukturPivotItem> = {};
  
  const findSheet = (keyword: string, fallbackIdx: number) => {
    const sName = workbook.SheetNames.find(name => name.toUpperCase().includes(keyword));
    if (sName) return workbook.Sheets[sName];
    if (fallbackIdx < workbook.SheetNames.length) return workbook.Sheets[workbook.SheetNames[fallbackIdx]];
    return null;
  };

  const infraSheet = findSheet('INFRASTRUKTUR', 0);
  const jarSheet = findSheet('JARINGAN', 1);

  const parseSheet = (sheet: any, type: 'Infrastruktur' | 'Jaringan') => {
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    if (rows.length === 0) return;

    let orde1Idx = -1;
    let orde2Idx = -1;
    let namobjIdx = -1;
    let remarkIdx = -1;
    let wadmkcIdx = -1;
    let geometriIdx = -1;

    // Search header names in first 10 rows
    let startRowIdx = 0;
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const row = rows[i];
      if (!row) continue;
      
      const nPos = row.findIndex(c => String(c).toUpperCase().trim() === 'NAMOBJ' || String(c).toUpperCase().trim().replace(/[\s_-]+/g, '') === 'ORDE3' || String(c).toUpperCase().trim().replace(/[\s_-]+/g, '') === 'JENISPRASARANA');
      if (nPos !== -1) {
        namobjIdx = nPos;
        orde1Idx = row.findIndex(c => {
          const val = String(c).toUpperCase().trim().replace(/[\s_-]+/g, '');
          return val === 'ORDE1' || val === 'ORDE_1' || val === 'ORDE-1' || val === 'SYSTEM' || val === 'GRUP1' || val === 'GROUP1' || val === 'SISTEM';
        });
        orde2Idx = row.findIndex(c => {
          const val = String(c).toUpperCase().trim().replace(/[\s_-]+/g, '');
          return val === 'ORDE2' || val === 'ORDE_2' || val === 'ORDE-2' || val === 'SUBSYSTEM' || val === 'GRUP2' || val === 'GROUP2' || val === 'SUBSISTEM';
        });
        remarkIdx = row.findIndex(c => {
          const val = String(c).toUpperCase().trim();
          return val === 'REMARK' || val === 'KETERANGAN' || val === 'NAMA' || val === 'NAMA_OBJEK' || val === 'RUAS' || val === 'ORDE4';
        });
        wadmkcIdx = row.findIndex(c => {
          const val = String(c).toUpperCase().trim();
          return val === 'WADMKC' || val === 'WADM_KC' || val === 'DISTRIK' || val === 'KECAMATAN';
        });
        geometriIdx = row.findIndex(c => {
          const val = String(c).toUpperCase().trim().replace(/[\s_-]+/g, '');
          return val === 'BENTUKGEOMETRI' || val === 'GEOMETRI' || val === 'BENTUK' || val === 'GEOMETRIS' || val.includes('GEOMETRI');
        });
        startRowIdx = i + 1;
        break;
      }
    }

    if (namobjIdx === -1) namobjIdx = 0;
    if (remarkIdx === -1) remarkIdx = 1;
    if (wadmkcIdx === -1) wadmkcIdx = 2;

    // Pivot-table exports (e.g. from Excel "Group & Outline" or merged
    // cells flattened to sheet_to_json) only populate JNSRSR/ORDE01-04/
    // NAMOBJ on the FIRST row of each group; subsequent rows belonging to
    // the same group are blank in those columns and only carry their own
    // REMARK/WADMKC. Without forward-filling, those continuation rows
    // would be keyed under namobj="" instead of the group they actually
    // belong to (e.g. "Jembatan"), scattering them into bogus separate
    // entries and making the real class disappear except for its first row.
    let lastNamobj = '';
    let lastOrde1 = '';
    let lastOrde2 = '';

    for (let i = startRowIdx; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const namobjRaw = row[namobjIdx] ? String(row[namobjIdx]).trim() : '';
      const remarkVal = row[remarkIdx] ? String(row[remarkIdx]).trim() : '';
      const wadmkcVal = row[wadmkcIdx] ? String(row[wadmkcIdx]).trim() : '';
      const orde1Raw = orde1Idx !== -1 && row[orde1Idx] ? String(row[orde1Idx]).trim() : '';
      const orde2Raw = orde2Idx !== -1 && row[orde2Idx] ? String(row[orde2Idx]).trim() : '';
      const geometriVal = geometriIdx !== -1 && row[geometriIdx] ? String(row[geometriIdx]).trim() : '';

      if (!namobjRaw && !remarkVal && !wadmkcVal) continue;

      // Forward-fill: a non-empty NAMOBJ/ORDE value starts a new group and
      // becomes the carried-forward value; an empty cell inherits the most
      // recent group's value (standard pivot-table "merged cell" pattern).
      const namobjVal = namobjRaw || lastNamobj;
      const orde1Val = orde1Raw || lastOrde1;
      const orde2Val = orde2Raw || lastOrde2;
      if (namobjRaw) lastNamobj = namobjRaw;
      if (orde1Raw) lastOrde1 = orde1Raw;
      if (orde2Raw) lastOrde2 = orde2Raw;

      if (namobjVal.toLowerCase().includes('total') || namobjVal.toLowerCase().includes('grand')) continue;

      // Determine type based on Bentuk Geometri:
      // Titik -> Infrastruktur
      // Garis -> Jaringan
      let inferredType: 'Infrastruktur' | 'Jaringan' = type;
      if (geometriVal) {
        const normGeo = geometriVal.toLowerCase();
        if (normGeo.includes('titik') || normGeo.includes('point')) {
          inferredType = 'Infrastruktur';
        } else if (normGeo.includes('garis') || normGeo.includes('line') || normGeo.includes('polygon') || normGeo.includes('area') || normGeo.includes('poligon')) {
          inferredType = 'Jaringan';
        }
      }

      const cleanRemark = remarkVal && remarkVal.toLowerCase() !== 'null' && remarkVal.toLowerCase() !== 'nan' ? remarkVal : '';
      const key = `${inferredType.toLowerCase()}|||${namobjVal.toLowerCase()}|||${cleanRemark.toLowerCase()}`;

      if (!result[key]) {
        const fallback = inferOrde1AndOrde2(inferredType, namobjVal);
        result[key] = {
          orde1: orde1Val || fallback.orde1,
          orde2: orde2Val || fallback.orde2,
          namobj: namobjVal,
          remark: cleanRemark,
          districts: [],
          type: inferredType
        };
      }

      if (wadmkcVal && wadmkcVal.toLowerCase() !== 'null' && wadmkcVal.toLowerCase() !== 'nan') {
        const cleanDistrict = wadmkcVal.trim();
        if (cleanDistrict) {
          result[key].districts.push(cleanDistrict);
        }
      }
    }
  };

  parseSheet(infraSheet, 'Infrastruktur');
  parseSheet(jarSheet, 'Jaringan');

  // De-duplicate district arrays for each item
  for (const key of Object.keys(result)) {
    const districtsSet = new Set<string>();
    result[key].districts.forEach(d => {
      const parts = d.split(/[,;\r\n]|\bdan\b/);
      parts.forEach(p => {
        const cleaned = p.trim();
        if (cleaned) {
          districtsSet.add(cleaned);
        }
      });
    });
    result[key].districts = Array.from(districtsSet);
  }

  return result;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function isWordFuzzyMatch(w1: string, w2: string): boolean {
  if (w1 === w2) return true;
  if (Math.abs(w1.length - w2.length) > 2) return false;
  
  const dist = levenshteinDistance(w1, w2);
  if (w1.length >= 6) {
    return dist <= 2;
  } else {
    return dist <= 1;
  }
}

function matchesOrde4Fuzzy(lineText: string, orde4: string): boolean {
  const cleanLine = lineText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const cleanOrde4 = orde4.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  
  const lineWords = cleanLine.split(/\s+/).filter(w => w.trim().length > 1);
  const orde4Words = cleanOrde4.split(/\s+/).filter(w => w.trim().length > 1);
  
  if (orde4Words.length === 0) return false;
  
  let matchedCount = 0;
  for (const ow of orde4Words) {
    const found = lineWords.some(lw => isWordFuzzyMatch(lw, ow) || lw.includes(ow) || ow.includes(lw));
    if (found) {
      matchedCount++;
    }
  }
  
  const ratio = matchedCount / orde4Words.length;
  return ratio >= 0.7; // 70%+ of words match
}

function findMatchedNameInText(text: string, remark: string): string | null {
  if (!remark || remark.toLowerCase() === 'tidak ada' || remark.toLowerCase() === 'tidak tersedia') return null;
  
  // Normalize both to find location
  const cleanRemark = remark.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanRemark) return null;
  
  // Try exact lookup first (case insensitive)
  const idx = text.toLowerCase().indexOf(remark.toLowerCase());
  if (idx !== -1) {
    return text.substring(idx, idx + remark.length);
  }
  
  // Try mapping common abbreviations like "Jl." to "Jalan" or vice-versa
  const remarkAlt = remark.toLowerCase().replace(/\bjl\.\s*|\bjl\s*/g, 'jalan ');
  const textAlt = text.toLowerCase().replace(/\bjl\.\s*|\bjl\s*/g, 'jalan ');
  const altIdx = textAlt.indexOf(remarkAlt);
  if (altIdx !== -1) {
    const words = remark.split(/\s+/).filter(w => w.length > 1);
    let bestMatch = '';
    let bestScore = 0;
    
    const textWords = text.split(/\s+/);
    for (let i = 0; i < textWords.length; i++) {
      for (let j = i + 1; j <= Math.min(textWords.length, i + 10); j++) {
        const candidate = textWords.slice(i, j).join(' ');
        const cleanCand = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanCand.includes(cleanRemark) || cleanRemark.includes(cleanCand)) {
          const score = cleanCand === cleanRemark ? 100 : (cleanCand.length - Math.abs(cleanCand.length - cleanRemark.length));
          if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate.replace(/[.,;:()]/g, '').trim(); 
          }
        }
      }
    }
    if (bestMatch) return bestMatch;
  }
  
  // Just do word overlap search
  const remarkWords = remark.split(/\s+/).map(w => w.replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(w => w.length > 2);
  const textWords = text.split(/\s+/);
  if (remarkWords.length > 0) {
    let bestMatchPhrase = '';
    let maxMatchWords = 0;
    for (let i = 0; i < textWords.length; i++) {
       for (let j = i + 1; j <= Math.min(textWords.length, i + remarkWords.length + 3); j++) {
         const phrase = textWords.slice(i, j).join(' ');
         const phraseWords = phrase.toLowerCase().replace(/[^a-z0-9\s]/gi, '').split(/\s+/);
         const intersectCount = remarkWords.filter(rw => phraseWords.includes(rw)).length;
         if (intersectCount > maxMatchWords) {
           maxMatchWords = intersectCount;
           bestMatchPhrase = phrase.replace(/[.,;:()]/g, '').trim();
         }
       }
    }
    if (maxMatchWords >= Math.ceil(remarkWords.length * 0.7)) {
       return bestMatchPhrase;
    }
  }

  return null;
}

export interface ClauseLine {
  text: string;
  label: string;
  originalText: string;
}

/**
 * Evaluates consistency of Rencana Struktur Ruang draft text vs parsed Pivot Excel.
 */
export function analyzeStrukturConsistency(
  ranperdaText: string,
  pivotData: Record<string, StrukturPivotItem>
): { results: StrukturConsistencyResult[]; stats: StrukturSummaryStats; kabupaten: string } {
  const kabupaten = extractKabupatenName(ranperdaText);
  const results: (StrukturConsistencyResult & { _orderIndex: number })[] = [];

  const scopedText = extractStrukturRuangSection(ranperdaText);
  
  // 1. Parse paragraphs
  const rawParaInfos = buildParaInfos(scopedText);
  
  // 2. Expand into context-rich flat ClauseLine array
  const clauseLines: ClauseLine[] = [];
  
  for (const para of rawParaInfos) {
    const lines = para.text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length <= 1) {
      clauseLines.push({ text: para.text, label: para.label || '(Draf)', originalText: para.text });
      continue;
    }

    // Detect bullet start index
    const bulletRegex = /^(?:[a-z]\.\s+|\([a-z]\)\s+|\d+\.\s+|\(\d+\)\s+|angka\s+\d+\s+|[ivxldcm]+\.\s+|\([ivxldcm]+\)\s+)/i;
    let firstBulletIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (bulletRegex.test(lines[i])) {
        firstBulletIdx = i;
        break;
      }
    }

    if (firstBulletIdx === -1) {
      clauseLines.push({ text: para.text, label: para.label || '(Draf)', originalText: para.text });
      continue;
    }

    // Process nested bullet hierarchy to build context-aware lines
    const headerLines = lines.slice(0, firstBulletIdx);
    const headerText = headerLines.join(' ');

    const activeLines: Record<string, string> = { header: headerText };

    // Tracks the "Pasal N ayat (M)" label for the current position within
    // this paragraph. Starts from the paragraph-level label (which already
    // captures the first ayat, if any - see buildParaInfos). Updated
    // whenever a new top-level "(M)" ayat marker is encountered directly
    // under the header (not nested under a lettered sub-item), which
    // happens when a .docx paragraph collapses multiple ayat together
    // without blank-line separators.
    const pasalLabelMatch = (para.label || '').match(/^(Pasal\s+\d+)/i);
    const basePasalLabel = pasalLabelMatch ? pasalLabelMatch[1] : '';
    let currentLineLabel = para.label || '(Draf)';

    // Helper: strip the list-marker prefix from a line so it doesn't bleed
    // into combinedText (issue 2 - "a. Jembatan X" becoming "a. Jembatan X"
    // in namobjRanperda / district extraction).
    const stripMarker = (s: string): string =>
      s.replace(/^(?:[a-z]\.\s+|\([a-z]\)\s+|\d+\.\s+|\(\d+\)\s+|angka\s+\d+\s+|[ivxldcm]+\.\s+|\([ivxldcm]+\)\s+)/i, '').trim();

    for (let idx = firstBulletIdx; idx < lines.length; idx++) {
      const line = lines[idx];
      const cleanLine = line.trim();

      let type: 'letter' | 'number' | 'roman' | 'header' = 'header';
      if (/^(?:[a-z])\.\s+/i.test(cleanLine) || /^\((?:[a-z])\)\s+/i.test(cleanLine)) {
        type = 'letter';
      } else if (/^\d+\.\s+/i.test(cleanLine) || /^\(\d+\)\s+/i.test(cleanLine) || /^angka\s+\d+\s+/i.test(cleanLine)) {
        type = 'number';
      } else if (/^[ivxldcm]+\.\s+/i.test(cleanLine) || /^\([ivxldcm]+\)\s+/i.test(cleanLine)) {
        type = 'roman';
      }

      // A "(M)" marker is a new *ayat* (not a nested numbered sub-item)
      // only when it appears at the top level of the paragraph, i.e. no
      // lettered sub-item is currently active. In that case, advance the
      // label to "Pasal N ayat (M)" for this and subsequent lines until
      // the next ayat/header marker.
      if (type === 'number' && !activeLines['letter'] && basePasalLabel) {
        const ayatNumMatch = cleanLine.match(/^\(\s*(\d+)\s*\)/);
        if (ayatNumMatch) {
          currentLineLabel = `${basePasalLabel} ayat (${ayatNumMatch[1]})`;
          // A new top-level ayat resets ALL sub-levels so that letter/roman
          // items from the previous ayat don't contaminate this one's
          // combinedText (issue 4 - stale "b. jalan lokal primer melintas di:
          // Distrik Rumberpon" still attached when ayat (2) starts).
          delete activeLines['letter'];
          delete activeLines['roman'];
        }
      }

      // Store the STRIPPED content (no bullet marker) so combinedText fed to
      // extractDistrictsFromText and findMatchedNameInText is clean prose
      // without "a." / "(1)" artefacts (issue 2).
      const stripped = stripMarker(cleanLine);

      if (type === 'header') {
        activeLines['header'] = stripped;
        delete activeLines['letter'];
        delete activeLines['number'];
        delete activeLines['roman'];
      } else if (type === 'letter') {
        activeLines['letter'] = stripped;
        delete activeLines['number'];
        delete activeLines['roman'];
      } else if (type === 'number') {
        activeLines['number'] = stripped;
        delete activeLines['roman'];
      } else if (type === 'roman') {
        activeLines['roman'] = stripped;
      }

      // Combine parents for complete nested line
      const combinedParts: string[] = [];
      if (activeLines['header']) combinedParts.push(activeLines['header']);
      if (activeLines['roman']) combinedParts.push(activeLines['roman']);
      if (activeLines['number']) combinedParts.push(activeLines['number']);
      if (activeLines['letter']) combinedParts.push(activeLines['letter']);

      const combinedText = combinedParts.join(' ');
      clauseLines.push({
        text: combinedText,
        label: currentLineLabel,
        originalText: line
      });
    }
  }

  // Collect all known districts from pivot WADMKC
  const allKnownDistricts = new Set<string>();
  Object.values(pivotData).forEach(item => {
    item.districts.forEach(d => allKnownDistricts.add(toTitleCase(d)));
  });
  const allKnownDistrictsList = Array.from(allKnownDistricts);

  const matchedLineIndices = new Set<number>();

  // Collapses to lowercase alnum tokens separated by single spaces (instead
  // of deleting separators entirely). Deleting separators caused names like
  // "Yutu I" / "Yutu II" or "Wombu I" / "Wombu II" - very common among the
  // many similarly-named Jembatan/road-segment entries in a struktur ruang
  // pivot - to collide: "yutui" is a raw substring of "yutuii", so a plain
  // .includes() would match the wrong ranperda clause and scramble the
  // final document-order sort. Callers that need substring containment
  // must pad both sides with the helper below to get real word-boundary
  // matching instead of OK numerals leaking by the prefix.
  const normalizeStr = (s: string) => {
    return s.toLowerCase()
      .replace(/\bjl\b|\bjl\.\b/g, 'jalan')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  };
  // Wraps a normalized string with boundary spaces so `.includes()` checks
  // only match whole tokens/phrases, not partial-word prefixes (e.g. "yutu
  // i" must not match inside "yutu ii").
  const withBoundaries = (s: string) => ` ${s} `;

  // PASS A: Match each Pivot item to the ClauseLines
  Object.keys(pivotData).forEach(pivotKey => {
    const pItem = pivotData[pivotKey];
    
    // Look up taxonomy strictly from master reference
    const masterEntry = lookupStructureMasterEntry(pItem.namobj) || lookupStructureMasterEntry(pItem.remark);
    
    const jenisRencana = masterEntry ? masterEntry.jenisName : 'Belum memiliki klasifikasi pada master referensi';
    const itemOrde1 = masterEntry ? masterEntry.orde1Name : 'Belum memiliki klasifikasi pada master referensi';
    const itemOrde2 = masterEntry ? masterEntry.orde2Name : 'Belum memiliki klasifikasi pada master referensi';
    const itemOrde3 = masterEntry ? masterEntry.orde3Name : 'Belum memiliki klasifikasi pada master referensi';
    const itemOrde4 = masterEntry ? masterEntry.orde4Name : 'Belum memiliki klasifikasi pada master referensi';

    const isOrde4Empty = !pItem.remark || pItem.remark.trim() === '' || pItem.remark.toLowerCase() === 'tidak ada' || pItem.remark.toLowerCase() === 'tidak tersedia';

    if (isOrde4Empty) {
      // 1. ORDE 4 KOSONG: Match Orde 3 + WADMKC
      let bestLineIdx = -1;
      let bestScore = -1;

      for (let i = 0; i < clauseLines.length; i++) {
        const cl = clauseLines[i];
        const normNamobj = normalizeStr(pItem.namobj);
        const normText = normalizeStr(cl.text);
        if (withBoundaries(normText).includes(withBoundaries(normNamobj))) {
          let score = 10;
          if (getParagraphType(cl.text) === pItem.type) {
            score += 5;
          }
          if (score > bestScore) {
            bestScore = score;
            bestLineIdx = i;
          }
        }
      }

      if (bestLineIdx !== -1) {
        matchedLineIndices.add(bestLineIdx);
        const cl = clauseLines[bestLineIdx];
        const ranperdaDistrik = extractDistrictsFromText(cl.text, allKnownDistrictsList);

        const ranperdaSet = new Set(ranperdaDistrik.map(d => normalizeDistrict(d)));
        const pivotSet = new Set(pItem.districts.map(d => normalizeDistrict(d)));
        
        const hanyaDiPivot = pItem.districts.filter(d => !ranperdaSet.has(normalizeDistrict(d)));
        const hanyaDiRanperda = ranperdaDistrik.filter(d => !pivotSet.has(normalizeDistrict(d)));

        let statusDistrik: 'Sesuai' | 'Tidak Sesuai' | 'INFO' | 'Diperiksa' = 'Sesuai';
        const distrikCatatan: string[] = [];

        if (hanyaDiPivot.length > 0 || hanyaDiRanperda.length > 0) {
          statusDistrik = 'Tidak Sesuai';
          if (hanyaDiPivot.length > 0) {
            distrikCatatan.push(`Distrik di Pivot tapi tidak di draf: [${hanyaDiPivot.join(', ')}]`);
          }
          if (hanyaDiRanperda.length > 0) {
            distrikCatatan.push(`Distrik di draf tapi tidak di Pivot: [${hanyaDiRanperda.join(', ')}]`);
          }
        }

        const statusOverall = (statusDistrik === 'Sesuai') ? 'Sesuai' : 'Tidak Sesuai';

        results.push({
          pasalAyat: cl.label || '(Draf)',
          type: pItem.type,
          jenisRencana,
          orde1: itemOrde1,
          orde2: itemOrde2,
          orde4: itemOrde4,
          namobj: itemOrde3,
          remark: pItem.remark || 'Tidak Ada',
          namobjRanperda: 'Tidak tersedia',
          statusNamobj: 'Tidak Dicek',
          statusRemark: 'N/A',
          distrikPivot: pItem.districts,
          distrikRanperda: ranperdaDistrik,
          statusDistrik,
          catatan: distrikCatatan.join('; ') || 'Konsisten',
          statusOverall,
          _orderIndex: bestLineIdx
        });
      } else {
        results.push({
          pasalAyat: '-',
          type: pItem.type,
          jenisRencana,
          orde1: itemOrde1,
          orde2: itemOrde2,
          orde4: itemOrde4,
          namobj: itemOrde3,
          remark: pItem.remark || 'Tidak Ada',
          namobjRanperda: 'Tidak tersedia',
          statusNamobj: 'Tidak Dicek',
          statusRemark: 'N/A',
          distrikPivot: pItem.districts,
          distrikRanperda: [],
          statusDistrik: 'Diperiksa',
          catatan: `Kategori '${pItem.namobj}' tidak ditemukan pada draf Ranperda Rencana Struktur Ruang.`,
          statusOverall: 'Tidak Ditemukan',
          _orderIndex: Infinity
        });
      }
    } else {
      // 2. ORDE 4 TERCANTUM: Normal fuzzy matching
      let bestLineIdx = -1;
      let bestScore = -1;
      let matchedNameInRanperda = '';

      for (let i = 0; i < clauseLines.length; i++) {
        const cl = clauseLines[i];
        const normRemark = normalizeStr(pItem.remark);
        const normText = normalizeStr(cl.text);

        let isNameMatch = false;
        let score = 0;
        let matchedText = '';

        if (withBoundaries(normText).includes(withBoundaries(normRemark))) {
          isNameMatch = true;
          score += 20;
          matchedText = findMatchedNameInText(cl.text, pItem.remark) || pItem.remark;
        } else if (matchesOrde4Fuzzy(cl.text, pItem.remark)) {
          isNameMatch = true;
          score += 10;
          matchedText = findMatchedNameInText(cl.text, pItem.remark) || pItem.remark;
        }

        if (isNameMatch) {
          const paraType = getParagraphType(cl.text);
          if (paraType === pItem.type) {
            score += 5;
          }
          if (score > bestScore) {
            bestScore = score;
            bestLineIdx = i;
            matchedNameInRanperda = matchedText;
          }
        }
      }

      if (bestLineIdx !== -1) {
        matchedLineIndices.add(bestLineIdx);
        const cl = clauseLines[bestLineIdx];
        const ranperdaDistrik = extractDistrictsFromText(cl.text, allKnownDistrictsList);

        const ranperdaSet = new Set(ranperdaDistrik.map(d => normalizeDistrict(d)));
        const pivotSet = new Set(pItem.districts.map(d => normalizeDistrict(d)));

        const hanyaDiPivot = pItem.districts.filter(d => !ranperdaSet.has(normalizeDistrict(d)));
        const hanyaDiRanperda = ranperdaDistrik.filter(d => !pivotSet.has(normalizeDistrict(d)));

        let statusDistrik: 'Sesuai' | 'Tidak Sesuai' | 'INFO' | 'Diperiksa' = 'Sesuai';
        const distrikCatatan: string[] = [];

        if (hanyaDiPivot.length > 0 || hanyaDiRanperda.length > 0) {
          statusDistrik = 'Tidak Sesuai';
          if (hanyaDiPivot.length > 0) {
            distrikCatatan.push(`Distrik di Pivot tapi tidak di draf: [${hanyaDiPivot.join(', ')}]`);
          }
          if (hanyaDiRanperda.length > 0) {
            distrikCatatan.push(`Distrik di draf tapi tidak di Pivot: [${hanyaDiRanperda.join(', ')}]`);
          }
        }

        const statusOverall = (statusDistrik === 'Sesuai') ? 'Sesuai' : 'Tidak Sesuai';

        results.push({
          pasalAyat: cl.label || '(Draf)',
          type: pItem.type,
          jenisRencana,
          orde1: itemOrde1,
          orde2: itemOrde2,
          orde4: itemOrde4,
          namobj: itemOrde3,
          remark: pItem.remark,
          namobjRanperda: matchedNameInRanperda || pItem.remark,
          statusNamobj: 'Sesuai',
          statusRemark: 'Sesuai',
          distrikPivot: pItem.districts,
          distrikRanperda: ranperdaDistrik,
          statusDistrik,
          catatan: distrikCatatan.join('; ') || 'Konsisten',
          statusOverall,
          _orderIndex: bestLineIdx
        });
      } else {
        // Look for the "LAMPIRAN" condition instead of "TIDAK DITEMUKAN"
        let lampiranLineIdx = -1;
        for (let i = 0; i < clauseLines.length; i++) {
          const cl = clauseLines[i];
          const normNamobj = normalizeStr(pItem.namobj);
          const normText = normalizeStr(cl.text);
          if (withBoundaries(normText).includes(withBoundaries(normNamobj)) && /lampiran/i.test(cl.text)) {
            lampiranLineIdx = i;
            break;
          }
        }

        if (lampiranLineIdx !== -1) {
          matchedLineIndices.add(lampiranLineIdx);
          const cl = clauseLines[lampiranLineIdx];
          const ranperdaDistrik = extractDistrictsFromText(cl.text, allKnownDistrictsList);

          results.push({
            pasalAyat: cl.label || '(Draf)',
            type: pItem.type,
            jenisRencana,
            orde1: itemOrde1,
            orde2: itemOrde2,
            orde4: itemOrde4,
            namobj: itemOrde3,
            remark: pItem.remark,
            namobjRanperda: 'Rujukan Lampiran',
            statusNamobj: 'Tidak Dapat Diverifikasi',
            statusRemark: 'Tidak Dapat Diverifikasi',
            distrikPivot: pItem.districts,
            distrikRanperda: ranperdaDistrik,
            statusDistrik: 'INFO',
            catatan: 'Objek dirujuk melalui Lampiran',
            statusOverall: 'Tidak Dapat Diverifikasi',
            _orderIndex: lampiranLineIdx
          });
        } else {
          // Truly not found
          results.push({
            pasalAyat: '-',
            type: pItem.type,
            jenisRencana,
            orde1: itemOrde1,
            orde2: itemOrde2,
            orde4: itemOrde4,
            namobj: itemOrde3,
            remark: pItem.remark,
            namobjRanperda: '-',
            statusNamobj: 'Tidak Ditemukan',
            statusRemark: 'Tidak Ditemukan',
            distrikPivot: pItem.districts,
            distrikRanperda: [],
            statusDistrik: 'INFO',
            catatan: `Objek detail '${pItem.remark}' ditemukan di Pivot Excel tapi tidak tercantum di draf Ranperda Rencana Struktur Ruang.`,
            statusOverall: 'Tidak Ditemukan',
            _orderIndex: Infinity
          });
        }
      }
    }
  });

  // PASS B: Catch any unmapped clause lines in Ranperda
  // Build a set of names already captured by PASS A so PASS B doesn't
  // emit the same object a second time (issue 3 - PASS A matches a line,
  // but the same or overlapping line content triggers PASS B because its
  // index wasn't recorded, or a sibling line carries the same name).
  const passANames = new Set(
    results
      .filter(r => r.namobjRanperda && r.namobjRanperda !== '-' && r.namobjRanperda !== 'Tidak tersedia')
      .flatMap(r => {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        return [norm(r.namobjRanperda || ''), norm(r.remark || '')];
      })
      .filter(Boolean)
  );

  clauseLines.forEach((cl, idx) => {
    if (matchedLineIndices.has(idx)) return;

    const hasLocation = /berada\s*(?:di)?\s*:/i.test(cl.text) || /berada\s+di\b/i.test(cl.text) || cl.text.toLowerCase().includes('berada di');
    const hasRoute = /melintas\s*(?:di)?\s*:/i.test(cl.text) || /melintas\s+di\b/i.test(cl.text) || cl.text.toLowerCase().includes('melintas di');

    if (hasLocation || hasRoute) {
      const type = hasRoute ? 'Jaringan' : 'Infrastruktur';
      
      // Extract name from the CLEAN cl.text (bullet markers already stripped).
      // Use case-insensitive match so lowercase lines ("jalan kolektor...") work.
      let extractedName = '';
      const nameMatch = cl.text.match(/([A-Za-z][a-zA-Z0-9\s\-–—]{3,60}?)\s+(?:berada|melintas)\b/i);
      if (nameMatch) {
        extractedName = nameMatch[1].trim();
      }
      // Reject if empty or purely generic structural phrase with no specific name
      if (!extractedName || /^(?:sistem|jaringan|kawasan|infrastruktur|jalan|saluran)\s*$/i.test(extractedName)) {
        extractedName = cl.text.split(/[.;\n]/)[0].trim().slice(0, 80);
      }

      // Skip if this name was already captured in PASS A (exact or close match)
      const normExtracted = extractedName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const alreadyCaptured = Array.from(passANames).some(n =>
        n.length > 4 && (n.includes(normExtracted) || normExtracted.includes(n))
      );
      if (alreadyCaptured) return;

      const ranperdaDistrik = extractDistrictsFromText(cl.text, allKnownDistrictsList);
      
      // Look up taxonomy strictly using Master reference data
      const masterEntry = lookupStructureMasterEntry(extractedName);
      
      const jenisRencana = masterEntry ? masterEntry.jenisName : 'Belum memiliki klasifikasi pada master referensi';
      const itemOrde1 = masterEntry ? masterEntry.orde1Name : 'Belum memiliki klasifikasi pada master referensi';
      const itemOrde2 = masterEntry ? masterEntry.orde2Name : 'Belum memiliki klasifikasi pada master referensi';
      const itemOrde3 = masterEntry ? masterEntry.orde3Name : 'Belum memiliki klasifikasi pada master referensi';
      const itemOrde4 = masterEntry ? masterEntry.orde4Name : 'Belum memiliki klasifikasi pada master referensi';

      results.push({
        pasalAyat: cl.label || '(Draf)',
        type,
        jenisRencana,
        orde1: itemOrde1,
        orde2: itemOrde2,
        orde4: itemOrde4,
        namobj: masterEntry ? itemOrde3 : extractedName,
        remark: '-',
        namobjRanperda: extractedName,
        statusNamobj: 'Tidak Ditemukan',
        statusRemark: 'N/A',
        distrikPivot: [],
        distrikRanperda: ranperdaDistrik,
        statusDistrik: 'INFO',
        catatan: `Klausul struktur ruang ada di Ranperda draf tetapi tidak ditemukan padanannya di Pivot Excel.`,
        statusOverall: 'Tidak Ditemukan',
        _orderIndex: idx
      });
    }
  });

  results.sort((a, b) => {
    if (a._orderIndex === b._orderIndex) return 0;
    if (a._orderIndex === Infinity) return 1;
    if (b._orderIndex === Infinity) return -1;
    return a._orderIndex - b._orderIndex;
  });
  const orderedResults = results.map(({ _orderIndex, ...r }) => r);

  let sesuai = 0, tidakSesuai = 0, perluDicek = 0, tidakDitemukan = 0, tidakDapatDiverifikasi = 0;
  let infraCount = 0, jarCount = 0;

  orderedResults.forEach(r => {
    if (r.type === 'Infrastruktur') infraCount++;
    else jarCount++;

    if (r.statusOverall === 'Sesuai') sesuai++;
    else if (r.statusOverall === 'Tidak Sesuai') tidakSesuai++;
    else if (r.statusOverall === 'Perlu Dicek') perluDicek++;
    else if (r.statusOverall === 'Tidak Ditemukan') tidakDitemukan++;
    else if (r.statusOverall === 'Tidak Dapat Diverifikasi') tidakDapatDiverifikasi++;
  });

  const stats: StrukturSummaryStats = {
    totalItems: orderedResults.length,
    sesuai,
    tidakSesuai,
    perluDicek,
    tidakDitemukan,
    tidakDapatDiverifikasi,
    infraCount,
    jarCount
  };

  return { results: orderedResults, stats, kabupaten };
}

