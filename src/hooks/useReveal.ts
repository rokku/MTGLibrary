import { useEffect, useRef, useState } from 'react';

/**
 * Incremental reveal for long lists: renders `step` items and grows the window
 * whenever a sentinel scrolls into view. Keeps the mounted DOM (and the per-tile
 * IndexedDB image lookups) bounded so a 5000-card library stays smooth.
 */
export function useReveal(total: number, step = 60): {
  count: number;
  sentinelRef: (node: HTMLElement | null) => void;
} {
  const [count, setCount] = useState(step);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Reset when the underlying list shrinks/changes size (new filter, etc.).
  useEffect(() => {
    setCount(step);
  }, [total, step]);

  const sentinelRef = (node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setCount((c) => Math.min(c + step, total));
        }
      },
      { rootMargin: '600px' },
    );
    observerRef.current.observe(node);
  };

  return { count: Math.min(count, total), sentinelRef };
}
