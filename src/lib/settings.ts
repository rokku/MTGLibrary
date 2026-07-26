import { db } from './db';

export interface AppSettings {
  appName: string;
  accent: string; // hex colour used for badges/highlights
  firstRunDone: boolean;
}

export const ACCENTS: { name: string; value: string }[] = [
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Sky', value: '#38bdf8' },
  { name: 'Violet', value: '#a78bfa' },
  { name: 'Rose', value: '#fb7185' },
];

export const DEFAULT_SETTINGS: AppSettings = {
  appName: 'Collection',
  accent: '#f59e0b',
  firstRunDone: false,
};

const KEYS: (keyof AppSettings)[] = ['appName', 'accent', 'firstRunDone'];

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.meta.bulkGet(KEYS as string[]);
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  KEYS.forEach((key, i) => {
    const v = rows[i]?.value;
    if (v !== undefined) (s as unknown as Record<string, unknown>)[key] = v;
  });
  return s;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const entries = Object.entries(patch);
  await db.meta.bulkPut(entries.map(([key, value]) => ({ key, value })));
}
