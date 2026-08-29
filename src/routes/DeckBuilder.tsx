import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BoltIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  MinusIcon,
  PlusIcon,
  QueueListIcon,
  SparklesIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { ManaPips } from '../components/ManaPips';
import { CatalogueThumb } from '../components/CatalogueThumb';
import { CardHoverCard } from '../components/CardHoverCard';
import { useSettings } from '../hooks/useSettings';
import { db, type CatalogueCard, type Deck, type RoleId } from '../lib/db';
import { allOwned } from '../lib/query';
import {
  ROLES,
  ROLE_LABEL,
  STRATEGIES,
  THEMES,
  DECK_SIZE,
  type AutoBuildResult,
  type Legality,
  autoBuild,
  basicLandPrintings,
  cardFacts,
  changeEntryQuantity,
  deckSize,
  eligibleRoles,
  getDeck,
  roleCounts,
  saveDeck,
  setStrategy,
  setTarget,
  suggestThemes,
  toggleTheme,
  validateDeck,
  withinIdentity,
} from '../lib/deck';

const EMPTY_ROLES = (): Record<RoleId, CatalogueCard[]> => ({
  land: [], ramp: [], draw: [], removal: [], wipe: [], synergy: [],
});

// ── Small pieces ─────────────────────────────────────────────────────

function ThemePanel({ deck, commander, accent }: { deck: Deck; commander: CatalogueCard; accent: string }) {
  const suggestions = useMemo(() => suggestThemes(commander), [commander]);
  const suggestedIds = new Set(suggestions.map((s) => s.theme.id));
  const others = THEMES.filter((t) => !suggestedIds.has(t.id));

  function Chip({ id, name }: { id: string; name: string }) {
    const on = deck.themes.includes(id);
    return (
      <button
        onClick={() => saveDeck(toggleTheme(deck, id))}
        className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
        style={on ? { backgroundColor: accent, color: '#000' } : undefined}
        {...(on ? {} : { 'data-off': true })}
      >
        <span className={on ? '' : 'text-neutral-300'}>{name}</span>
      </button>
    );
  }

  return (
    <section className="border-b border-surface-2 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <SparklesIcon className="h-4 w-4" style={{ color: accent }} />
        <h2 className="text-sm font-semibold">Synergy</h2>
      </div>
      {suggestions.length > 0 ? (
        <p className="mb-2 text-xs text-neutral-400">
          Suggested for {commander.name} — tap to pick the themes your Synergy slots should reward.
        </p>
      ) : (
        <p className="mb-2 text-xs text-neutral-400">
          Pick the themes your Synergy slots should reward.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 [&_button[data-off]]:bg-surface-2">
        {suggestions.map((s) => (
          <Chip key={s.theme.id} id={s.theme.id} name={s.theme.name} />
        ))}
      </div>

      {others.length > 0 && (
        <>
          <p className="mb-1.5 mt-3 text-[11px] uppercase tracking-wide text-neutral-500">Other themes</p>
          <div className="flex flex-wrap gap-1.5 [&_button[data-off]]:bg-surface-1">
            {others.map((t) => (
              <Chip key={t.id} id={t.id} name={t.name} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function StrategyPanel({ deck, accent }: { deck: Deck; accent: string }) {
  const targetSum = ROLES.reduce((n, r) => n + (deck.targets[r.id] ?? 0), 0);

  return (
    <section className="border-b border-surface-2 px-3 py-3">
      <h2 className="mb-2 text-sm font-semibold">Strategy</h2>
      <div className="flex flex-wrap gap-1.5">
        {STRATEGIES.map((s) => {
          const on = deck.strategyId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => saveDeck(setStrategy(deck, s.id))}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${on ? 'text-black' : 'bg-surface-2 text-neutral-300'}`}
              style={on ? { backgroundColor: accent } : undefined}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        {STRATEGIES.find((s) => s.id === deck.strategyId)?.description}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {ROLES.map((r) => (
          <label key={r.id} className="flex items-center justify-between rounded-lg bg-surface-1 px-2.5 py-1.5">
            <span className="text-xs text-neutral-300">{r.label}</span>
            <input
              type="number"
              min={0}
              value={deck.targets[r.id] ?? 0}
              onChange={(e) => saveDeck(setTarget(deck, r.id, Number(e.target.value)))}
              className="w-12 rounded bg-surface-3 px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-white/30"
            />
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-right text-[11px] text-neutral-500">
        Targets total {targetSum} / {DECK_SIZE}
      </p>
    </section>
  );
}

function CandidateRow({
  deck,
  card,
  role,
  ownedQty,
  accent,
  onOpen,
}: {
  deck: Deck;
  card: CatalogueCard;
  role: RoleId;
  ownedQty: number;
  accent: string;
  onOpen: () => void;
}) {
  const entry = deck.entries.find((e) => e.catalogueId === card.id && e.role === role);
  const added = !!entry;

  return (
    <li className="flex items-center gap-2.5 rounded-lg bg-surface-1 p-1.5">
      <CardHoverCard catalogueId={card.id} className="w-9 shrink-0">
        <CatalogueThumb card={card} onClick={onOpen} />
      </CardHoverCard>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm">{card.name}</span>
          {ownedQty > 1 && <span className="shrink-0 text-[11px] text-neutral-500">×{ownedQty}</span>}
        </span>
        <span className="block truncate text-[11px] text-neutral-500">
          {card.cmc} MV · {card.typeLine}
        </span>
      </button>

      {added ? (
        <span className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => saveDeck(changeEntryQuantity(deck, card.id, role, -1))}
            className="tap-target grid h-8 w-8 place-items-center rounded-md bg-surface-3 active:bg-surface-2"
            aria-label="Remove one"
          >
            <MinusIcon className="h-4 w-4" />
          </button>
          <span className="w-5 text-center text-sm font-semibold tabular-nums">{entry!.quantity}</span>
          <button
            onClick={() => saveDeck(changeEntryQuantity(deck, card.id, role, +1))}
            disabled={entry!.quantity >= ownedQty}
            className="tap-target grid h-8 w-8 place-items-center rounded-md text-black disabled:opacity-40"
            style={{ backgroundColor: accent }}
            aria-label="Add one"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </span>
      ) : (
        <button
          onClick={() => saveDeck(changeEntryQuantity(deck, card.id, role, +1))}
          className="tap-target shrink-0 rounded-md bg-surface-3 px-3 py-1.5 text-xs font-semibold active:bg-surface-2"
        >
          Add
        </button>
      )}
    </li>
  );
}

function RoleSection({
  deck,
  role,
  candidates,
  ownedQty,
  accent,
  onOpenCard,
}: {
  deck: Deck;
  role: (typeof ROLES)[number];
  candidates: CatalogueCard[];
  ownedQty: Map<string, number>;
  accent: string;
  onOpenCard: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = roleCounts(deck)[role.id];
  const target = deck.targets[role.id] ?? 0;
  const pct = target > 0 ? Math.min(100, (count / target) * 100) : count > 0 ? 100 : 0;
  const met = target > 0 && count >= target;
  const addedCount = candidates.filter((c) => deck.entries.some((e) => e.catalogueId === c.id && e.role === role.id)).length;

  return (
    <section className="border-b border-surface-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="tap-target flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        {open ? (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-neutral-500" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-neutral-500" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{role.label}</span>
            <span className={`shrink-0 text-xs font-semibold tabular-nums ${met ? 'text-emerald-400' : 'text-neutral-300'}`}>
              {count} / {target}
            </span>
          </span>
          <span className="mb-1.5 mt-0.5 block text-xs text-neutral-500">
            {candidates.length} in your collection{addedCount ? ` · ${addedCount} in deck` : ''}
          </span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-surface-3">
            <span
              className="block h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: met ? '#34d399' : accent }}
            />
          </span>
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {candidates.length === 0 ? (
            <p className="rounded-lg bg-surface-1 px-3 py-4 text-center text-xs text-neutral-500">
              No {role.label.toLowerCase()} in your collection within {deck.name}’s colours yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((c) => (
                <CandidateRow
                  key={c.id}
                  deck={deck}
                  card={c}
                  role={role.id}
                  ownedQty={ownedQty.get(c.id) ?? 1}
                  accent={accent}
                  onOpen={() => onOpenCard(c.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function LegalityPanel({ legality, accent }: { legality: Legality; accent: string }) {
  const [open, setOpen] = useState(false);
  const errors = legality.issues.filter((i) => i.level === 'error');
  const warnings = legality.issues.filter((i) => i.level === 'warning');

  return (
    <section className="border-b border-surface-2">
      <button onClick={() => setOpen((o) => !o)} className="tap-target flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        {legality.ok ? (
          <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-400" />
        ) : (
          <XCircleIcon className="h-5 w-5 shrink-0 text-red-400" />
        )}
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium">
            {legality.ok ? 'Deck is legal' : `${errors.length} issue${errors.length === 1 ? '' : 's'} to fix`}
          </span>
          <span className="ml-2 text-xs text-neutral-500">Commander legality</span>
        </span>
        <span className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: legality.total === 100 ? accent : undefined }}>
          {legality.total} / 100
        </span>
        {open ? <ChevronDownIcon className="h-4 w-4 text-neutral-500" /> : <ChevronRightIcon className="h-4 w-4 text-neutral-500" />}
      </button>

      {open && (
        <div className="px-3 pb-3">
          {legality.issues.length === 0 ? (
            <p className="rounded-lg bg-surface-1 px-3 py-2 text-xs text-emerald-300">
              Nothing flagged — singleton, colour identity, banlist and the 100-card count all check out.
            </p>
          ) : (
            <ul className="space-y-1">
              {[...errors, ...warnings].map((issue, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-1 px-3 py-2 text-xs">
                  {issue.level === 'error' ? (
                    <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  ) : (
                    <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  )}
                  <span className={issue.level === 'error' ? 'text-neutral-200' : 'text-neutral-300'}>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ── Route ────────────────────────────────────────────────────────────

export function DeckBuilder() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const settings = useSettings();

  // `undefined` = still loading; `null` = no such deck. (A live query can't tell
  // the two apart on its own since both resolve to `undefined`.)
  const deck = useLiveQuery(async () => (await getDeck(deckId!)) ?? null, [deckId]);
  const commander = useLiveQuery<CatalogueCard | undefined>(
    () => (deck ? db.catalogue.get(deck.commanderId) : Promise.resolve(undefined)),
    [deck?.commanderId],
  );
  const owned = useLiveQuery(() => allOwned(), []);

  // Catalogue rows for owned cards — needed for oracle text (classification)
  // and art. Mirrors the Library's lazy enrich join.
  const catMap = useLiveQuery(async () => {
    const ids = [...new Set((owned ?? []).map((o) => o.catalogueId))];
    const cats = await db.catalogue.bulkGet(ids);
    const m = new Map<string, CatalogueCard>();
    for (const c of cats) if (c) m.set(c.id, c);
    return m;
  }, [owned]);

  const ownedQty = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of owned ?? []) m.set(o.catalogueId, (m.get(o.catalogueId) ?? 0) + o.quantity);
    return m;
  }, [owned]);

  // Bucket every legal owned card into the roles it can fill for this deck.
  const candidates = useMemo(() => {
    const result = EMPTY_ROLES();
    if (!deck || !catMap) return result;
    const assigned = new Map<string, RoleId>();
    for (const e of deck.entries) assigned.set(e.catalogueId, e.role);

    for (const [id, cat] of catMap) {
      if (id === deck.commanderId) continue;
      if (!ownedQty.has(id)) continue;
      if (!withinIdentity(cat.colorIdentity, deck.colorIdentity)) continue;
      const roles = eligibleRoles(cardFacts(cat), deck.themes);
      const a = assigned.get(id);
      for (const role of roles) {
        if (a && a !== role) continue; // already slotted elsewhere
        result[role].push(cat);
      }
    }

    for (const role of Object.keys(result) as RoleId[]) {
      result[role].sort((x, y) => {
        const xa = assigned.get(x.id) === role ? 0 : 1;
        const ya = assigned.get(y.id) === role ? 0 : 1;
        return xa - ya || x.cmc - y.cmc || x.name.localeCompare(y.name);
      });
    }
    return result;
  }, [deck, catMap, ownedQty]);

  // Catalogue rows for cards actually in the deck (may include basics the user
  // doesn't own), plus the commander — everything legality needs to resolve.
  const entryCats = useLiveQuery(async () => {
    if (!deck) return new Map<string, CatalogueCard>();
    const ids = [...new Set([deck.commanderId, ...deck.entries.map((e) => e.catalogueId)])];
    const cats = await db.catalogue.bulkGet(ids);
    const m = new Map<string, CatalogueCard>();
    for (const c of cats) if (c) m.set(c.id, c);
    return m;
  }, [deck?.entries, deck?.commanderId]);

  const legality = useMemo(
    () => (deck ? validateDeck(deck, commander ?? undefined, entryCats ?? new Map()) : null),
    [deck, commander, entryCats],
  );

  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<AutoBuildResult | null>(null);

  async function handleBuild() {
    if (!deck || !commander || building) return;
    const yes = window.confirm(
      'Build for me replaces the current deck contents with picks from your collection (basics added to fill the mana base). Continue?',
    );
    if (!yes) return;
    setBuilding(true);
    try {
      // Read the collection fresh here rather than leaning on the live `catMap`,
      // which is briefly an empty map while a large collection loads — building
      // against that half-loaded state is what produced empty results.
      const ownedRows = await allOwned();
      const ids = [...new Set(ownedRows.map((o) => o.catalogueId))];
      const cats = await db.catalogue.bulkGet(ids);
      const byId = new Map<string, CatalogueCard>();
      for (const c of cats) if (c) byId.set(c.id, c);
      const qty = new Map<string, number>();
      for (const o of ownedRows) qty.set(o.catalogueId, (qty.get(o.catalogueId) ?? 0) + o.quantity);

      const basics = await basicLandPrintings();
      const res = autoBuild(deck, commander.id, byId, qty, basics, 'free');
      await saveDeck(res.deck);
      setBuildResult(res);
    } finally {
      setBuilding(false);
    }
  }

  if (deck === undefined || owned === undefined) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Deck" back="/decks" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Loading…</div>
      </div>
    );
  }
  if (deck === null) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Deck" back="/decks" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Deck not found.</div>
      </div>
    );
  }

  const size = deckSize(deck.entries);
  const pct = Math.min(100, Math.round((size / DECK_SIZE) * 100));

  return (
    <div className="flex h-full flex-col">
      <Header
        title={deck.name}
        back="/decks"
        accent={settings.accent}
        right={
          <Link
            to={`/decks/${deck.id}/list`}
            className="tap-target flex items-center justify-center rounded-lg active:bg-surface-2"
            aria-label="View decklist"
          >
            <QueueListIcon className="h-6 w-6" />
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto">
        {/* Commander banner */}
        <section className="flex items-center gap-3 border-b border-surface-2 p-3">
          {commander ? (
            <CardHoverCard catalogueId={commander.id} className="w-20 shrink-0">
              <CatalogueThumb card={commander} size="normal" onClick={() => navigate(`/card/${commander.id}`)} />
            </CardHoverCard>
          ) : (
            <span className="block w-20 shrink-0 rounded-lg bg-surface-2" style={{ aspectRatio: '5 / 7' }} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold">{commander?.name ?? '…'}</h2>
              <ManaPips identity={deck.colorIdentity} size={16} />
            </div>
            <p className="truncate text-xs text-neutral-400">{commander?.typeLine}</p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-xs text-neutral-400">Deck</span>
              <span className="text-xs font-semibold tabular-nums text-neutral-200">
                {size} / {DECK_SIZE}
              </span>
            </div>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: settings.accent }} />
            </span>
          </div>
        </section>

        {/* Auto-build */}
        <section className="border-b border-surface-2 px-3 py-2.5">
          <button
            onClick={handleBuild}
            disabled={building}
            className="tap-target flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-black disabled:opacity-60"
            style={{ backgroundColor: settings.accent }}
          >
            <BoltIcon className="h-5 w-5" />
            {building ? 'Building…' : 'Build for me'}
          </button>
          {buildResult && (
            <div className="mt-2 rounded-lg bg-surface-1 px-3 py-2 text-xs text-neutral-300">
              Added {buildResult.nonBasicAdded} card{buildResult.nonBasicAdded === 1 ? '' : 's'} from your
              collection and {buildResult.basicsAdded} basic land{buildResult.basicsAdded === 1 ? '' : 's'}.
              {buildResult.shortfalls.length > 0 ? (
                <span className="mt-1 block text-amber-300">
                  Short on:{' '}
                  {buildResult.shortfalls
                    .map((s) => `${ROLE_LABEL[s.role]} (${s.have}/${s.target})`)
                    .join(', ')}{' '}
                  — not enough owned cards. Add more, or lower these targets.
                </span>
              ) : (
                <span className="mt-1 block text-emerald-300">Every role hit its target.</span>
              )}
              <Link
                to={`/decks/${deck.id}/list`}
                className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-surface-2 py-2 text-xs font-semibold active:bg-surface-3"
              >
                <QueueListIcon className="h-4 w-4" />
                View deck
              </Link>
            </div>
          )}
        </section>

        {legality && <LegalityPanel legality={legality} accent={settings.accent} />}

        {commander && <ThemePanel deck={deck} commander={commander} accent={settings.accent} />}
        <StrategyPanel deck={deck} accent={settings.accent} />

        {ROLES.map((role) => (
          <RoleSection
            key={role.id}
            deck={deck}
            role={role}
            candidates={candidates[role.id]}
            ownedQty={ownedQty}
            accent={settings.accent}
            onOpenCard={(id) => navigate(`/card/${id}`)}
          />
        ))}
        <div className="h-8" />
      </main>
    </div>
  );
}
