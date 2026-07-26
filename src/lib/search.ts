import type { OwnedCard } from './db';

/**
 * A Scryfall-flavoured query language over the owned collection. Terms are
 * ANDed together; each may be negated with a leading `-`. Bare words match
 * name / type / location. Supported fields:
 *   t:/type   c:/color   id:/identity   r:/rarity   s:/set
 *   cmc:/mv: (with > < >= <=)   o:/oracle   kw:/keyword   loc:/location
 */

export type QueryOp = ':' | '=' | '>' | '<' | '>=' | '<=';

export interface QueryTerm {
  field: string;
  op: QueryOp;
  value: string;
  negate: boolean;
}

export interface ParsedQuery {
  terms: QueryTerm[];
  raw: string;
}

/** Catalogue fields joined in only when a query needs them (oracle/keyword). */
export interface EnrichFields {
  oracleText: string;
  keywords: string[];
}
export type EnrichMap = Map<string, EnrichFields>;

const FIELD_ALIASES: Record<string, string> = {
  name: 'name', n: 'name',
  type: 'type', t: 'type',
  color: 'color', colors: 'color', c: 'color',
  identity: 'identity', id: 'identity', ci: 'identity',
  rarity: 'rarity', r: 'rarity',
  set: 'set', s: 'set', e: 'set', edition: 'set', expansion: 'set',
  cmc: 'cmc', mv: 'cmc', manavalue: 'cmc',
  oracle: 'oracle', o: 'oracle', text: 'oracle',
  keyword: 'keyword', kw: 'keyword',
  location: 'location', loc: 'location', l: 'location',
};

// Longest operators first so `>=` wins over `>`.
const OPS: QueryOp[] = ['>=', '<=', '>', '<', '=', ':'];

export const QUERY_HELP: { syntax: string; desc: string }[] = [
  { syntax: 't:creature', desc: 'card type' },
  { syntax: 'c:u  id:wu', desc: 'colour · colour identity' },
  { syntax: 'r:mythic', desc: 'rarity' },
  { syntax: 's:dom', desc: 'set (code or name)' },
  { syntax: 'cmc<=3', desc: 'mana value (= > < >= <=)' },
  { syntax: 'o:"draw a card"', desc: 'oracle text' },
  { syntax: 'kw:flying', desc: 'keyword' },
  { syntax: 'loc:"box a"', desc: 'location' },
  { syntax: '-t:land', desc: 'negate with a leading -' },
];

/** Split on whitespace, keeping quoted phrases intact. */
function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === ' ' && !inQuote) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function parseQuery(input: string): ParsedQuery {
  const terms: QueryTerm[] = [];
  for (let tok of tokenize(input.trim())) {
    if (!tok) continue;
    let negate = false;
    if (tok.startsWith('-') && tok.length > 1) {
      negate = true;
      tok = tok.slice(1);
    }

    let matched: QueryTerm | null = null;
    for (const op of OPS) {
      const idx = tok.indexOf(op);
      if (idx <= 0) continue;
      const field = FIELD_ALIASES[tok.slice(0, idx).toLowerCase()];
      if (!field) continue;
      matched = { field, op, value: tok.slice(idx + op.length), negate };
      break;
    }
    terms.push(matched ?? { field: 'text', op: ':', value: tok, negate });
  }
  return { terms, raw: input };
}

/** True when the query touches catalogue-only fields (oracle text / keywords). */
export function queryNeedsEnrich(q: ParsedQuery): boolean {
  return q.terms.some((t) => t.field === 'oracle' || t.field === 'keyword');
}

function cmpNum(a: number, op: QueryOp, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return a === b;
  }
}

function matchColors(colors: string[], value: string): boolean {
  const have = new Set(colors.map((c) => c.toUpperCase()));
  const v = value.toLowerCase();
  if (v === 'c' || v === 'colorless' || v === 'colourless') return have.size === 0;
  const want = value.toUpperCase().replace(/[^WUBRG]/g, '').split('');
  if (want.length === 0) return false;
  return want.every((l) => have.has(l));
}

function termMatches(o: OwnedCard, t: QueryTerm, enrich?: EnrichMap): boolean {
  const v = t.value.toLowerCase();
  let res: boolean;
  switch (t.field) {
    case 'text':
      res =
        o.name.toLowerCase().includes(v) ||
        o.typeLine.toLowerCase().includes(v) ||
        (o.location ?? '').toLowerCase().includes(v);
      break;
    case 'name':
      res = o.name.toLowerCase().includes(v);
      break;
    case 'type':
      res = o.typeLine.toLowerCase().includes(v);
      break;
    case 'location':
      res = (o.location ?? '').toLowerCase().includes(v);
      break;
    case 'rarity':
      res = o.rarity.toLowerCase().startsWith(v);
      break;
    case 'set':
      res = o.setCode.toLowerCase() === v || o.setName.toLowerCase().includes(v);
      break;
    case 'color':
      res = matchColors(o.colors, t.value);
      break;
    case 'identity':
      res = matchColors(o.colorIdentity.split(''), t.value);
      break;
    case 'cmc': {
      const n = Number(t.value);
      res = Number.isFinite(n) && cmpNum(o.cmc, t.op, n);
      break;
    }
    case 'oracle': {
      const e = enrich?.get(o.catalogueId);
      res = !!e && e.oracleText.toLowerCase().includes(v);
      break;
    }
    case 'keyword': {
      const e = enrich?.get(o.catalogueId);
      res = !!e && e.keywords.some((k) => k.toLowerCase().includes(v));
      break;
    }
    default:
      res = true;
  }
  return t.negate ? !res : res;
}

export function matchesQuery(o: OwnedCard, q: ParsedQuery, enrich?: EnrichMap): boolean {
  for (const t of q.terms) if (!termMatches(o, t, enrich)) return false;
  return true;
}
