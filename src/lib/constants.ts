import type { Condition, Finish } from './db';
import type { SortKey } from './query';

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

export const RARITIES: { value: string; label: string }[] = [
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'mythic', label: 'Mythic' },
];

export const CARD_TYPES = [
  'Creature',
  'Sorcery',
  'Instant',
  'Artifact',
  'Enchantment',
  'Land',
  'Planeswalker',
] as const;

export const FINISHES: { value: Finish; label: string }[] = [
  { value: 'nonfoil', label: 'Nonfoil' },
  { value: 'foil', label: 'Foil' },
  { value: 'etched', label: 'Etched' },
];

export const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'NM', label: 'NM' },
  { value: 'LP', label: 'LP' },
  { value: 'MP', label: 'MP' },
  { value: 'HP', label: 'HP' },
  { value: 'DMG', label: 'DMG' },
];

export const CMC_MAX = 16;

export const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: 'asc' | 'desc' }[] = [
  { key: 'name', label: 'Name (A–Z)', defaultDir: 'asc' },
  { key: 'cmc', label: 'Mana Value', defaultDir: 'asc' },
  { key: 'rarity', label: 'Rarity', defaultDir: 'asc' },
  { key: 'released', label: 'Set release', defaultDir: 'desc' },
  { key: 'added', label: 'Recently added', defaultDir: 'desc' },
  { key: 'quantity', label: 'Quantity', defaultDir: 'desc' },
];

export const RARITY_LABEL: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic',
  special: 'Special',
};

export function formatEur(n: number): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n);
}
