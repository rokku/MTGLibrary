import Papa from 'papaparse';
import { distance } from 'fastest-levenshtein';
import { db, type Condition, type Finish } from './db';

export type NormalizedField =
  | 'quantity'
  | 'scryfallId'
  | 'cardmarketId'
  | 'name'
  | 'expansion'
  | 'finish'
  | 'condition'
  | 'language';

export type ColumnMapping = Partial<Record<NormalizedField, string>>;

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

// Header candidates (lowercased, punctuation-stripped) for each field.
const HEADER_CANDIDATES: Record<NormalizedField, string[]> = {
  quantity: ['quantity', 'qty', 'count', 'amount'],
  scryfallId: ['scryfallid', 'scryfall id', 'scryfall'],
  cardmarketId: ['cardmarketid', 'cardmarket id', 'productid', 'idproduct', 'mkmid'],
  name: ['name', 'cardname', 'card name', 'englishname', 'card'],
  expansion: ['expansion', 'set', 'setname', 'set name', 'edition', 'expansionname'],
  finish: ['foil', 'finish', 'isfoil', 'printing'],
  condition: ['condition', 'cond', 'grade'],
  language: ['language', 'lang'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

export function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        resolve({ headers, rows: results.data });
      },
      error: (err: unknown) => reject(err),
    });
  });
}

/** Best-guess mapping from CSV headers to normalized fields. */
export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normHeaders = headers.map((h) => ({ raw: h, norm: norm(h) }));
  for (const field of Object.keys(HEADER_CANDIDATES) as NormalizedField[]) {
    const candidates = HEADER_CANDIDATES[field];
    // Prefer an exact normalized match, then a contains match.
    const exact = normHeaders.find((h) => candidates.includes(h.norm));
    const partial = normHeaders.find((h) => candidates.some((c) => h.norm === c || h.norm.includes(c)));
    const hit = exact ?? partial;
    if (hit) mapping[field] = hit.raw;
  }
  return mapping;
}

// ── Value normalisation ─────────────────────────────────────────────

function parseQuantity(v: string | undefined): number {
  const n = parseInt((v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseFinish(v: string | undefined): Finish {
  const s = norm(v ?? '');
  if (!s) return 'nonfoil';
  if (s.includes('etched')) return 'etched';
  if (s === 'yes' || s === 'true' || s === 'y' || s === '1' || s.includes('foil')) {
    // "nonfoil" contains "foil" — guard against it.
    if (s.includes('non')) return 'nonfoil';
    return 'foil';
  }
  return 'nonfoil';
}

const CONDITION_MAP: Record<string, Condition> = {
  m: 'NM',
  mt: 'NM',
  mint: 'NM',
  nm: 'NM',
  nearmint: 'NM',
  ex: 'LP',
  excellent: 'LP',
  lp: 'LP',
  lightplayed: 'LP',
  light: 'LP',
  gd: 'MP',
  good: 'MP',
  mp: 'MP',
  moderatelyplayed: 'MP',
  pl: 'HP',
  played: 'HP',
  hp: 'HP',
  heavilyplayed: 'HP',
  poor: 'DMG',
  po: 'DMG',
  dmg: 'DMG',
  damaged: 'DMG',
};

function parseCondition(v: string | undefined): Condition {
  const s = norm(v ?? '').replace(/\s/g, '');
  return CONDITION_MAP[s] ?? 'NM';
}

function isEnglish(v: string | undefined): boolean {
  const s = norm(v ?? '');
  if (!s) return true; // assume English when unspecified
  return s === 'en' || s === 'eng' || s === 'english';
}

// ── Matching ────────────────────────────────────────────────────────

export type MatchStatus = 'matched' | 'unmatched' | 'skipped';

export interface MatchCandidate {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
}

export interface MatchResult {
  rowIndex: number;
  rawName: string;
  quantity: number;
  finish: Finish;
  condition: Condition;
  status: MatchStatus;
  catalogueId?: string; // chosen match
  candidates: MatchCandidate[]; // for user pick when unmatched
  reason?: string;
}

interface CompactEntry {
  id: string;
  name: string;
  nameLower: string;
  setName: string;
  setNameLower: string;
  setCode: string;
  collectorNumber: string;
}

/** Build a compact in-memory index of the catalogue for fast matching. */
async function buildIndex(): Promise<{
  byName: Map<string, CompactEntry[]>;
  all: CompactEntry[];
}> {
  const byName = new Map<string, CompactEntry[]>();
  const all: CompactEntry[] = [];
  await db.catalogue.each((c) => {
    const entry: CompactEntry = {
      id: c.id,
      name: c.name,
      nameLower: c.name.toLowerCase(),
      setName: c.setName,
      setNameLower: c.setName.toLowerCase(),
      setCode: c.setCode.toLowerCase(),
      collectorNumber: c.collectorNumber,
    };
    all.push(entry);
    const list = byName.get(entry.nameLower);
    if (list) list.push(entry);
    else byName.set(entry.nameLower, [entry]);
  });
  return { byName, all };
}

const toCandidate = (e: CompactEntry): MatchCandidate => ({
  id: e.id,
  name: e.name,
  setName: e.setName,
  setCode: e.setCode,
  collectorNumber: e.collectorNumber,
});

// Prefer the lowest collector number for a stable, canonical printing choice.
function pickPrinting(entries: CompactEntry[]): CompactEntry {
  return [...entries].sort((a, b) => {
    const na = parseInt(a.collectorNumber, 10);
    const nb = parseInt(b.collectorNumber, 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.collectorNumber.localeCompare(b.collectorNumber);
  })[0]!;
}

export interface MatchOptions {
  onProgress?: (done: number, total: number) => void;
}

export async function matchRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  opts: MatchOptions = {},
): Promise<MatchResult[]> {
  const { byName, all } = await buildIndex();
  const results: MatchResult[] = [];

  const col = (row: Record<string, string>, field: NormalizedField): string | undefined => {
    const key = mapping[field];
    return key ? row[key] : undefined;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rawName = (col(row, 'name') ?? '').trim();
    const quantity = parseQuantity(col(row, 'quantity'));
    const finish = parseFinish(col(row, 'finish'));
    const condition = parseCondition(col(row, 'condition'));
    const language = col(row, 'language');

    const base: MatchResult = {
      rowIndex: i,
      rawName,
      quantity,
      finish,
      condition,
      status: 'unmatched',
      candidates: [],
    };

    if (!isEnglish(language)) {
      results.push({ ...base, status: 'skipped', reason: 'Non-English printing' });
      opts.onProgress?.(i + 1, rows.length);
      continue;
    }

    // 1. Direct Scryfall ID match.
    const scryfallId = (col(row, 'scryfallId') ?? '').trim();
    if (scryfallId) {
      const hit = await db.catalogue.get(scryfallId);
      if (hit) {
        results.push({ ...base, status: 'matched', catalogueId: hit.id });
        opts.onProgress?.(i + 1, rows.length);
        continue;
      }
      // Valid-looking ID we can't resolve locally — leave for user/online.
    }

    // 2. Name + expansion (TCGPowertools "Expansion" is usually the set name).
    if (rawName) {
      const nameHits = byName.get(rawName.toLowerCase());
      if (nameHits && nameHits.length > 0) {
        const expansion = norm(col(row, 'expansion') ?? '');
        if (expansion) {
          const inSet = nameHits.filter(
            (e) => e.setNameLower === expansion || e.setCode === expansion,
          );
          if (inSet.length > 0) {
            results.push({ ...base, status: 'matched', catalogueId: pickPrinting(inSet).id });
            opts.onProgress?.(i + 1, rows.length);
            continue;
          }
        }
        // Name matches but set doesn't (or wasn't given) — pick a printing,
        // still exposing the alternatives as candidates.
        results.push({
          ...base,
          status: 'matched',
          catalogueId: pickPrinting(nameHits).id,
          candidates: nameHits.slice(0, 8).map(toCandidate),
        });
        opts.onProgress?.(i + 1, rows.length);
        continue;
      }

      // 3. Fuzzy fallback — top 3 closest names.
      const scored: { e: CompactEntry; d: number }[] = [];
      const target = rawName.toLowerCase();
      for (const e of all) {
        const d = distance(target, e.nameLower);
        if (d <= 3) scored.push({ e, d });
      }
      scored.sort((a, b) => a.d - b.d);
      const seen = new Set<string>();
      const candidates: MatchCandidate[] = [];
      for (const { e } of scored) {
        if (seen.has(e.nameLower)) continue;
        seen.add(e.nameLower);
        candidates.push(toCandidate(e));
        if (candidates.length >= 3) break;
      }
      results.push({
        ...base,
        status: 'unmatched',
        candidates,
        reason: candidates.length ? 'No exact match' : 'No match found',
      });
      opts.onProgress?.(i + 1, rows.length);
      continue;
    }

    results.push({ ...base, status: 'unmatched', reason: 'Row has no name or Scryfall ID' });
    opts.onProgress?.(i + 1, rows.length);
  }

  return results;
}
