/**
 * Scryfall card → CatalogueCard projection, shared by the offline catalogue
 * build (scripts/build-catalogue.ts) and the in-app online fallback used when
 * an import row can't be matched locally. Keep it free of browser/Node APIs.
 */
import type { CatalogueCard, Rarity } from './db';

export interface ScryfallImageUris {
  small?: string;
  normal?: string;
}
export interface ScryfallFace {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ScryfallImageUris;
  colors?: string[];
  artist?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
}
export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  set: string;
  set_name: string;
  collector_number: string;
  color_identity: string[];
  colors?: string[];
  rarity: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallFace[];
  prices?: { eur?: string | null };
  artist?: string;
  released_at: string;
  keywords?: string[];
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  games?: string[];
  digital?: boolean;
  cardmarket_id?: number;
}

const WUBRG = ['W', 'U', 'B', 'R', 'G'];
function sortColorIdentity(ci: string[]): string {
  return WUBRG.filter((c) => ci.includes(c)).join('');
}

function normalizeRarity(r: string): Rarity {
  // Scryfall uses common|uncommon|rare|mythic|special|bonus.
  return (r === 'bonus' ? 'special' : r) as Rarity;
}

function pickImages(card: ScryfallCard): { small: string; normal: string } {
  const top = card.image_uris;
  if (top?.small || top?.normal) {
    return { small: top.small ?? '', normal: top.normal ?? top.small ?? '' };
  }
  // Double-faced cards carry images per face; use the front face.
  const face = card.card_faces?.[0]?.image_uris;
  if (face?.small || face?.normal) {
    return { small: face.small ?? '', normal: face.normal ?? face.small ?? '' };
  }
  return { small: '', normal: '' };
}

/** Project a Scryfall card, or null if it isn't an English paper printing. */
export function projectCard(card: ScryfallCard): CatalogueCard | null {
  // English, paper printings only. This keeps the catalogue near ~110k cards.
  if (card.lang !== 'en') return null;
  if (card.digital) return null;
  if (card.games && !card.games.includes('paper')) return null;

  const { small, normal } = pickImages(card);

  const manaCost =
    card.mana_cost && card.mana_cost.length > 0
      ? card.mana_cost
      : card.card_faces?.[0]?.mana_cost || null;

  const oracleText =
    card.oracle_text ??
    (card.card_faces
      ? card.card_faces
          .map((f) => f.oracle_text)
          .filter(Boolean)
          .join('\n//\n')
      : null) ??
    null;

  const eur = card.prices?.eur;
  const priceEur = eur != null && eur !== '' ? Number(eur) : null;

  // Per-face names let imports match "Delver of Secrets" against
  // "Delver of Secrets // Insectile Aberration".
  const faceNames = (card.card_faces ?? [])
    .map((f) => f.name)
    .filter((n): n is string => !!n && n !== card.name);

  return {
    id: card.id,
    name: card.name,
    oracleId: card.oracle_id ?? '',
    setCode: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    cardmarketId: card.cardmarket_id ?? null,
    faceNames,
    colorIdentity: sortColorIdentity(card.color_identity ?? []),
    colors: card.colors ?? card.card_faces?.[0]?.colors ?? [],
    rarity: normalizeRarity(card.rarity),
    manaCost,
    cmc: card.cmc ?? 0,
    typeLine: card.type_line ?? card.card_faces?.[0]?.type_line ?? '',
    power: card.power ?? card.card_faces?.[0]?.power ?? null,
    toughness: card.toughness ?? card.card_faces?.[0]?.toughness ?? null,
    loyalty: card.loyalty ?? card.card_faces?.[0]?.loyalty ?? null,
    imgSmall: small,
    imgNormal: normal || small,
    priceEur: priceEur != null && Number.isFinite(priceEur) ? priceEur : null,
    artist: card.artist ?? card.card_faces?.[0]?.artist ?? null,
    releasedAt: card.released_at,
    keywords: card.keywords ?? [],
    oracleText,
  };
}
