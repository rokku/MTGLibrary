import { db, RARITY_ORDER, type Condition, type Finish, type OwnedCard } from './db';
import { matchesQuery, parseQuery, type EnrichMap } from './search';

export type SortKey =
  | 'name'
  | 'cmc'
  | 'rarity'
  | 'released'
  | 'added'
  | 'quantity';

export interface SortSpec {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export interface ActiveFilters {
  colors: string[]; // color-identity letters; AND semantics (superset)
  rarities: string[]; // OR
  sets: string[]; // set codes; OR
  types: string[]; // OR, substring of typeLine
  cmcMin: number | null;
  cmcMax: number | null;
  finishes: Finish[]; // OR
  conditions: Condition[]; // OR
  tags: string[]; // OR
  search: string;
}

export const EMPTY_FILTERS: ActiveFilters = {
  colors: [],
  rarities: [],
  sets: [],
  types: [],
  cmcMin: null,
  cmcMax: null,
  finishes: [],
  conditions: [],
  tags: [],
  search: '',
};

export function hasActiveFilters(f: ActiveFilters): boolean {
  return (
    f.colors.length > 0 ||
    f.rarities.length > 0 ||
    f.sets.length > 0 ||
    f.types.length > 0 ||
    f.cmcMin != null ||
    f.cmcMax != null ||
    f.finishes.length > 0 ||
    f.conditions.length > 0 ||
    f.tags.length > 0 ||
    f.search.trim().length > 0
  );
}

/** One grid/list tile: all owned copies of a single catalogue card, aggregated. */
export interface GroupedCard {
  catalogueId: string;
  name: string;
  typeLine: string;
  colorIdentity: string;
  rarity: string;
  cmc: number;
  setCode: string;
  setName: string;
  releasedAt: string;
  priceEur: number | null;
  totalQty: number;
  valueEur: number;
  latestImportedAt: number;
  copies: OwnedCard[];
}

/** Does a single owned copy pass the copy-level facets (finish/condition/tags)? */
function copyPasses(o: OwnedCard, f: ActiveFilters): boolean {
  if (f.finishes.length && !f.finishes.includes(o.finish)) return false;
  if (f.conditions.length && !f.conditions.includes(o.condition)) return false;
  if (f.tags.length && !f.tags.some((t) => o.tags.includes(t))) return false;
  return true;
}

/** Card-level GUI facets (color/rarity/set/type/cmc). Free-text search is
 *  handled separately by the query language (see search.ts). */
function cardPasses(o: OwnedCard, f: ActiveFilters): boolean {
  if (f.colors.length && !f.colors.every((c) => o.colorIdentity.includes(c))) return false;
  if (f.rarities.length && !f.rarities.includes(o.rarity)) return false;
  if (f.sets.length && !f.sets.includes(o.setCode)) return false;
  if (f.types.length) {
    const tl = o.typeLine.toLowerCase();
    if (!f.types.some((t) => tl.includes(t.toLowerCase()))) return false;
  }
  if (f.cmcMin != null && o.cmc < f.cmcMin) return false;
  if (f.cmcMax != null && o.cmc > f.cmcMax) return false;
  return true;
}

function compareGroups(a: GroupedCard, b: GroupedCard, sort: SortSpec): number {
  let n = 0;
  switch (sort.key) {
    case 'name':
      n = a.name.localeCompare(b.name);
      break;
    case 'cmc':
      n = a.cmc - b.cmc || a.name.localeCompare(b.name);
      break;
    case 'rarity':
      n = (RARITY_ORDER[a.rarity] ?? 0) - (RARITY_ORDER[b.rarity] ?? 0) || a.name.localeCompare(b.name);
      break;
    case 'released':
      n = a.releasedAt.localeCompare(b.releasedAt) || a.name.localeCompare(b.name);
      break;
    case 'added':
      n = a.latestImportedAt - b.latestImportedAt || a.name.localeCompare(b.name);
      break;
    case 'quantity':
      n = a.totalQty - b.totalQty || a.name.localeCompare(b.name);
      break;
  }
  return sort.dir === 'asc' ? n : -n;
}

/**
 * Query + group the owned collection. A full scan over owned rows (≤ a few
 * thousand) filtered in JS is well under the 200ms budget and keeps multi-facet
 * AND/OR semantics simple and correct.
 */
export function queryLibrary(
  all: OwnedCard[],
  filters: ActiveFilters,
  sort: SortSpec,
  enrich?: EnrichMap,
): GroupedCard[] {
  const query = parseQuery(filters.search);
  const groups = new Map<string, GroupedCard>();

  for (const o of all) {
    if (!cardPasses(o, filters)) continue;
    if (!copyPasses(o, filters)) continue;
    if (!matchesQuery(o, query, enrich)) continue;

    let g = groups.get(o.catalogueId);
    if (!g) {
      g = {
        catalogueId: o.catalogueId,
        name: o.name,
        typeLine: o.typeLine,
        colorIdentity: o.colorIdentity,
        rarity: o.rarity,
        cmc: o.cmc,
        setCode: o.setCode,
        setName: o.setName,
        releasedAt: o.releasedAt,
        priceEur: o.priceEur,
        totalQty: 0,
        valueEur: 0,
        latestImportedAt: 0,
        copies: [],
      };
      groups.set(o.catalogueId, g);
    }
    g.totalQty += o.quantity;
    if (o.priceEur) g.valueEur += o.priceEur * o.quantity;
    g.latestImportedAt = Math.max(g.latestImportedAt, o.importedAt);
    g.copies.push(o);
  }

  const list = [...groups.values()];
  list.sort((a, b) => compareGroups(a, b, sort));
  return list;
}

export interface FacetOptions {
  sets: { code: string; name: string; count: number }[];
  tags: { tag: string; count: number }[];
  rarities: string[];
}

/** Derive filter-menu options from the current collection only. */
export function facetOptions(all: OwnedCard[]): FacetOptions {
  const sets = new Map<string, { name: string; count: number }>();
  const tags = new Map<string, number>();
  const rarities = new Set<string>();
  for (const o of all) {
    const s = sets.get(o.setCode);
    if (s) s.count++;
    else sets.set(o.setCode, { name: o.setName, count: 1 });
    for (const t of o.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    rarities.add(o.rarity);
  }
  return {
    sets: [...sets.entries()]
      .map(([code, v]) => ({ code, name: v.name, count: v.count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    tags: [...tags.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag)),
    rarities: [...rarities],
  };
}

/** Live snapshot of all owned rows (used by the library live query). */
export async function allOwned(): Promise<OwnedCard[]> {
  return db.owned.toArray();
}
