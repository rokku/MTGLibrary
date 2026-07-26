import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, getSettings, type AppSettings } from '../lib/settings';

/** Reactive app settings; re-renders when the meta table changes. */
export function useSettings(): AppSettings {
  return useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS;
}
