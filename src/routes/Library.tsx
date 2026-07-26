import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Cog6ToothIcon, ArrowUpTrayIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { FilterBar, type ViewMode } from '../components/FilterBar';
import { FilterMenu } from '../components/FilterMenu';
import { CardGrid } from '../components/CardGrid';
import { CardList } from '../components/CardListRow';
import { useSettings } from '../hooks/useSettings';
import {
  EMPTY_FILTERS,
  allOwned,
  facetOptions,
  hasActiveFilters,
  queryLibrary,
  type ActiveFilters,
  type SortSpec,
} from '../lib/query';

function countActive(f: ActiveFilters): number {
  return (
    f.colors.length +
    f.rarities.length +
    f.sets.length +
    f.types.length +
    f.finishes.length +
    f.conditions.length +
    f.tags.length +
    (f.cmcMin != null || f.cmcMax != null ? 1 : 0)
  );
}

export function Library() {
  const navigate = useNavigate();
  const settings = useSettings();
  const owned = useLiveQuery(() => allOwned(), []);

  const [filters, setFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState<SortSpec>({ key: 'name', dir: 'asc' });
  const [view, setView] = useState<ViewMode>('grid');
  const [menuOpen, setMenuOpen] = useState(false);

  // Debounce the search box into the active filter set (200ms per spec).
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchInput })), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const facets = useMemo(() => facetOptions(owned ?? []), [owned]);
  const results = useMemo(
    () => queryLibrary(owned ?? [], filters, sort),
    [owned, filters, sort],
  );
  const totalValue = useMemo(() => results.reduce((s, c) => s + c.valueEur, 0), [results]);

  if (owned === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">Loading…</div>
    );
  }

  const rightActions = (
    <>
      <Link to="/binder" className="tap-target flex items-center justify-center rounded-lg active:bg-surface-2" aria-label="Binder browser">
        <RectangleStackIcon className="h-6 w-6" />
      </Link>
      <Link to="/settings" className="tap-target flex items-center justify-center rounded-lg active:bg-surface-2" aria-label="Settings">
        <Cog6ToothIcon className="h-6 w-6" />
      </Link>
    </>
  );

  if (owned.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Header title={settings.appName} accent={settings.accent} right={rightActions} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-lg font-medium">Your collection is empty</p>
          <p className="text-sm text-neutral-400">Import a TCGPowertools CSV to get started.</p>
          <Link
            to="/import"
            className="tap-target flex items-center gap-2 rounded-lg px-5 py-3 font-semibold text-black"
            style={{ backgroundColor: settings.accent }}
          >
            <ArrowUpTrayIcon className="h-5 w-5" />
            Import collection
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={settings.appName} accent={settings.accent} right={rightActions} />
      <FilterBar
        search={searchInput}
        onSearch={setSearchInput}
        filters={filters}
        activeCount={countActive(filters)}
        onOpenFilters={() => setMenuOpen(true)}
        sort={sort}
        onSort={setSort}
        view={view}
        onView={setView}
        resultCount={results.length}
        resultValue={totalValue}
      />

      <main className="flex-1 overflow-y-auto p-3">
        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-16 text-center">
            <p className="text-neutral-400">No cards match these filters.</p>
            {hasActiveFilters(filters) && (
              <button
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setSearchInput('');
                }}
                className="rounded-lg bg-surface-2 px-4 py-2 text-sm active:bg-surface-3"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : view === 'grid' ? (
          <CardGrid cards={results} accent={settings.accent} onOpen={(id) => navigate(`/card/${id}`)} />
        ) : (
          <CardList cards={results} onOpen={(id) => navigate(`/card/${id}`)} />
        )}
      </main>

      <FilterMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        filters={filters}
        onChange={setFilters}
        facets={facets}
      />
    </div>
  );
}
