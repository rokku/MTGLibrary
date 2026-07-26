import { useEffect, useState } from 'react';
import { db, imageKey, type ImageSize } from '../lib/db';

/**
 * Resolve a cached card image (from IndexedDB) to an object URL. Reads once —
 * images don't mutate during browsing — and revokes the URL on unmount so the
 * grid can render thousands of thumbnails without leaking memory.
 */
export function useCardImage(catalogueId: string | null, size: ImageSize): {
  url: string | null;
  loading: boolean;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setUrl(null);

    if (!catalogueId) {
      setLoading(false);
      return;
    }

    db.images
      .get(imageKey(catalogueId, size))
      .then((row) => {
        if (cancelled) return;
        if (row?.blob) {
          objectUrl = URL.createObjectURL(row.blob);
          setUrl(objectUrl);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [catalogueId, size]);

  return { url, loading };
}
