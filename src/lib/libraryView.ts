import { EMPTY_FILTERS, type ActiveFilters, type SortSpec } from './query';

/**
 * The library's transient view state (filters, search, sort, layout). React
 * Router unmounts the Library route when you open a card, so plain component
 * state would reset on the way back. We stash it in a module-level singleton so
 * it survives navigation within a session — and resets on a full app reload,
 * which is the least surprising behaviour.
 */
export interface LibraryViewState {
  filters: ActiveFilters;
  searchInput: string;
  sort: SortSpec;
  view: 'grid' | 'list';
}

let saved: LibraryViewState = {
  filters: EMPTY_FILTERS,
  searchInput: '',
  sort: { key: 'name', dir: 'asc' },
  view: 'grid',
};

export const getLibraryView = (): LibraryViewState => saved;
export const setLibraryView = (s: LibraryViewState): void => {
  saved = s;
};
