import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { ManaPips } from '../components/ManaPips';
import { CatalogueThumb } from '../components/CatalogueThumb';
import { useSettings } from '../hooks/useSettings';
import { db, type CatalogueCard, type Deck } from '../lib/db';
import { deckSize, deleteDeck, listDecks, strategyById, DECK_SIZE } from '../lib/deck';

function DeckRow({ deck, accent }: { deck: Deck; accent: string }) {
  const navigate = useNavigate();
  const commander = useLiveQuery<CatalogueCard | undefined>(
    () => db.catalogue.get(deck.commanderId),
    [deck.commanderId],
  );
  const size = deckSize(deck.entries);
  const pct = Math.min(100, Math.round((size / DECK_SIZE) * 100));

  return (
    <li>
      <div className="flex items-center gap-3 rounded-xl bg-surface-1 p-3">
        <button
          onClick={() => navigate(`/decks/${deck.id}`)}
          className="tap-target flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="w-12 shrink-0">
            {commander ? (
              <CatalogueThumb card={commander} />
            ) : (
              <span className="block rounded-lg bg-surface-2" style={{ aspectRatio: '5 / 7' }} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{deck.name}</span>
              <ManaPips identity={deck.colorIdentity} size={14} />
            </span>
            <span className="mb-1.5 mt-0.5 block truncate text-xs text-neutral-400">
              {strategyById(deck.strategyId).name} · {size} / {DECK_SIZE} cards
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-surface-3">
              <span
                className="block h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: accent }}
              />
            </span>
          </span>
        </button>
        <button
          onClick={async () => {
            if (confirm(`Delete deck “${deck.name}”?`)) await deleteDeck(deck.id);
          }}
          className="tap-target flex items-center justify-center rounded-lg text-neutral-500 active:bg-surface-2"
          aria-label={`Delete ${deck.name}`}
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>
    </li>
  );
}

/** The deck shelf: your saved Commander decks, plus a way to start a new one. */
export function Decks() {
  const settings = useSettings();
  const decks = useLiveQuery(() => listDecks(), []);

  const rightActions = (
    <Link
      to="/decks/new"
      className="tap-target flex items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-black"
      style={{ backgroundColor: settings.accent }}
    >
      <PlusIcon className="h-5 w-5" />
      New
    </Link>
  );

  return (
    <div className="flex h-full flex-col">
      <Header title="Decks" back="/" accent={settings.accent} right={rightActions} />

      {decks === undefined ? (
        <div className="flex flex-1 items-center justify-center text-neutral-500">Loading…</div>
      ) : decks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-lg font-medium">No decks yet</p>
          <p className="text-sm text-neutral-400">
            Pick a commander and we’ll help you build around it from your collection.
          </p>
          <Link
            to="/decks/new"
            className="tap-target flex items-center gap-2 rounded-lg px-5 py-3 font-semibold text-black"
            style={{ backgroundColor: settings.accent }}
          >
            <PlusIcon className="h-5 w-5" />
            New Commander deck
          </Link>
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-2">
            {decks.map((d) => (
              <DeckRow key={d.id} deck={d} accent={settings.accent} />
            ))}
          </ul>
        </main>
      )}
    </div>
  );
}
