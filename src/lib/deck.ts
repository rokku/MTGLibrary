import { db, type CatalogueCard, type Deck, type DeckEntry, type RoleId } from './db';

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

// ── Roles ────────────────────────────────────────────────────────────

export interface RoleDef {
  id: RoleId;
  label: string;
  blurb: string;
}

/** The role slots a Commander deck is built from, in display order. */
export const ROLES: RoleDef[] = [
  { id: 'land', label: 'Lands', blurb: 'Your mana base.' },
  { id: 'ramp', label: 'Ramp', blurb: 'Mana rocks, dorks, and land fetch to get ahead.' },
  { id: 'draw', label: 'Card Draw', blurb: 'Refill your hand and out-resource the table.' },
  { id: 'removal', label: 'Spot Removal', blurb: 'Answer a single threat — destroy, exile, counter.' },
  { id: 'wipe', label: 'Board Wipes', blurb: 'Reset the board when you fall behind.' },
  { id: 'synergy', label: 'Synergy', blurb: 'Cards that push your commander’s game plan.' },
  { id: 'wincon', label: 'Win Conditions', blurb: 'Finishers that actually close the game.' },
];

export const ROLE_LABEL: Record<RoleId, string> = Object.fromEntries(
  ROLES.map((r) => [r.id, r.label]),
) as Record<RoleId, string>;

// ── Strategy templates (role ratios) ─────────────────────────────────

export interface Strategy {
  id: string;
  name: string;
  description: string;
  targets: Record<RoleId, number>; // land + … + synergy ≈ 99 (commander is the 100th)
}

/**
 * Well-known EDH deck skeletons. The classic "Command Zone" template is the
 * balanced default; the others tilt the ratios toward a play pattern. Each set
 * of targets sums to 99 so the commander completes a 100-card deck.
 */
export const STRATEGIES: Strategy[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'The classic Command Zone skeleton — a well-rounded starting point.',
    targets: { land: 38, ramp: 10, draw: 10, removal: 12, wipe: 4, synergy: 22, wincon: 3 },
  },
  {
    id: 'aggro',
    name: 'Aggro',
    description: 'Lower curve, fewer answers, more threats and synergy to close fast.',
    targets: { land: 34, ramp: 8, draw: 8, removal: 8, wipe: 2, synergy: 35, wincon: 4 },
  },
  {
    id: 'control',
    name: 'Control',
    description: 'More interaction and card draw to grind the table down.',
    targets: { land: 37, ramp: 9, draw: 12, removal: 14, wipe: 6, synergy: 19, wincon: 2 },
  },
  {
    id: 'combo',
    name: 'Combo / Midrange',
    description: 'Extra draw and ramp to find and deploy your key pieces.',
    targets: { land: 35, ramp: 11, draw: 13, removal: 10, wipe: 3, synergy: 23, wincon: 4 },
  },
];

export const strategyById = (id: string): Strategy =>
  STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0]!;

export const DECK_SIZE = 99; // excluding the commander

// ── Synergy themes ───────────────────────────────────────────────────

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  /** Signatures that mark a card (or the commander) as belonging to this theme. */
  signatures: RegExp[];
}

/**
 * A card matches a theme when its (lowercased) oracle text or type line hits any
 * signature. The same signatures score the commander so we can suggest themes.
 */
export const THEMES: Theme[] = [
  {
    id: 'tokens',
    name: 'Tokens',
    blurb: 'Go wide with creature tokens.',
    signatures: [/create .*token/, /creature token/, /tokens? (are|is|would be) created/, /populate/, /amass/, /for each creature you control/],
  },
  {
    id: 'counters',
    name: '+1/+1 Counters',
    blurb: 'Grow creatures with counters.',
    signatures: [/\+1\/\+1 counter/, /proliferate/, /counter on/],
  },
  {
    id: 'aristocrats',
    name: 'Sacrifice / Death',
    blurb: 'Sacrifice creatures and cash in on death triggers.',
    signatures: [
      /sacrifice (a|another|an|one|two|three|\d)/,
      /whenever .*dies/,
      /when(ever)? .*(creature|it) dies/,
      /dies,? /,
      /each opponent loses/,
      /when .* dies,/,
    ],
  },
  {
    id: 'blink',
    name: 'Blink / Flicker (ETB)',
    blurb: 'Re-trigger enter-the-battlefield effects.',
    signatures: [
      /flicker/,
      /exile .*, then return/,
      /exile (target|another target|up to|any number of|those).*return/,
      /return .*to the battlefield under (your|its owner'?s?) control/,
      /when(ever)? .* enters(?: the battlefield)?, /,
    ],
  },
  {
    id: 'kindred',
    name: 'Kindred / Typal',
    blurb: 'Reward sharing a creature type (tribal).',
    signatures: [
      /\bother .+ you control get/,
      /creatures you control get \+/,
      /choose a creature type/,
      /of the chosen type/,
      /creatures? of the chosen/,
      /whenever another \w+ (you control )?enters/,
      /\bother \w+ you control/,
    ],
  },
  {
    id: 'superfriends',
    name: 'Superfriends',
    blurb: 'Planeswalkers and loyalty.',
    signatures: [
      /planeswalker —/, // the card is itself a planeswalker (type line)
      /planeswalkers? you control/,
      /loyalty counter/,
      /loyalty abilit/,
      /proliferate/,
      /each planeswalker/,
      /activate .* loyalty/,
    ],
  },
  {
    id: 'spellslinger',
    name: 'Spellslinger',
    blurb: 'Instants and sorceries matter.',
    signatures: [/instant or sorcery/, /whenever you cast (an|a|your)/, /noncreature spell/, /prowess/, /magecraft/],
  },
  {
    id: 'lifegain',
    name: 'Lifegain',
    blurb: 'Gaining life powers your engine.',
    signatures: [/gain \d* ?life/, /gain life/, /whenever you gain life/, /lifelink/],
  },
  {
    id: 'graveyard',
    name: 'Graveyard / Reanimator',
    blurb: 'Recur and reanimate from the yard.',
    signatures: [
      /from your graveyard/,
      /return .*from .*graveyard/,
      /card in your graveyard/,
      /cards? in (a|your|their|target player'?s?) graveyard/,
      /flashback/, /escape/, /unearth/, /disturb/, /delve/,
    ],
  },
  {
    id: 'artifacts',
    name: 'Artifacts',
    blurb: 'Artifacts and affinity payoffs.',
    signatures: [/artifact/, /affinity/, /metalcraft/, /improvise/],
  },
  {
    id: 'enchantments',
    name: 'Enchantments',
    blurb: 'Enchantress-style enchantment matters.',
    signatures: [/enchantment/, /constellation/, /aura/, /saga/],
  },
  {
    id: 'voltron',
    name: 'Voltron / Equipment',
    blurb: 'Suit up one creature and swing.',
    signatures: [/equip/, /equipped creature/, /attached/, /aura/, /whenever .*deals combat damage to a player/],
  },
  {
    id: 'landfall',
    name: 'Landfall / Lands',
    blurb: 'Extra land drops trigger payoffs.',
    signatures: [/landfall/, /land enters/, /a land enters/, /play an additional land/, /play a land/],
  },
  {
    id: 'draw-matters',
    name: 'Draw-Matters / Wheels',
    blurb: 'Drawing extra cards triggers payoffs.',
    signatures: [/whenever you draw/, /draws? (a|your) (\w+ )?card/, /each player draws/, /no maximum hand size/],
  },
  {
    id: 'aggro-combat',
    name: 'Combat / Attack Triggers',
    blurb: 'Reward attacking and dealing combat damage.',
    signatures: [/whenever .*attacks/, /combat damage to a player/, /extra combat/, /whenever .*deals combat damage/, /double strike/],
  },
  {
    id: 'mill',
    name: 'Mill / Self-Mill',
    blurb: 'Fill graveyards for value or wins.',
    signatures: [/mill/, /into (your|their) graveyard from (your|their) library/, /put the top .*library into/],
  },
];

export const themeById = (id: string): Theme | undefined => THEMES.find((t) => t.id === id);

// ── Card facts used by classification ────────────────────────────────

/** The catalogue fields the classifier reads, lowercased once up front. */
export interface CardFacts {
  typeLine: string;
  oracleText: string;
  keywords: string[];
}

export function cardFacts(cat: CatalogueCard): CardFacts {
  return {
    typeLine: cat.typeLine.toLowerCase(),
    oracleText: (cat.oracleText ?? '').toLowerCase(),
    keywords: (cat.keywords ?? []).map((k) => k.toLowerCase()),
  };
}

// ── Colour-identity legality ─────────────────────────────────────────

/** A card is Commander-legal when its colour identity ⊆ the commander's. */
export function withinIdentity(cardIdentity: string, commanderIdentity: string): boolean {
  for (const ch of cardIdentity) {
    if (!commanderIdentity.includes(ch)) return false;
  }
  return true;
}

// ── Role classification ──────────────────────────────────────────────

const RAMP_RE = [
  /add \{[wubrgc]\}/, // mana rocks / dorks
  /add (one|two|three|\w+) mana/,
  /search your library for .*(land|forest|island|plains|swamp|mountain)/,
  /that land enters the battlefield untapped/,
];
const DRAW_RE = [
  /draw (a|two|three|four|\w+|that many|x) cards?/,
  /draws? (a|two|three|\w+) cards?/,
];
const REMOVAL_RE = [
  /destroy target/,
  /exile target/,
  /counter target/,
  /return target .*to (its|their) owner'?s? hand/,
  /target creature gets -/,
  /target .*gets -\d/,
  /fight/,
  /deals? \d+ damage to (target|any target|target creature|target player)/,
  /target (creature|permanent|player|opponent) sacrifices/,
];
const WIPE_RE = [
  /destroy all/,
  /exile all/,
  /destroy each/,
  /exile each/,
  /all creatures get -/,
  /each creature gets -/,
  /deals? \d+ damage to each (creature|opponent|player)/,
  /all (creatures|permanents|nonland permanents)/,
  /each player sacrifices/,
];
/**
 * Finishers — cards that actually close a game, independent of the deck's
 * theme (an overrun wins a tokens deck and a kindred deck alike). Kept
 * deliberately tight so the "win condition" slots hold real closers, not every
 * incidental drain: alt-wins, scaling drain/burn, team pumps with evasion,
 * extra turns/combats, and infect.
 */
const WINCON_RE = [
  /you win the game/,
  /(target player|that player|each opponent|an opponent|defending player|its controller|they) loses the game/,
  /can't lose the game/,
  /opponents? can't win the game/,
  // Scaling / large drains that close a game — but not a 1-life aristocrats ping.
  /each opponent loses ([5-9]|\d\d+|x)\b[^.]*life/, // Exsanguinate, Kokusho
  /each opponent loses life equal to/, // Gray Merchant, devotion drains
  /each opponent loses twice/, // Debt to the Deathless
  /repeat the following process/, // Torment of Hailfire and other X-times drains
  /deals damage to (each opponent|any target|each of them).*equal to/, // scaling burn finishers
  /take an extra turn/,
  /(additional|extra) combat phase/,
  /creatures you control get \+x\/\+x/, // Craterhoof, Overwhelming Stampede
  /creatures you control get \+\d+\/\+\d+ and gain (trample|flying|menace)/, // Overrun, End-Raze
  /creatures you control (gain|have) (trample|flying|menace|infect).*\+x\/\+x/,
  /\binfect\b/,
  /poison counters?/,
  /\btoxic\b/,
];

function anyMatch(text: string, res: RegExp[]): boolean {
  return res.some((re) => re.test(text));
}

/**
 * The set of "staple" roles a card can fill, independent of the deck's themes.
 * Lands are exclusively lands. A spell can qualify for several roles (a wrath
 * that also draws), so callers pick the slot they want to fill.
 */
export function stapleRoles(facts: CardFacts): Set<RoleId> {
  const roles = new Set<RoleId>();
  if (facts.typeLine.includes('land')) {
    roles.add('land');
    // Fetch-style lands still ramp, but keep them primarily in the mana base.
    return roles;
  }
  const t = facts.oracleText;
  if (anyMatch(t, WIPE_RE)) roles.add('wipe');
  if (anyMatch(t, REMOVAL_RE)) roles.add('removal');
  if (anyMatch(t, RAMP_RE)) roles.add('ramp');
  if (anyMatch(t, DRAW_RE)) roles.add('draw');
  return roles;
}

/** Does a card support any of the selected themes? */
export function matchesThemes(facts: CardFacts, themeIds: string[]): boolean {
  if (themeIds.length === 0) return false;
  const hay = `${facts.typeLine} ${facts.oracleText} ${facts.keywords.join(' ')}`;
  for (const id of themeIds) {
    const theme = themeById(id);
    if (theme && theme.signatures.some((re) => re.test(hay))) return true;
  }
  return false;
}

/** A card that can close the game on its own, independent of the deck's theme. */
export function isWincon(facts: CardFacts): boolean {
  const hay = `${facts.typeLine} ${facts.oracleText} ${facts.keywords.join(' ')}`;
  return anyMatch(hay, WINCON_RE);
}

/** Every role a card is eligible for, given the deck's selected themes. */
export function eligibleRoles(facts: CardFacts, themeIds: string[]): Set<RoleId> {
  const roles = stapleRoles(facts);
  if (roles.has('land')) return roles;
  if (matchesThemes(facts, themeIds)) roles.add('synergy');
  if (isWincon(facts)) roles.add('wincon');
  return roles;
}

// ── Commander analysis → theme suggestions ───────────────────────────

export interface ThemeSuggestion {
  theme: Theme;
  score: number;
}

/**
 * Rank themes by how strongly the commander's own text signals them, so we can
 * suggest a game plan. Only themes with at least one signal are returned.
 */
export function suggestThemes(commander: CatalogueCard): ThemeSuggestion[] {
  const facts = cardFacts(commander);
  const hay = `${facts.typeLine} ${facts.oracleText} ${facts.keywords.join(' ')}`;
  const out: ThemeSuggestion[] = [];
  for (const theme of THEMES) {
    let score = 0;
    for (const re of theme.signatures) if (re.test(hay)) score++;
    if (score > 0) out.push({ theme, score });
  }
  out.sort((a, b) => b.score - a.score || a.theme.name.localeCompare(b.theme.name));
  return out;
}

// ── Commander eligibility ────────────────────────────────────────────

/** Can this printing be a commander? Legendary creatures + explicit grantees. */
export function canBeCommander(cat: CatalogueCard): boolean {
  const tl = cat.typeLine.toLowerCase();
  const isLegendaryCreature = tl.includes('legendary') && tl.includes('creature');
  const grantsIt = (cat.oracleText ?? '').toLowerCase().includes('can be your commander');
  return isLegendaryCreature || grantsIt;
}

/**
 * Search the catalogue for possible commanders by name. Uses the indexed name
 * prefix for speed, then filters to legendary creatures and de-dupes printings
 * by oracle id so the picker shows one row per card.
 */
export async function searchCommanders(query: string, limit = 40): Promise<CatalogueCard[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db.catalogue
    .where('name')
    .startsWithIgnoreCase(q)
    .filter(canBeCommander)
    .limit(400)
    .toArray();

  const byOracle = new Map<string, CatalogueCard>();
  for (const r of rows) {
    if (!byOracle.has(r.oracleId)) byOracle.set(r.oracleId, r);
  }
  return [...byOracle.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Every commander-eligible card you own, one row per card (by oracle id). */
export async function ownedCommanders(): Promise<CatalogueCard[]> {
  const owned = await db.owned.toArray();
  const ids = [...new Set(owned.map((o) => o.catalogueId))];
  const cats = await db.catalogue.bulkGet(ids);
  const byOracle = new Map<string, CatalogueCard>();
  for (const c of cats) {
    if (c && canBeCommander(c) && !byOracle.has(c.oracleId)) byOracle.set(c.oracleId, c);
  }
  return [...byOracle.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Deck CRUD ────────────────────────────────────────────────────────

export async function createDeck(commander: CatalogueCard, name?: string): Promise<Deck> {
  const strategy = STRATEGIES[0]!;
  // Pre-select the two strongest suggested themes as a friendly default.
  const themes = suggestThemes(commander)
    .slice(0, 2)
    .map((s) => s.theme.id);
  const now = Date.now();
  const deck: Deck = {
    id: uuid(),
    name: name?.trim() || commander.name,
    commanderId: commander.id,
    colorIdentity: commander.colorIdentity,
    strategyId: strategy.id,
    targets: { ...strategy.targets },
    themes,
    entries: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.decks.add(deck);
  return deck;
}

export async function getDeck(id: string): Promise<Deck | undefined> {
  return db.decks.get(id);
}

export async function listDecks(): Promise<Deck[]> {
  const decks = await db.decks.toArray();
  return decks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveDeck(deck: Deck): Promise<void> {
  await db.decks.put({ ...deck, updatedAt: Date.now() });
}

export async function deleteDeck(id: string): Promise<void> {
  await db.decks.delete(id);
}

/** Immutable update helpers so callers can `saveDeck(next)`. */
export function setStrategy(deck: Deck, strategyId: string): Deck {
  const s = strategyById(strategyId);
  return { ...deck, strategyId: s.id, targets: { ...s.targets } };
}

export function setTarget(deck: Deck, role: RoleId, value: number): Deck {
  const v = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return { ...deck, targets: { ...deck.targets, [role]: v } };
}

export function toggleTheme(deck: Deck, themeId: string): Deck {
  const has = deck.themes.includes(themeId);
  return {
    ...deck,
    themes: has ? deck.themes.filter((t) => t !== themeId) : [...deck.themes, themeId],
  };
}

export function addEntry(deck: Deck, catalogueId: string, role: RoleId, quantity = 1): Deck {
  const idx = deck.entries.findIndex((e) => e.catalogueId === catalogueId && e.role === role);
  const entries = [...deck.entries];
  if (idx >= 0) {
    entries[idx] = { ...entries[idx]!, quantity: entries[idx]!.quantity + quantity };
  } else {
    entries.push({ catalogueId, role, quantity });
  }
  return { ...deck, entries };
}

export function removeEntry(deck: Deck, catalogueId: string, role: RoleId): Deck {
  return { ...deck, entries: deck.entries.filter((e) => !(e.catalogueId === catalogueId && e.role === role)) };
}

/** Bump an entry's quantity by `delta`, removing it if it drops to zero. */
export function changeEntryQuantity(deck: Deck, catalogueId: string, role: RoleId, delta: number): Deck {
  const idx = deck.entries.findIndex((e) => e.catalogueId === catalogueId && e.role === role);
  if (idx < 0) return delta > 0 ? addEntry(deck, catalogueId, role, delta) : deck;
  const next = deck.entries[idx]!.quantity + delta;
  if (next <= 0) return removeEntry(deck, catalogueId, role);
  const entries = [...deck.entries];
  entries[idx] = { ...entries[idx]!, quantity: next };
  return { ...deck, entries };
}

export function entryRole(deck: Deck, catalogueId: string): RoleId | null {
  return deck.entries.find((e) => e.catalogueId === catalogueId)?.role ?? null;
}

// ── Derived counts for the builder UI ────────────────────────────────

export function roleCounts(deck: Deck): Record<RoleId, number> {
  const counts: Record<RoleId, number> = { land: 0, ramp: 0, draw: 0, removal: 0, wipe: 0, synergy: 0, wincon: 0 };
  for (const e of deck.entries) counts[e.role] += e.quantity;
  return counts;
}

export function deckSize(entries: DeckEntry[]): number {
  return entries.reduce((n, e) => n + e.quantity, 0);
}

// ── Legality ─────────────────────────────────────────────────────────

/** Keep one printing per card (by oracle id), preserving order. */
export function dedupeByOracle(cards: CatalogueCard[]): CatalogueCard[] {
  const seen = new Set<string>();
  const out: CatalogueCard[] = [];
  for (const c of cards) {
    if (seen.has(c.oracleId)) continue;
    seen.add(c.oracleId);
    out.push(c);
  }
  return out;
}

/** A card is a basic land — unlimited copies, and free to add to any deck. */
export function isBasicLand(cat: { typeLine: string }): boolean {
  const t = cat.typeLine.toLowerCase();
  return t.includes('basic') && t.includes('land');
}

/** Cards exempt from the singleton rule (basics + "any number of" cards). */
export function allowsAnyNumber(cat: CatalogueCard): boolean {
  return (
    isBasicLand(cat) ||
    (cat.oracleText ?? '').toLowerCase().includes('a deck can have any number of cards named')
  );
}

/**
 * Cards banned in the Commander (EDH) format. Snapshot of the official RC list
 * (incl. the Sep-2024 fast-mana bans). Matched case-insensitively by full name.
 */
export const BANNED_COMMANDER: ReadonlySet<string> = new Set(
  [
    'Ancestral Recall', 'Balance', 'Biorhythm', 'Black Lotus', 'Braids, Cabal Minion',
    'Channel', 'Chaos Orb', 'Coalition Victory', 'Dockside Extortionist',
    'Emrakul, the Aeons Torn', 'Erayo, Soratami Ascendant', 'Falling Star', 'Fastbond',
    'Flash', 'Genesis Wave', 'Golos, Tireless Pilgrim', 'Griselbrand', 'Hullbreacher',
    'Iona, Shield of Emeria', 'Jeweled Lotus', 'Karakas', 'Leovold, Emissary of Trest',
    'Library of Alexandria', 'Limited Resources', 'Lutri, the Spellchaser', 'Mana Crypt',
    'Mox Emerald', 'Mox Jet', 'Mox Pearl', 'Mox Ruby', 'Mox Sapphire',
    'Nadu, Winged Wisdom', 'Panoptic Mirror', 'Paradox Engine', 'Primeval Titan',
    'Prophet of Kruphix', 'Recurring Nightmare', 'Rofellos, Llanowar Emissary', 'Shahrazad',
    'Sundering Titan', 'Sway of the Stars', 'Sylvan Primordial', 'Time Vault', 'Time Walk',
    'Tinker', 'Tolarian Academy', 'Trade Secrets', 'Upheaval', 'Worldfire',
    "Yawgmoth's Bargain",
  ].map((n) => n.toLowerCase()),
);

export interface LegalityIssue {
  level: 'error' | 'warning';
  message: string;
}
export interface Legality {
  ok: boolean;
  total: number; // cards including the commander
  issues: LegalityIssue[];
}

/**
 * Check a deck against the Commander rules: exactly 100 cards, singleton (basics
 * and "any number" cards excepted), every card inside the commander's colour
 * identity, nothing banned, and a legal commander. `byId` must resolve every
 * entry's catalogue card plus the commander.
 */
export function validateDeck(
  deck: Deck,
  commander: CatalogueCard | undefined,
  byId: Map<string, CatalogueCard>,
): Legality {
  const issues: LegalityIssue[] = [];
  const total = deckSize(deck.entries) + 1; // + the commander

  if (!commander) {
    issues.push({ level: 'error', message: 'Commander card not found in the catalogue.' });
  } else {
    if (!canBeCommander(commander)) {
      issues.push({ level: 'error', message: `${commander.name} can’t be a commander — it must be a legendary creature.` });
    }
    if (BANNED_COMMANDER.has(commander.name.toLowerCase())) {
      issues.push({ level: 'error', message: `${commander.name} is banned in Commander.` });
    }
  }

  if (total !== 100) {
    issues.push({
      level: total > 100 ? 'error' : 'warning',
      message: `Deck has ${total} cards — Commander needs exactly 100 (99 + commander).`,
    });
  }

  // Aggregate copies by oracle id — singleton is per card, so two printings of
  // the same card (e.g. Terramorphic Expanse from different sets) still count as
  // duplicates.
  const byOracle = new Map<string, { qty: number; card: CatalogueCard }>();
  for (const e of deck.entries) {
    const cat = byId.get(e.catalogueId);
    if (!cat) continue;
    const cur = byOracle.get(cat.oracleId);
    if (cur) cur.qty += e.quantity;
    else byOracle.set(cat.oracleId, { qty: e.quantity, card: cat });
  }

  for (const { qty, card } of byOracle.values()) {
    if (commander && card.oracleId === commander.oracleId) {
      issues.push({ level: 'error', message: `${card.name} is your commander and can’t also be in the 99.` });
    }
    if (qty > 1 && !allowsAnyNumber(card)) {
      issues.push({ level: 'error', message: `${qty}× ${card.name} — only one copy allowed (singleton).` });
    }
    if (!withinIdentity(card.colorIdentity, deck.colorIdentity)) {
      issues.push({ level: 'error', message: `${card.name} is outside your commander’s colour identity.` });
    }
    if (BANNED_COMMANDER.has(card.name.toLowerCase())) {
      issues.push({ level: 'error', message: `${card.name} is banned in Commander.` });
    }
  }

  return { ok: issues.every((i) => i.level !== 'error'), total, issues };
}

// ── Auto-build ───────────────────────────────────────────────────────

const BASIC_FOR_COLOR: Record<string, string> = {
  W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest', C: 'Wastes',
};

/** One catalogue printing per basic-land type, for topping up the mana base. */
export async function basicLandPrintings(): Promise<Record<string, CatalogueCard>> {
  const out: Record<string, CatalogueCard> = {};
  for (const [color, name] of Object.entries(BASIC_FOR_COLOR)) {
    const rows = await db.catalogue.where('name').equals(name).toArray();
    const pick =
      rows.find((r) => r.imgSmall && isBasicLand(r)) ?? rows.find((r) => isBasicLand(r)) ?? rows[0];
    if (pick) out[color] = pick;
  }
  return out;
}

// A common EDH nonland curve shape (weights by mana value 0,1,2,3,4,5,6,7+):
// low on 0–1, a hump at 2–4, tapering after. Used to spread auto-build picks
// across the curve instead of grabbing the cheapest cards first.
const CURVE_WEIGHTS = [1, 6, 14, 16, 13, 9, 5, 3];

const cmcBucket = (cmc: number): number => Math.min(7, Math.max(0, Math.floor(cmc)));

/** Fisher–Yates shuffle (copy). Keeps auto-build from picking alphabetically. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Fractional target count per mana-value bucket for a nonland total. */
function curveQuota(nonlandTotal: number): number[] {
  const sum = CURVE_WEIGHTS.reduce((a, b) => a + b, 0);
  return CURVE_WEIGHTS.map((w) => (w / sum) * nonlandTotal);
}

/**
 * Pick `count` cards from `cands`, each time taking the one whose mana-value
 * bucket is furthest below its curve quota (ties broken toward the cheaper card).
 * Mutates `bucketUsed` so quotas are shared across roles.
 */
function pickForCurve(cands: CatalogueCard[], count: number, quota: number[], bucketUsed: number[]): CatalogueCard[] {
  const remaining = [...cands];
  const chosen: CatalogueCard[] = [];
  for (let k = 0; k < count && remaining.length; k++) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!;
      const b = cmcBucket(c.cmc);
      const deficit = (quota[b] ?? 0) - (bucketUsed[b] ?? 0);
      if (deficit > bestScore || (deficit === bestScore && (bestIdx < 0 || c.cmc < remaining[bestIdx]!.cmc))) {
        bestScore = deficit;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const [pick] = remaining.splice(bestIdx, 1);
    chosen.push(pick!);
    bucketUsed[cmcBucket(pick!.cmc)] = (bucketUsed[cmcBucket(pick!.cmc)] ?? 0) + 1;
  }
  return chosen;
}

// ── Mana base ────────────────────────────────────────────────────────

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

/** Count coloured pips (W/U/B/R/G) in a mana cost, hybrid/Phyrexian included. */
function addPips(cost: string | null, into: Record<string, number>): void {
  if (!cost) return;
  for (const sym of cost.match(/\{[^}]+\}/g) ?? []) {
    for (const c of WUBRG) if (sym.includes(c)) into[c] = (into[c] ?? 0) + 1;
  }
}

/**
 * How a nonbasic land helps this deck: which of the deck's colours it makes,
 * whether it fetches lands (flexible fixing), and a score used to keep the best
 * fixers/utility lands when only so many nonbasic slots are available.
 */
function landInfo(card: CatalogueCard, deckColors: string[]): { colored: string[]; fetch: boolean; score: number } {
  const text = (card.oracleText ?? '').toLowerCase();
  const fetch = /search your library for/.test(text) && /\bland|plains|island|swamp|mountain|forest/.test(text);
  const colored = deckColors.filter((c) => card.colorIdentity.includes(c));
  const utility =
    /(draw|scry|create|exile|destroy|proliferate|\+1\/\+1|deals? \d|can't be blocked|hexproof|indestructible|counter)/.test(text);
  const score = colored.length * 3 + (fetch ? 3 : 0) + (utility ? 1 : 0);
  return { colored, fetch, score };
}

// Fraction of the mana base to fill with (owned) nonbasic lands, indexed by
// colour count. Mono decks lean on basics; the more colours, the more fixing.
const NONBASIC_FRACTION = [0.3, 0.3, 0.5, 0.63, 0.71, 0.79];

export interface AutoBuildResult {
  deck: Deck;
  nonBasicAdded: number;
  basicsAdded: number;
  shortfalls: { role: RoleId; have: number; target: number }[];
}

/**
 * Fill a deck from the collection toward its role targets, then top the mana
 * base up with basics split across the commander's colours. Replaces the deck's
 * current contents. Non-land roles are limited by what you own (reported as
 * shortfalls); basics (in `basicsMode 'free'`) are unlimited.
 */
export function autoBuild(
  deck: Deck,
  commander: CatalogueCard,
  byId: Map<string, CatalogueCard>,
  ownedQty: Map<string, number>,
  basics: Record<string, CatalogueCard>,
  basicsMode: 'free' | 'owned' = 'free',
): AutoBuildResult {
  const entries: DeckEntry[] = [];
  // Track picks by oracle id so alternate printings of a card we've already
  // taken (or of the commander) are treated as the same singleton card.
  const used = new Set<string>([commander.oracleId]);
  // Collapse the collection to one printing per card, then shuffle so picks
  // within a mana-value bucket aren't biased toward the start of the alphabet.
  const owned = shuffle(dedupeByOracle([...byId.values()].filter((c) => ownedQty.has(c.id))));
  let nonBasicAdded = 0;

  // Non-land roles: fill each toward the shared curve quota rather than by
  // cheapest-first, so the deck gets a proper spread of mana values.
  // Fill win conditions before synergy so a card that is both a finisher and a
  // theme card is claimed as the finisher first.
  const SPELL_ROLES: RoleId[] = ['ramp', 'draw', 'removal', 'wipe', 'wincon', 'synergy'];
  const spellTotal = SPELL_ROLES.reduce((n, r) => n + (deck.targets[r] ?? 0), 0);
  const quota = curveQuota(spellTotal);
  const bucketUsed = new Array(8).fill(0) as number[];
  for (const role of SPELL_ROLES) {
    const target = deck.targets[role] ?? 0;
    if (target <= 0) continue;
    const cands = owned
      .filter(
        (c) =>
          !used.has(c.oracleId) &&
          !isBasicLand(c) &&
          withinIdentity(c.colorIdentity, deck.colorIdentity) &&
          eligibleRoles(cardFacts(c), deck.themes).has(role),
      );
    for (const c of pickForCurve(cands, target, quota, bucketUsed)) {
      entries.push({ catalogueId: c.id, role, quantity: 1 });
      used.add(c.oracleId);
      nonBasicAdded++;
    }
  }

  // Mana base: keep only the best owned nonbasic (fixing/utility) lands, capped
  // to a fraction of the base so basics still get in, then fill the rest with
  // basics split across colours by the deck's actual pip demand.
  const landTarget = deck.targets.land ?? 0;
  const deckColors = deck.colorIdentity ? deck.colorIdentity.split('') : [];
  let landCount = 0;

  // Colour demand from everything we'll cast (commander + chosen spells).
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  addPips(commander.manaCost, pips);
  for (const e of entries) addPips(byId.get(e.catalogueId)?.manaCost ?? null, pips);

  // Rank owned nonbasic lands by how well they fix/serve the deck, keep the best.
  const nonBasicLands = owned
    .filter(
      (c) =>
        !used.has(c.oracleId) &&
        !isBasicLand(c) &&
        cardFacts(c).typeLine.includes('land') &&
        withinIdentity(c.colorIdentity, deck.colorIdentity),
    )
    .map((c) => ({ c, ...landInfo(c, deckColors) }));
  nonBasicLands.sort((a, b) => b.score - a.score); // stable: ties keep shuffle order

  const frac = NONBASIC_FRACTION[Math.min(NONBASIC_FRACTION.length - 1, deckColors.length)] ?? 0.5;
  const nonbasicTarget = Math.min(nonBasicLands.length, Math.round(landTarget * frac));

  for (const nb of nonBasicLands.slice(0, nonbasicTarget)) {
    entries.push({ catalogueId: nb.c.id, role: 'land', quantity: 1 });
    used.add(nb.c.oracleId);
    landCount++;
    nonBasicAdded++;
  }

  // Fill the remainder with basics, split to mirror the deck's colour demand
  // (D'Hondt on pip counts, floored so a minority colour still gets a few). The
  // nonbasics add fixing on top; we don't let them zero a colour's basics, which
  // is why we don't subtract their sources here. Basics are unlimited in 'free'.
  let basicsAdded = 0;
  const remaining = landTarget - landCount;
  if (remaining > 0) {
    const cols = deckColors.length ? deckColors : ['C'];
    const weightOf = (col: string): number => (col === 'C' ? 1 : Math.max(pips[col] ?? 0, 1));
    const buckets = cols
      .map((col) => {
        const printing =
          basicsMode === 'owned'
            ? owned.find((c) => c.name === BASIC_FOR_COLOR[col] && isBasicLand(c))
            : basics[col];
        const cap = basicsMode === 'owned' ? (printing ? ownedQty.get(printing.id) ?? 0 : 0) : Infinity;
        return { col, printing, cap, count: 0 };
      })
      .filter((b) => b.printing);

    for (let i = 0; i < remaining; i++) {
      let best = -1;
      let bestVal = -Infinity;
      for (let j = 0; j < buckets.length; j++) {
        const b = buckets[j]!;
        if (b.count >= b.cap) continue;
        const val = weightOf(b.col) / (b.count + 1);
        if (val > bestVal) {
          bestVal = val;
          best = j;
        }
      }
      if (best < 0) break;
      buckets[best]!.count++;
    }
    for (const b of buckets) {
      if (b.count > 0 && b.printing) {
        entries.push({ catalogueId: b.printing.id, role: 'land', quantity: b.count });
        basicsAdded += b.count;
      }
    }
  }

  const counts = roleCounts({ ...deck, entries });
  const shortfalls = ROLES.map((r) => ({ role: r.id, have: counts[r.id], target: deck.targets[r.id] ?? 0 })).filter(
    (s) => s.have < s.target,
  );

  return { deck: { ...deck, entries }, nonBasicAdded, basicsAdded, shortfalls };
}

// ── Decklist view + export ───────────────────────────────────────────

export interface DeckRow {
  card: CatalogueCard;
  role: RoleId;
  quantity: number;
}

/** Deck entries resolved to cards and grouped by role, each sorted by curve. */
export function deckRowsByRole(deck: Deck, byId: Map<string, CatalogueCard>): Record<RoleId, DeckRow[]> {
  const out: Record<RoleId, DeckRow[]> = { land: [], ramp: [], draw: [], removal: [], wipe: [], synergy: [], wincon: [] };
  for (const e of deck.entries) {
    const card = byId.get(e.catalogueId);
    if (card) out[e.role].push({ card, role: e.role, quantity: e.quantity });
  }
  for (const role of Object.keys(out) as RoleId[]) {
    out[role].sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name));
  }
  return out;
}

/**
 * Nonland mana curve: card counts bucketed by mana value 0–6 and 7+. The
 * commander is included; lands are excluded (they have no meaningful curve).
 */
export function manaCurve(deck: Deck, commander: CatalogueCard | undefined, byId: Map<string, CatalogueCard>): number[] {
  const buckets = new Array(8).fill(0) as number[];
  const add = (card: CatalogueCard, qty: number) => {
    if (card.typeLine.toLowerCase().includes('land')) return;
    const i = Math.min(7, Math.max(0, Math.floor(card.cmc)));
    buckets[i] = (buckets[i] ?? 0) + qty;
  };
  if (commander) add(commander, 1);
  for (const e of deck.entries) {
    const c = byId.get(e.catalogueId);
    if (c) add(c, e.quantity);
  }
  return buckets;
}

/**
 * A plain-text decklist for Moxfield's paste import: `N Card Name` per line, the
 * commander tagged `*CMDR*`, cards ordered by role then curve. No category
 * headers — Moxfield reads bare quantity/name lines.
 */
export function moxfieldExport(deck: Deck, commander: CatalogueCard | undefined, byId: Map<string, CatalogueCard>): string {
  const lines: string[] = [];
  if (commander) lines.push(`1 ${commander.name} *CMDR*`);

  const roleOrder = new Map(ROLES.map((r, i) => [r.id, i]));
  const rows = deck.entries
    .map((e) => ({ e, card: byId.get(e.catalogueId) }))
    .filter((x): x is { e: DeckEntry; card: CatalogueCard } => !!x.card)
    .sort(
      (a, b) =>
        (roleOrder.get(a.e.role) ?? 0) - (roleOrder.get(b.e.role) ?? 0) ||
        a.card.cmc - b.card.cmc ||
        a.card.name.localeCompare(b.card.name),
    );

  if (rows.length && commander) lines.push('');
  for (const { e, card } of rows) lines.push(`${e.quantity} ${card.name}`);
  return lines.join('\n');
}
