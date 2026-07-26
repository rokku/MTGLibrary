import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { useSettings } from '../hooks/useSettings';
import { binderSets, type ShelfSort } from '../lib/binder';

const SORTS: { key: ShelfSort; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'completion', label: 'Completion' },
  { key: 'name', label: 'A–Z' },
];

/** The binder shelf: pick a set to flip through, with per-set completion. */
export function Binder() {
  const navigate = useNavigate();
  const settings = useSettings();
  const [sort, setSort] = useState<ShelfSort>('recent');
  const sets = useLiveQuery(() => binderSets(sort), [sort]);

  if (sets === undefined) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Binder" back="/" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Binder" back="/" accent={settings.accent} />

      {sets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-lg font-medium">Nothing to browse yet</p>
          <p className="text-sm text-neutral-400">Import a collection to fill your binder.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 border-b border-surface-2 px-3 py-2">
            <span className="mr-1 text-xs text-neutral-500">Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  sort === s.key ? 'bg-white text-black' : 'bg-surface-1 text-neutral-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <main className="flex-1 overflow-y-auto p-3">
            <ul className="space-y-2">
              {sets.map((s) => (
                <li key={s.setCode}>
                  <button
                    onClick={() => navigate(`/binder/${s.setCode}`)}
                    className="tap-target flex w-full items-center gap-3 rounded-xl bg-surface-1 px-4 py-3 text-left active:bg-surface-2"
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2 text-[11px] font-bold uppercase tracking-wide text-neutral-300"
                      aria-hidden
                    >
                      {s.setCode}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{s.setName}</span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-300">
                          {s.pct}%
                        </span>
                      </span>
                      <span className="mb-1.5 mt-0.5 block text-xs text-neutral-400">
                        {s.ownedDistinct} / {s.total} owned · {s.ownedCopies} card
                        {s.ownedCopies === 1 ? '' : 's'}
                      </span>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${s.pct}%`, backgroundColor: settings.accent }}
                        />
                      </span>
                    </span>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-neutral-500" />
                  </button>
                </li>
              ))}
            </ul>
          </main>
        </>
      )}
    </div>
  );
}
