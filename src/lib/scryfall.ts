/**
 * Runtime Scryfall helpers. The bulk catalogue is built offline (see
 * scripts/build-catalogue.ts); at runtime we fetch card *images* (from the
 * image CDN) and, during import, look up rows the local catalogue can't match.
 *
 * Note: browsers forbid setting a custom User-Agent header, so requests go out
 * with the default UA. Scryfall's API and image CDN both allow CORS.
 */
import type { ScryfallCard } from './projection';

const API_BASE = 'https://api.scryfall.com';

// Scryfall asks for 50–100ms between API requests. Hand out send slots at a
// fixed spacing so concurrent callers queue rather than burst.
const MIN_GAP_MS = 110;
let nextSlot = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_GAP_MS;
  if (slot > now) await sleep(slot - now);
}

/** Throttled API call. Resolves null on 404; retries once on 429. */
async function api<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (res.status === 404) return null;
    if (res.status === 429 && attempt === 0) {
      await sleep(1000);
      continue;
    }
    if (!res.ok) throw new Error(`Scryfall ${res.status} for ${path}`);
    return (await res.json()) as T;
  }
  throw new Error(`Scryfall rate limit for ${path}`);
}

export async function fetchImageBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}) for ${url}`);
  return res.blob();
}

export function fetchCardById(id: string, signal?: AbortSignal): Promise<ScryfallCard | null> {
  return api<ScryfallCard>(`/cards/${encodeURIComponent(id)}`, {}, signal);
}

export function fetchCardByCardmarketId(id: number, signal?: AbortSignal): Promise<ScryfallCard | null> {
  return api<ScryfallCard>(`/cards/cardmarket/${id}`, {}, signal);
}

/** Fuzzy name lookup, optionally restricted to a set code. */
export function fetchCardNamed(name: string, set?: string, signal?: AbortSignal): Promise<ScryfallCard | null> {
  const q = new URLSearchParams({ fuzzy: name });
  if (set) q.set('set', set);
  return api<ScryfallCard>(`/cards/named?${q}`, {}, signal);
}

export type CollectionIdentifier = { name: string; set?: string };

export const COLLECTION_BATCH = 75; // Scryfall's per-request maximum

/** Batch lookup of up to 75 identifiers. */
export async function fetchCollection(
  identifiers: CollectionIdentifier[],
  signal?: AbortSignal,
): Promise<ScryfallCard[]> {
  const res = await api<{ data: ScryfallCard[] }>(
    '/cards/collection',
    { method: 'POST', body: JSON.stringify({ identifiers }) },
    signal,
  );
  return res?.data ?? [];
}

export interface ScryfallSet {
  code: string;
  name: string;
}

/** Every set Scryfall knows, including ones newer than the local catalogue. */
export async function fetchSets(signal?: AbortSignal): Promise<ScryfallSet[]> {
  const res = await api<{ data: ScryfallSet[] }>('/sets', {}, signal);
  return res?.data ?? [];
}
