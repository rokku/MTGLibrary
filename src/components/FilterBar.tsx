import { useState } from 'react';
import {
  AdjustmentsHorizontalIcon,
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
  Squares2X2Icon,
  ListBulletIcon,
} from '@heroicons/react/24/outline';
import { ManaPip } from './ManaPips';
import { COLORS, SORT_OPTIONS, formatEur } from '../lib/constants';
import { QUERY_HELP } from '../lib/search';
import type { ActiveFilters, SortSpec } from '../lib/query';

export type ViewMode = 'grid' | 'list';

interface FilterBarProps {
  title: string;
  search: string;
  onSearch: (v: string) => void;
  filters: ActiveFilters;
  onToggleColor: (c: string) => void;
  activeCount: number;
  onOpenFilters: () => void;
  sort: SortSpec;
  onSort: (s: SortSpec) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  resultCount: number;
  resultValue: number;
}

// Colour has its own chips, so the summary covers the sheet-only facets.
function summarise(f: ActiveFilters): string[] {
  const parts: string[] = [];
  if (f.rarities.length) parts.push(`Rarity: ${f.rarities.length}`);
  if (f.types.length) parts.push(`Type: ${f.types.length}`);
  if (f.sets.length) parts.push(`Set: ${f.sets.length}`);
  if (f.finishes.length) parts.push(`Finish: ${f.finishes.length}`);
  if (f.conditions.length) parts.push(`Cond: ${f.conditions.length}`);
  if (f.tags.length) parts.push(`Tags: ${f.tags.length}`);
  if (f.cmcMin != null || f.cmcMax != null) parts.push(`MV: ${f.cmcMin ?? 0}–${f.cmcMax ?? 16}`);
  return parts;
}

export function FilterBar(props: FilterBarProps) {
  const { search, onSearch, filters, activeCount, onOpenFilters, sort, onSort, view, onView } = props;
  const applied = summarise(filters);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="sticky top-0 z-30 border-b border-surface-2 bg-surface-0/95 backdrop-blur">
      <div className="flex items-end justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold tracking-tight">{props.title}</h1>
          <p className="text-sm tabular-nums text-neutral-400">
            {props.resultCount.toLocaleString()} card{props.resultCount === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-accent">{formatEur(props.resultValue)}</span>
          </p>
        </div>
        <div className="flex overflow-hidden rounded-xl bg-surface-2">
          <button
            onClick={() => onView('grid')}
            className={`tap-target grid place-items-center ${view === 'grid' ? 'bg-surface-3 text-neutral-100' : 'text-neutral-400'}`}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
          >
            <Squares2X2Icon className="h-5 w-5" />
          </button>
          <button
            onClick={() => onView('list')}
            className={`tap-target grid place-items-center ${view === 'list' ? 'bg-surface-3 text-neutral-100' : 'text-neutral-400'}`}
            aria-label="List view"
            aria-pressed={view === 'list'}
          >
            <ListBulletIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pt-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search — e.g. t:creature c:u cmc<=3"
            className="w-full rounded-xl bg-surface-2 py-2.5 pl-10 pr-10 text-sm outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-accent/50"
            type="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            onClick={() => setHelpOpen((v) => !v)}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 active:bg-surface-3"
            aria-label="Search syntax help"
          >
            <QuestionMarkCircleIcon className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={onOpenFilters}
          className="tap-target relative flex items-center justify-center rounded-xl bg-surface-2 px-3 active:bg-surface-3"
          aria-label="Filters"
        >
          <AdjustmentsHorizontalIcon className="h-5 w-5" />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-on-accent">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {helpOpen && (
        <div className="mx-3 mt-2 rounded-xl bg-surface-1 p-3">
          <p className="mb-2 text-xs text-neutral-400">
            Combine terms (all must match); prefix any with <code className="text-neutral-300">-</code> to exclude.
          </p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {QUERY_HELP.map((h) => (
              <div key={h.syntax} className="flex items-baseline gap-2 text-xs">
                <code className="whitespace-nowrap font-semibold text-neutral-200">{h.syntax}</code>
                <span className="text-neutral-500">{h.desc}</span>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex gap-1.5" role="group" aria-label="Colour identity">
          {COLORS.map((c) => {
            const on = filters.colors.includes(c);
            return (
              <button
                key={c}
                onClick={() => props.onToggleColor(c)}
                aria-pressed={on}
                className={`grid h-8 w-8 place-items-center rounded-full transition ${
                  on ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-0' : 'opacity-40'
                }`}
              >
                <ManaPip color={c} size={26} />
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <select
            value={sort.key}
            onChange={(e) => {
              const opt = SORT_OPTIONS.find((o) => o.key === e.target.value)!;
              onSort({ key: opt.key, dir: opt.defaultDir });
            }}
            className="h-9 appearance-none rounded-lg bg-surface-2 px-2.5 text-sm outline-none"
            aria-label="Sort by"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key} className="bg-surface-2">
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => onSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
            className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-sm active:bg-surface-3"
            aria-label={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sort.dir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {applied.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pb-2">
          {applied.map((p) => (
            <span key={p} className="whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs text-neutral-300">
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
