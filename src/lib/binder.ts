import { db, type CatalogueCard } from './db';

/**
 * Natural-order comparison for Scryfall collector numbers. They're strings, not
 * integers — "1", "2", "10", "10a", "T3", "★5" — so a plain string sort puts
 * "10" before "2". Split each into alternating digit / non-digit chunks and
 * compare piecewise: numeric chunks numerically, the rest lexically.
 */
export function compareCollector(a: string, b: string): number {
  const ax = a.match(/\d+|\D+/g) ?? [];
  const bx = b.match(/\d+|\D+/g) ?? [];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const as = ax[i] ?? '';
    const bs = bx[i] ?? '';
    const aNum = as.charCodeAt(0) >= 48 && as.charCodeAt(0) <= 57;
    const bNum = bs.charCodeAt(0) >= 48 && bs.charCodeAt(0) <= 57;
    if (aNum && bNum) {
      const d = parseInt(as, 10) - parseInt(bs, 10);
      if (d !== 0) return d;
    } else {
      const c = as.localeCompare(bs);
      if (c !== 0) return c;
    }
  }
  return ax.length - bx.length;
}

/** One set the user owns at least one card from — a spine in the binder shelf. */
export interface BinderSetSummary {
  setCode: string;
  setName: string;
  ownedDistinct: number; // distinct printings owned
  ownedCopies: number; // total physical cards
  releasedAt: string;
}

/**
 * The sets to show on the binder shelf: every set the collection has a card
 * from, newest first. We browse sets you actually own into — not all ~800 sets
 * Scryfall knows about — so the shelf stays meaningful.
 */
export async function binderSets(): Promise<BinderSetSummary[]> {
  const owned = await db.owned.toArray();
  const map = new Map<string, BinderSetSummary>();
  const distinct = new Map<string, Set<string>>();

  for (const o of owned) {
    let s = map.get(o.setCode);
    if (!s) {
      s = {
        setCode: o.setCode,
        setName: o.setName,
        ownedDistinct: 0,
        ownedCopies: 0,
        releasedAt: o.releasedAt,
      };
      map.set(o.setCode, s);
      distinct.set(o.setCode, new Set());
    }
    s.ownedCopies += o.quantity;
    distinct.get(o.setCode)!.add(o.catalogueId);
  }

  for (const [code, ids] of distinct) map.get(code)!.ownedDistinct = ids.size;

  return [...map.values()].sort(
    (a, b) => b.releasedAt.localeCompare(a.releasedAt) || a.setName.localeCompare(b.setName),
  );
}

/** A single binder pocket: a printing in the set, and how many the user owns. */
export interface BinderSlot {
  card: CatalogueCard;
  owned: number;
}

export interface BinderData {
  setCode: string;
  setName: string;
  slots: BinderSlot[]; // every printing in the set, collector-number order
  ownedDistinct: number;
  total: number;
}

/**
 * Build the full binder for one set from the local catalogue: every printing in
 * the set (including variants/tokens/promos that Scryfall bundles under the set
 * code) in collector-number order, each annotated with the owned quantity.
 * Unowned printings still get a slot — they render as an empty pocket.
 */
export async function loadBinderSet(setCode: string): Promise<BinderData | null> {
  const cards = await db.catalogue.where('setCode').equals(setCode).toArray();
  if (cards.length === 0) return null;
  cards.sort((a, b) => compareCollector(a.collectorNumber, b.collectorNumber));

  const ownedRows = await db.owned.where('setCode').equals(setCode).toArray();
  const qty = new Map<string, number>();
  for (const o of ownedRows) qty.set(o.catalogueId, (qty.get(o.catalogueId) ?? 0) + o.quantity);

  const slots: BinderSlot[] = cards.map((card) => ({ card, owned: qty.get(card.id) ?? 0 }));
  const ownedDistinct = slots.reduce((n, s) => n + (s.owned > 0 ? 1 : 0), 0);

  return { setCode, setName: cards[0]!.setName, slots, ownedDistinct, total: slots.length };
}

/** Chunk slots into fixed-size binder pages. */
export function paginate(slots: BinderSlot[], perPage: number): BinderSlot[][] {
  const pages: BinderSlot[][] = [];
  for (let i = 0; i < slots.length; i += perPage) pages.push(slots.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

export const PER_PAGE_OPTIONS = [4, 9, 12] as const;
export type PerPage = (typeof PER_PAGE_OPTIONS)[number];
