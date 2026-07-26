import { useCardImage } from '../hooks/useCardImage';

interface CardThumbProps {
  catalogueId: string;
  name: string;
  quantity?: number;
  onClick?: () => void;
  accent?: string;
}

/**
 * A single grid thumbnail: cached `small` image + quantity badge (only when the
 * stack is > 1, per spec). Falls back to a name placeholder if the image is
 * missing (e.g. cleared to free space).
 */
export function CardThumb({ catalogueId, name, quantity = 1, onClick, accent = '#f59e0b' }: CardThumbProps) {
  const { url, loading } = useCardImage(catalogueId, 'small');

  return (
    <button
      onClick={onClick}
      className="tap-target relative block w-full overflow-hidden rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-white/40"
      style={{ aspectRatio: '5 / 7' }}
      aria-label={name}
    >
      {url ? (
        <img src={url} alt={name} className="h-full w-full object-cover" loading="lazy" draggable={false} />
      ) : (
        <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-neutral-400">
          {loading ? '…' : name}
        </span>
      )}
      {quantity > 1 && (
        <span
          className="absolute right-1 top-1 min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-xs font-bold text-black shadow"
          style={{ backgroundColor: accent }}
        >
          {quantity}
        </span>
      )}
    </button>
  );
}
