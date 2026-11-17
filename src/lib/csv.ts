import Papa from 'papaparse';
import { distance } from 'fastest-levenshtein';
import { db, type CatalogueCard, type Condition, type Finish } from './db';
import { projectCard, type ScryfallCard } from './projection';
import {
  COLLECTION_BATCH,
  fetchCardById,
  fetchCardByCardmarketId,
  fetchCardNamed,
  fetchCollection,
  fetchSets,
  type CollectionIdentifier,
} from './scryfall';

export type NormalizedField =
  | 'quantity'
  | 'scryfallId'
  | 'cardmarketId'
  | 'name'
  | 'expansion'
  | 'finish'
  | 'condition'
  | 'language'
  | 'location';

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
  location: ['location', 'storage', 'position', 'box', 'binder', 'folder', 'slot', 'shelf'],
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

// ── Name normalisation ──────────────────────────────────────────────

/** Canonical key for comparing card names: no accents, straight quotes, lowercase. */
export function nameKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/æ/gi, 'ae')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const setKey = (s: string): string => norm(nameKey(s)).replace(/\s+/g, ' ');

/** Strip exporter suffixes: Cardmarket's "(V.1)" art versions, token "(G 1/1)", "Token". */
function cleanName(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+token$/i, '')
    .trim();
}

/**
 * Name keys to try for a CSV name, most specific first: as written, with
 * exporter suffixes removed, then just the front face of a multi-face card.
 */
export function nameVariants(raw: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const k = nameKey(s);
    if (k && !out.includes(k)) out.push(k);
  };
  push(raw);
  push(raw.replace(/\s*\([^)]*\)\s*$/, ''));
  const cleaned = cleanName(raw);
  push(cleaned);
  push(cleaned.split(/\s+\/\/?\s+/)[0] ?? ''); // "A // B" or "A / B"
  return out;
}

// ── Matching ────────────────────────────────────────────────────────

export type MatchStatus = 'matched' | 'unmatched' | 'skipped';

/** How a row was matched, most to least certain. */
export type MatchMethod =
  | 'remembered'
  | 'scryfallId'
  | 'cardmarketId'
  | 'nameSet'
  | 'name'
  | 'online'
  | 'manual';

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
  expansion: string;
  scryfallId: string | null;
  cardmarketId: number | null;
  quantity: number;
  finish: Finish;
  condition: Condition;
  location: string | null;
  language: string | null; // set only for non-English rows
  status: MatchStatus;
  method?: MatchMethod;
  /** Matched by name, but the CSV's set wasn't found — the printing may differ. */
  printingGuessed?: boolean;
  catalogueId?: string; // chosen match
  candidates: MatchCandidate[]; // alternatives for the user to pick from
  reason?: string;
}

interface CompactEntry {
  id: string;
  name: string;
  setName: string;
  setKey: string;
  setCode: string;
  collectorNumber: string;
}

interface CatalogueIndex {
  byName: Map<string, CompactEntry[]>; // name keys, including per-face names
  byCardmarket: Map<number, CompactEntry>;
  ids: Set<string>;
  setCodes: Map<string, string>; // setKey(set name) → set code
}

/** Build a compact in-memory index of the catalogue for fast matching. */
async function buildIndex(): Promise<CatalogueIndex> {
  const byName = new Map<string, CompactEntry[]>();
  const byCardmarket = new Map<number, CompactEntry>();
  const ids = new Set<string>();
  const setCodes = new Map<string, string>();
  await db.catalogue.each((c) => {
    const entry: CompactEntry = {
      id: c.id,
      name: c.name,
      setName: c.setName,
      setKey: setKey(c.setName),
      setCode: c.setCode.toLowerCase(),
      collectorNumber: c.collectorNumber,
    };
    ids.add(c.id);
    setCodes.set(entry.setKey, entry.setCode);
    if (c.cardmarketId != null && !byCardmarket.has(c.cardmarketId)) byCardmarket.set(c.cardmarketId, entry);
    // Catalogues built before faceNames existed still get the front face.
    const keys = new Set([c.name, c.name.split(' // ')[0] ?? '', ...(c.faceNames ?? [])].map(nameKey));
    for (const k of keys) {
      if (!k) continue;
      const list = byName.get(k);
      if (list) list.push(entry);
      else byName.set(k, [entry]);
    }
  });
  return { byName, byCardmarket, ids, setCodes };
}

// Reused by resolveOnline() straight after matchRows(); cleared when the
// catalogue gains cards.
let lastIndex: CatalogueIndex | null = null;

const toCandidate = (e: CompactEntry | CatalogueCard): MatchCandidate => ({
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

// ── Remembered resolutions ──────────────────────────────────────────
// Rows the user picked by hand (or that were found online) are remembered by
// name + set, so the next import or sync places them without asking again.

const MEMORY_KEY = 'matchMemory';
type MatchMemory = Record<string, string>;

const memoryKey = (r: Pick<MatchResult, 'rawName' | 'expansion'>): string =>
  `${nameKey(r.rawName)}|${setKey(r.expansion)}`;

async function loadMemory(): Promise<MatchMemory> {
  const row = await db.meta.get(MEMORY_KEY);
  return (row?.value as MatchMemory | undefined) ?? {};
}

export async function rememberMatches(results: MatchResult[]): Promise<void> {
  const memory = await loadMemory();
  let changed = false;
  for (const r of results) {
    if (r.status !== 'matched' || !r.catalogueId || !r.rawName) continue;
    if (r.method !== 'manual' && r.method !== 'online') continue;
    memory[memoryKey(r)] = r.catalogueId;
    changed = true;
  }
  if (changed) await db.meta.put({ key: MEMORY_KEY, value: memory });
}

export interface MatchOptions {
  onProgress?: (done: number, total: number) => void;
}

function matchOne(base: MatchResult, index: CatalogueIndex, memory: MatchMemory): MatchResult {
  const hit = (id: string, method: MatchMethod, extra: Partial<MatchResult> = {}): MatchResult => ({
    ...base,
    status: 'matched',
    catalogueId: id,
    method,
    ...extra,
  });

  if (!base.rawName && !base.scryfallId && base.cardmarketId == null) {
    return { ...base, reason: 'Row has no name or ID' };
  }

  // 1. Exact identifiers.
  const remembered = memory[memoryKey(base)];
  if (base.rawName && remembered && index.ids.has(remembered)) return hit(remembered, 'remembered');
  if (base.scryfallId && index.ids.has(base.scryfallId)) return hit(base.scryfallId, 'scryfallId');
  if (base.cardmarketId != null) {
    const e = index.byCardmarket.get(base.cardmarketId);
    if (e) return hit(e.id, 'cardmarketId');
  }

  if (!base.rawName) return { ...base, reason: 'ID not in the local catalogue' };

  // 2. Name (+ set). TCGPowertools "Expansion" is usually the set name.
  const variants = nameVariants(base.rawName);
  const exp = setKey(base.expansion);
  for (const key of variants) {
    const nameHits = index.byName.get(key);
    if (!nameHits?.length) continue;
    if (exp) {
      const inSet = nameHits.filter((e) => e.setKey === exp || e.setCode === exp);
      if (inSet.length > 0) return hit(pickPrinting(inSet).id, 'nameSet');
    }
    // Name matches but the set doesn't (or wasn't given) — pick a printing,
    // still exposing the alternatives as candidates.
    return hit(pickPrinting(nameHits).id, 'name', {
      printingGuessed: !!exp,
      candidates: nameHits.slice(0, 8).map(toCandidate),
    });
  }

  // 3. Fuzzy fallback — top 3 closest distinct names.
  const target = variants[variants.length - 1] ?? nameKey(base.rawName);
  const scored: { key: string; d: number }[] = [];
  for (const key of index.byName.keys()) {
    if (Math.abs(key.length - target.length) > 3) continue;
    const d = distance(target, key);
    if (d <= 3) scored.push({ key, d });
  }
  scored.sort((a, b) => a.d - b.d);
  const candidates = scored.slice(0, 3).map((s) => toCandidate(pickPrinting(index.byName.get(s.key)!)));
  return { ...base, candidates, reason: candidates.length ? 'No exact match' : 'No match found' };
}

export async function matchRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  opts: MatchOptions = {},
): Promise<MatchResult[]> {
  const index = await buildIndex();
  lastIndex = index;
  const memory = await loadMemory();
  const results: MatchResult[] = [];

  const col = (row: Record<string, string>, field: NormalizedField): string => {
    const key = mapping[field];
    return ((key ? row[key] : undefined) ?? '').trim();
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const cm = parseInt(col(row, 'cardmarketId'), 10);
    const language = col(row, 'language');
    const base: MatchResult = {
      rowIndex: i,
      rawName: col(row, 'name'),
      expansion: col(row, 'expansion'),
      scryfallId: col(row, 'scryfallId') || null,
      cardmarketId: Number.isFinite(cm) && cm > 0 ? cm : null,
      quantity: parseQuantity(col(row, 'quantity')),
      finish: parseFinish(col(row, 'finish')),
      condition: parseCondition(col(row, 'condition')),
      location: col(row, 'location') || null,
      // Non-English rows still match: the collection tracks the English
      // printing, and exports carry the English name.
      language: isEnglish(language) ? null : language,
      status: 'unmatched',
      candidates: [],
    };
    results.push(matchOne(base, index, memory));
    opts.onProgress?.(i + 1, rows.length);
  }

  return results;
}

// ── Online fallback ─────────────────────────────────────────────────

export interface OnlineProgress {
  done: number;
  total: number;
}

export interface OnlineSummary {
  resolved: number; // unmatched rows now matched
  refined: number; // guessed printings replaced by the CSV's actual printing
  suggested: number; // rows with a fuzzy suggestion awaiting confirmation
  failed: number; // requests that errored
}

/**
 * Look up rows the local catalogue couldn't place: unmatched rows, plus
 * name-only matches whose set (or Cardmarket id) the catalogue doesn't know,
 * which usually means a set newer than the catalogue build. Found printings are
 * added to the local catalogue so the import can reference them.
 *
 * Order: Scryfall/Cardmarket id → batched name+set lookup → fuzzy name. A
 * fuzzy hit whose name differs from the CSV is offered as a candidate rather
 * than accepted.
 */
export async function resolveOnline(
  results: MatchResult[],
  opts: { onProgress?: (p: OnlineProgress) => void; signal?: AbortSignal } = {},
): Promise<{ results: MatchResult[]; summary: OnlineSummary }> {
  const { signal } = opts;
  const index = lastIndex ?? (await buildIndex());

  // Set name → code, including sets newer than the local catalogue.
  const setCodes = new Map(index.setCodes);
  const localCodes = new Set(index.setCodes.values());
  try {
    for (const s of await fetchSets(signal)) {
      const k = setKey(s.name);
      if (!setCodes.has(k)) setCodes.set(k, s.code);
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    // fetch() rejects with a TypeError only when the network itself failed.
    throw new Error(
      e instanceof TypeError
        ? 'Couldn’t reach Scryfall. Check your connection and try again.'
        : `Scryfall lookup failed: ${(e as Error).message}`,
    );
  }
  const allCodes = new Set(setCodes.values());
  const codeFor = (r: MatchResult): string | undefined => {
    if (!r.expansion) return undefined;
    const k = setKey(r.expansion);
    return setCodes.get(k) ?? (allCodes.has(k) ? k : undefined);
  };

  const out = results.map((r) => ({ ...r }));
  const found = new Map<string, CatalogueCard>();
  const settled = new Set<MatchResult>();
  const summary: OnlineSummary = { resolved: 0, refined: 0, suggested: 0, failed: 0 };

  const accept = (r: MatchResult, card: ScryfallCard | null, guessed: boolean): boolean => {
    const cat = card ? projectCard(card) : null;
    if (!cat) return false;
    found.set(cat.id, cat);
    if (r.status === 'unmatched') summary.resolved++;
    else summary.refined++;
    Object.assign(r, { status: 'matched', catalogueId: cat.id, method: 'online', printingGuessed: guessed, reason: undefined });
    settled.add(r);
    return true;
  };

  const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted) throw e;
      summary.failed++;
      return null;
    }
  };

  let done = 0;
  let total = 0;
  const tick = () => opts.onProgress?.({ done: ++done, total });

  const unmatched = out.filter((r) => r.status === 'unmatched');
  const guessed = out.filter((r) => {
    if (r.status !== 'matched' || !r.printingGuessed) return false;
    const code = codeFor(r);
    if (code && !localCodes.has(code)) return true;
    // An id the catalogue has never seen is a printing newer than the build.
    return r.cardmarketId != null && index.byCardmarket.size > 0;
  });
  const targets = [...unmatched, ...guessed];

  // 1. Exact ids, one request each.
  const withIds = targets.filter((r) => (r.status === 'unmatched' && r.scryfallId) || r.cardmarketId != null);
  total = withIds.length;
  opts.onProgress?.({ done, total });
  for (const r of withIds) {
    let card: ScryfallCard | null = null;
    if (r.scryfallId && r.status === 'unmatched') card = await safe(() => fetchCardById(r.scryfallId!, signal));
    if (!card && r.cardmarketId != null) card = await safe(() => fetchCardByCardmarketId(r.cardmarketId!, signal));
    accept(r, card, false);
    tick();
  }

  // 2. Batched name (+ set code) lookups. Guessed rows only with a set, since
  //    a name-only lookup can't improve on the guess.
  interface Group {
    ident: CollectionIdentifier;
    key: string;
    rows: MatchResult[];
    done: boolean;
  }
  const groups = new Map<string, Group>();
  for (const r of targets) {
    if (settled.has(r) || !r.rawName) continue;
    const code = codeFor(r);
    if (r.status !== 'unmatched' && !code) continue;
    const name = cleanName(r.rawName);
    const id = `${nameKey(name)}|${code ?? ''}`;
    const g = groups.get(id);
    if (g) g.rows.push(r);
    else groups.set(id, { ident: code ? { name, set: code } : { name }, key: nameKey(name), rows: [r], done: false });
  }
  const groupList = [...groups.values()];
  total += Math.ceil(groupList.length / COLLECTION_BATCH);
  for (let i = 0; i < groupList.length; i += COLLECTION_BATCH) {
    const batch = groupList.slice(i, i + COLLECTION_BATCH);
    const cards = (await safe(() => fetchCollection(batch.map((g) => g.ident), signal))) ?? [];
    for (const card of cards) {
      const keys = new Set(
        [card.name, card.name.split(' // ')[0] ?? '', ...(card.card_faces ?? []).map((f) => f.name ?? '')].map(nameKey),
      );
      for (const g of batch) {
        if (g.done || !keys.has(g.key)) continue;
        if (g.ident.set && g.ident.set !== card.set) continue;
        g.done = true;
        for (const r of g.rows) accept(r, card, !g.ident.set && !!r.expansion);
      }
    }
    tick();
  }

  // 3. Fuzzy name for whatever is still unmatched.
  const rest = unmatched.filter((r) => !settled.has(r) && r.rawName);
  total += rest.length;
  const fuzzyCache = new Map<string, ScryfallCard | null>();
  for (const r of rest) {
    const name = cleanName(r.rawName);
    const code = codeFor(r);
    const cacheKey = `${nameKey(name)}|${code ?? ''}`;
    let card = fuzzyCache.get(cacheKey);
    if (card === undefined) {
      card = code ? await safe(() => fetchCardNamed(name, code, signal)) : null;
      if (!card) card = await safe(() => fetchCardNamed(name, undefined, signal));
      fuzzyCache.set(cacheKey, card);
    }
    tick();
    const cat = card ? projectCard(card) : null;
    if (!card || !cat) continue;
    const exact = nameVariants(r.rawName).some((k) => k === nameKey(card!.name) || cat.faceNames.some((f) => nameKey(f) === k));
    if (exact) {
      accept(r, card, !!r.expansion && card.set !== code);
    } else {
      // A different name: suggest it, but let the user confirm.
      found.set(cat.id, cat);
      r.candidates = [toCandidate(cat), ...r.candidates.filter((c) => c.id !== cat.id)].slice(0, 4);
      r.reason = 'Closest match on Scryfall';
      summary.suggested++;
    }
  }

  if (found.size > 0) {
    await db.catalogue.bulkPut([...found.values()]);
    lastIndex = null;
  }
  return { results: out, summary };
}
