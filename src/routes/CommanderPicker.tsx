import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { ManaPips } from '../components/ManaPips';
import { CatalogueThumb } from '../components/CatalogueThumb';
import { CardHoverCard } from '../components/CardHoverCard';
import { useSettings } from '../hooks/useSettings';
import type { CatalogueCard } from '../lib/db';
import { createDeck, ownedCommanders, searchCommanders, suggestThemes } from '../lib/deck';

function CommanderRow({ card, disabled, onChoose }: { card: CatalogueCard; disabled: boolean; onChoose: () => void }) {
  const themes = suggestThemes(card).slice(0, 3);
  return (
    <li>
      <div className="flex items-center gap-3 rounded-xl bg-surface-1 p-2.5">
        <CardHoverCard catalogueId={card.id} className="w-12 shrink-0">
          <CatalogueThumb card={card} />
        </CardHoverCard>
        <button onClick={onChoose} disabled={disabled} className="tap-target min-w-0 flex-1 text-left disabled:opacity-50">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{card.name}</span>
            <ManaPips identity={card.colorIdentity} size={14} />
          </span>
          <span className="block truncate text-xs text-neutral-400">{card.typeLine}</span>
          {themes.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {themes.map((s) => (
                <span key={s.theme.id} className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-neutral-300">
                  {s.theme.name}
                </span>
              ))}
            </span>
          )}
        </button>
      </div>
    </li>
  );
}

/** Step one of a new deck: pick a legendary from your library or the catalogue. */
export function CommanderPicker() {
  const navigate = useNavigate();
  const settings = useSettings();
  const [tab, setTab] = useState<'library' | 'search'>('library');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogueCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  const library = useLiveQuery(() => ownedCommanders(), []);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const rows = await searchCommanders(q);
      if (!cancelled) {
        setResults(rows);
        setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function choose(card: CatalogueCard) {
    if (creating) return;
    setCreating(true);
    const deck = await createDeck(card);
    navigate(`/decks/${deck.id}`, { replace: true });
  }

  function chooseRandom() {
    if (!library || library.length === 0) return;
    choose(library[Math.floor(Math.random() * library.length)]!);
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Choose a commander" back="/decks" accent={settings.accent} />

      <div className="flex items-center gap-1 border-b border-surface-2 px-3 py-2">
        {(['library', 'search'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === t ? 'bg-white text-black' : 'bg-surface-1 text-neutral-300'
            }`}
          >
            {t === 'library' ? 'My library' : 'Search all'}
          </button>
        ))}
        {tab === 'library' && library && library.length > 0 && (
          <button
            onClick={chooseRandom}
            disabled={creating}
            className="tap-target ml-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
            style={{ backgroundColor: settings.accent }}
          >
            <SparklesIcon className="h-4 w-4" />
            Surprise me
          </button>
        )}
      </div>

      {tab === 'search' && (
        <div className="border-b border-surface-2 p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search legendary creatures…"
            className="w-full rounded-lg bg-surface-1 px-4 py-2.5 text-sm outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-white/20"
          />
          <p className="mt-2 px-1 text-xs text-neutral-500">
            The commander sets your deck’s colour identity. Lead with any legendary — owned or not.
          </p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-3">
        {tab === 'library' ? (
          library === undefined ? (
            <p className="pt-10 text-center text-sm text-neutral-500">Loading…</p>
          ) : library.length === 0 ? (
            <div className="flex flex-col items-center gap-2 pt-10 text-center">
              <p className="text-sm text-neutral-400">No legendary creatures in your collection yet.</p>
              <button onClick={() => setTab('search')} className="rounded-lg bg-surface-2 px-4 py-2 text-sm active:bg-surface-3">
                Search the full catalogue
              </button>
            </div>
          ) : (
            <>
              <p className="mb-2 px-1 text-xs text-neutral-500">
                {library.length} possible commander{library.length === 1 ? '' : 's'} in your library
              </p>
              <ul className="space-y-2">
                {library.map((card) => (
                  <CommanderRow key={card.id} card={card} disabled={creating} onChoose={() => choose(card)} />
                ))}
              </ul>
            </>
          )
        ) : query.trim().length < 2 ? (
          <p className="pt-10 text-center text-sm text-neutral-500">Type a name to search.</p>
        ) : searching && results.length === 0 ? (
          <p className="pt-10 text-center text-sm text-neutral-500">Searching…</p>
        ) : results.length === 0 ? (
          <p className="pt-10 text-center text-sm text-neutral-500">No legendary creatures match “{query}”.</p>
        ) : (
          <ul className="space-y-2">
            {results.map((card) => (
              <CommanderRow key={card.id} card={card} disabled={creating} onChoose={() => choose(card)} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
