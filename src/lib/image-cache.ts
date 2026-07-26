import { db, imageKey, type CatalogueCard, type ImageSize } from './db';
import { fetchImageBlob } from './scryfall';

const CONCURRENCY = 6; // Scryfall-friendly; well under 10 req/s

export interface ImageProgress {
  done: number;
  total: number;
  failed: number;
  cached: number;
}

export async function hasImage(catalogueId: string, size: ImageSize): Promise<boolean> {
  return (await db.images.get(imageKey(catalogueId, size))) != null;
}

export async function getImageBlob(catalogueId: string, size: ImageSize): Promise<Blob | null> {
  const row = await db.images.get(imageKey(catalogueId, size));
  return row?.blob ?? null;
}

/**
 * Download `small` images for the given catalogue cards, skipping any already
 * cached, throttled to CONCURRENCY simultaneous requests. Reports progress and
 * honours an AbortSignal for pause/cancel.
 */
export async function downloadImages(
  cards: CatalogueCard[],
  size: ImageSize,
  onProgress?: (p: ImageProgress) => void,
  signal?: AbortSignal,
): Promise<ImageProgress> {
  const progress: ImageProgress = { done: 0, total: cards.length, failed: 0, cached: 0 };

  let cursor = 0;
  async function worker() {
    while (cursor < cards.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const card = cards[cursor++];
      if (!card) break;
      const key = imageKey(card.id, size);
      const url = size === 'small' ? card.imgSmall : card.imgNormal;

      try {
        const existing = await db.images.get(key);
        if (existing) {
          progress.cached++;
        } else if (!url) {
          progress.failed++;
        } else {
          const blob = await fetchImageBlob(url, signal);
          await db.images.put({
            key,
            catalogueId: card.id,
            size,
            blob,
            fetchedAt: Date.now(),
          });
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        progress.failed++;
      } finally {
        progress.done++;
        onProgress?.({ ...progress });
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, cards.length) }, worker);
  await Promise.all(workers);
  return progress;
}

/** Fetch + cache a single image on demand (e.g. the `normal` art in card detail). */
export async function ensureImage(
  card: CatalogueCard,
  size: ImageSize,
): Promise<Blob | null> {
  const key = imageKey(card.id, size);
  const existing = await db.images.get(key);
  if (existing) return existing.blob;
  const url = size === 'small' ? card.imgSmall : card.imgNormal;
  if (!url) return null;
  try {
    const blob = await fetchImageBlob(url);
    await db.images.put({ key, catalogueId: card.id, size, blob, fetchedAt: Date.now() });
    return blob;
  } catch {
    return null;
  }
}
