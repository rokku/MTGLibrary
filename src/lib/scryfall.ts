/**
 * Runtime Scryfall helpers. The bulk catalogue is built offline (see
 * scripts/build-catalogue.ts); at runtime we only ever fetch card *images*
 * (from the image CDN) and, as a rare online fallback, a single card by id.
 *
 * Note: browsers forbid setting a custom User-Agent header, so image requests
 * go out with the default UA. Scryfall's image CDN does not require one.
 */

const API_BASE = 'https://api.scryfall.com';

export async function fetchImageBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}) for ${url}`);
  return res.blob();
}

export interface ScryfallCardLite {
  id: string;
  name: string;
  set: string;
  image_uris?: { small?: string; normal?: string };
}

/** Online-only fallback used when a CSV Scryfall ID is not in the local catalogue. */
export async function fetchCardById(id: string, signal?: AbortSignal): Promise<ScryfallCardLite | null> {
  try {
    const res = await fetch(`${API_BASE}/cards/${id}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as ScryfallCardLite;
  } catch {
    return null;
  }
}
