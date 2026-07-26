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

export class CollectionDB extends Dexie {
  catalogue!: Table<CatalogueCard, string>;
  owned!: Table<OwnedCard, string>;
  images!: Table<CardImage, string>;
  imports!: Table<ImportRecord, string>;
  meta!: Table<AppMeta, string>;

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
