import { gunzipSync } from 'fflate';
import { db, type CatalogueCard } from './db';

export interface CatalogueManifest {
  version: string;
  updatedAt: string;
  cardCount: number;
  chunks: { key: string; file: string; count: number }[];
}

const MANIFEST_URL = `${import.meta.env.BASE_URL}data/manifest.json`;
const META_VERSION_KEY = 'catalogueVersion';

export interface LoadProgress {
  loadedCards: number;
  totalCards: number;
  chunk: string;
}

export async function fetchManifest(): Promise<CatalogueManifest | null> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as CatalogueManifest;
  } catch {
    return null;
  }
}

export async function loadedCatalogueVersion(): Promise<string | null> {
  const row = await db.meta.get(META_VERSION_KEY);
  return (row?.value as string | undefined) ?? null;
}

export async function catalogueCount(): Promise<number> {
  return db.catalogue.count();
}

/** True when the local catalogue is populated and matches the deployed version. */
export async function isCatalogueReady(): Promise<boolean> {
  const manifest = await fetchManifest();
  if (!manifest) {
    // Offline / no manifest: rely on whatever we have locally.
    return (await db.catalogue.count()) > 0;
  }
  const local = await loadedCatalogueVersion();
  return local === manifest.version && (await db.catalogue.count()) > 0;
}

async function decompressChunk(file: string): Promise<CatalogueCard[]> {
  const url = `${import.meta.env.BASE_URL}data/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch chunk ${file} (${res.status})`);

  // The chunk files end in `.gz`, so depending on the host (Vite dev, a CDN, a
  // tunnel) the browser may transparently decompress them via `Content-Encoding:
  // gzip`, or may hand us the raw gzip bytes. Detect the gzip magic (0x1f 0x8b)
  // and inflate with a pure-JS gunzip (fflate) only when still compressed. Using
  // fflate rather than the browser's `DecompressionStream` keeps this working on
  // every browser/iOS version, and over tunnels that re-encode the transport.
  const buf = new Uint8Array(await res.arrayBuffer());
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const bytes = isGzip ? gunzipSync(buf) : buf;
  const text = new TextDecoder().decode(bytes);

  const cards: CatalogueCard[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    cards.push(JSON.parse(line) as CatalogueCard);
  }
  return cards;
}

/**
 * Load (or refresh) the catalogue into IndexedDB from the deployed chunk files.
 * Idempotent: bulkPut upserts, so a re-run after a version bump just overwrites.
 */
export async function loadCatalogue(
  manifest: CatalogueManifest,
  onProgress?: (p: LoadProgress) => void,
): Promise<void> {
  let loaded = 0;
  for (const chunk of manifest.chunks) {
    const cards = await decompressChunk(chunk.file);
    await db.catalogue.bulkPut(cards);
    loaded += cards.length;
    onProgress?.({ loadedCards: loaded, totalCards: manifest.cardCount, chunk: chunk.key });
  }
  await db.meta.put({ key: META_VERSION_KEY, value: manifest.version });
}

/** Ensure the catalogue is present; loads it if missing or out of date. */
export async function ensureCatalogue(
  onProgress?: (p: LoadProgress) => void,
): Promise<{ ok: boolean; offline: boolean }> {
  const manifest = await fetchManifest();
  if (!manifest) {
    const have = (await db.catalogue.count()) > 0;
    return { ok: have, offline: true };
  }
  const local = await loadedCatalogueVersion();
  const count = await db.catalogue.count();
  if (local === manifest.version && count > 0) {
    return { ok: true, offline: false };
  }
  await loadCatalogue(manifest, onProgress);
  return { ok: true, offline: false };
}
