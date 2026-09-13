import Dexie, { type Table } from 'dexie';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special';
export type Finish = 'nonfoil' | 'foil' | 'etched';
export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
export type ImageSize = 'small' | 'normal';

/**
 * A card printing, projected from the Scryfall bulk catalogue at build time.
 * This is the shared reference data the whole collection points at.
 */
export interface CatalogueCard {
  id: string; // Scryfall UUID, primary key
  name: string;
  oracleId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;

  // Faceting fields (denormalised for performance)
  colorIdentity: string; // 'WUBRG' string, e.g. 'BG' (canonical order)
  colors: string[];
  rarity: Rarity;
  manaCost: string | null;
  cmc: number;
  typeLine: string;
  power: string | null; // creatures; string because of '*', '1+*', etc.
  toughness: string | null;
  loyalty: string | null; // planeswalkers

  // Display + offline
  imgSmall: string; // Scryfall URL fetched at import time
  imgNormal: string; // Scryfall URL fetched on demand
  priceEur: number | null; // Reference price from Scryfall bulk data

  // Metadata
  artist: string | null;
  releasedAt: string; // ISO date for sorting
  keywords: string[];
  oracleText: string | null;
}

/**
 * A copy (or stack of identical copies) the user owns. Facet fields are
 * denormalised from the catalogue at import time so filtering is a single
 * indexed lookup — IndexedDB has no joins.
 */
export interface OwnedCard {
  id: string; // local UUID
  catalogueId: string; // → CatalogueCard.id

  // User inputs
  quantity: number;
  finish: Finish;
  condition: Condition;

  // Metadata
  tags: string[]; // 'binder-1', 'trade', etc.
  notes: string | null;
  location: string | null; // physical storage, e.g. from the CSV's Location column

  // Denormalised for faceting (sync with catalogue on import)
  name: string; // for name search + sort without a join
  typeLine: string; // for type search
  colorIdentity: string;
  colors: string[];
  rarity: Rarity;
  cmc: number;
  setCode: string;
  setName: string;
  releasedAt: string;
  priceEur: number | null;

  // Bookkeeping
  importedAt: number; // epoch ms
  importId: string; // which CSV import this came from
}

export interface CardImage {
  key: string; // `${catalogueId}:${size}`
  catalogueId: string;
  size: ImageSize;
  blob: Blob;
  fetchedAt: number;
}

export interface ImportRecord {
  id: string;
  filename: string;
  importedAt: number;
  cardCount: number;
  imagesFetched: number;
  imagesFailed: number;
}

/** App-level key/value settings (single-row-ish store). */
export interface AppMeta {
  key: string;
  value: unknown;
}

/** The deck-building roles a card can fill, matched to common EDH ratios. */
export type RoleId = 'land' | 'ramp' | 'draw' | 'removal' | 'wipe' | 'synergy' | 'wincon';

/** A single card slotted into a deck under one role. */
export interface DeckEntry {
  catalogueId: string;
  role: RoleId;
  quantity: number; // usually 1 (singleton), but basics can stack
}

/**
 * A Commander deck built around a chosen legendary. The commander fixes the
 * colour-identity rules; the strategy fixes per-role target counts (editable);
 * themes drive which owned cards count towards the synergy role.
 */
export interface Deck {
  id: string;
  name: string;
  commanderId: string; // → CatalogueCard.id
  colorIdentity: string; // derived from the commander, canonical WUBRG
  strategyId: string; // which template the targets came from
  targets: Record<RoleId, number>; // editable copy of the strategy's ratios
  themes: string[]; // selected synergy theme ids
  entries: DeckEntry[];
  createdAt: number;
  updatedAt: number;
}

export class CollectionDB extends Dexie {
  catalogue!: Table<CatalogueCard, string>;
  owned!: Table<OwnedCard, string>;
  images!: Table<CardImage, string>;
  imports!: Table<ImportRecord, string>;
  meta!: Table<AppMeta, string>;
  decks!: Table<Deck, string>;

  constructor() {
    super('mtg-collection');
    this.version(1).stores({
      catalogue: 'id, name, oracleId, setCode, [setCode+collectorNumber]',
      owned:
        'id, catalogueId, name, colorIdentity, rarity, cmc, setCode, finish, condition, releasedAt, importedAt, *tags, importId',
      images: 'key, catalogueId',
      imports: 'id, importedAt',
      meta: 'key',
    });
    // v2: decks for the Commander deck-builder. Purely additive — existing
    // stores are carried forward untouched.
    this.version(2).stores({
      decks: 'id, name, commanderId, updatedAt',
    });
  }
}

export const db = new CollectionDB();

export const imageKey = (catalogueId: string, size: ImageSize): string =>
  `${catalogueId}:${size}`;

/** Rarity ordering for sort. */
export const RARITY_ORDER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  mythic: 3,
  special: 4,
};
