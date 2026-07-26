import {
  AdjustmentsHorizontalIcon,
  ArrowsUpDownIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ListBulletIcon,
} from '@heroicons/react/24/outline';
import { SORT_OPTIONS, formatEur } from '../lib/constants';
import { hasActiveFilters, type ActiveFilters, type SortSpec } from '../lib/query';

export type ViewMode = 'grid' | 'list';

interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  filters: ActiveFilters;
  activeCount: number;
  onOpenFilters: () => void;
  sort: SortSpec;
  onSort: (s: SortSpec) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  resultCount: number;
  resultValue: number;
}

function summarise(f: ActiveFilters): string[] {
  const parts: string[] = [];
  if (f.colors.length) parts.push(`Colour: ${f.colors.join('')}`);
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

  return (
    <div className="sticky top-0 z-30 border-b border-surface-2 bg-surface-0/95 backdrop-blur">
      <div className="flex items-center gap-2 px-3 pt-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name or type…"
            className="w-full rounded-lg bg-surface-2 py-2.5 pl-10 pr-3 text-sm outline-none placeholder:text-neutral-500"
            type="search"
            enterKeyHint="search"
          />
        </div>
        <button
          onClick={onOpenFilters}
          className="tap-target relative flex items-center gap-1 rounded-lg bg-surface-2 px-3 py-2.5 text-sm active:bg-surface-3"
        >
          <AdjustmentsHorizontalIcon className="h-5 w-5" />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-black">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        <label className="relative flex items-center gap-1 rounded-lg bg-surface-2 pl-2">
          <ArrowsUpDownIcon className="h-4 w-4 text-neutral-400" />
          <select
            value={sort.key}
            onChange={(e) => {
              const opt = SORT_OPTIONS.find((o) => o.key === e.target.value)!;
              onSort({ key: opt.key, dir: opt.defaultDir });
            }}
            className="appearance-none bg-transparent py-2 pr-2 text-sm outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key} className="bg-surface-2">
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => onSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          className="tap-target rounded-lg bg-surface-2 px-3 py-2 text-sm active:bg-surface-3"
          aria-label="Toggle sort direction"
        >
          {sort.dir === 'asc' ? '↑' : '↓'}
        </button>

        <div className="ml-auto flex overflow-hidden rounded-lg bg-surface-2">
          <button
            onClick={() => onView('grid')}
            className={`tap-target p-2 ${view === 'grid' ? 'bg-surface-3' : ''}`}
            aria-label="Grid view"
          >
            <Squares2X2Icon className="h-5 w-5" />
          </button>
          <button
            onClick={() => onView('list')}
            className={`tap-target p-2 ${view === 'list' ? 'bg-surface-3' : ''}`}
            aria-label="List view"
          >
            <ListBulletIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {(applied.length > 0 || hasActiveFilters(filters)) && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pb-2">
          {applied.map((p) => (
            <span key={p} className="whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs text-neutral-300">
              {p}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-3 pb-2 text-sm text-neutral-400">
        <span>
          {props.resultCount} card{props.resultCount === 1 ? '' : 's'}
        </span>
        <span>{formatEur(props.resultValue)}</span>
      </div>
    </div>
  );
}
