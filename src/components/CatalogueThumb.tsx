import { useCardImage } from '../hooks/useCardImage';
import type { CatalogueCard } from '../lib/db';
import type { ImageSize } from '../lib/db';

interface CatalogueThumbProps {
  card: Pick<CatalogueCard, 'id' | 'name' | 'imgSmall' | 'imgNormal'>;
  size?: ImageSize;
  onClick?: () => void;
  className?: string;
  badge?: React.ReactNode;
}

/**
 * A card thumbnail for the deck builder. Prefers the locally-cached blob (owned
 * cards) and falls back to the Scryfall URL stored in the catalogue, so cards
 * you don't own yet — including the commander — still show art when online.
 */
export function CatalogueThumb({ card, size = 'small', onClick, className = '', badge }: CatalogueThumbProps) {
  const { url } = useCardImage(card.id, size);
  const src = url ?? (size === 'normal' ? card.imgNormal : card.imgSmall);

  const inner = (
    <>
      {src ? (
        <img src={src} alt={card.name} className="h-full w-full object-cover" loading="lazy" draggable={false} />
      ) : (
        <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-neutral-400">
          {card.name}
        </span>
      )}
      {badge}
    </>
  );

  const base = `relative block w-full overflow-hidden rounded-lg bg-surface-2 ${className}`;
  if (!onClick) {
    return (
      <div className={base} style={{ aspectRatio: '5 / 7' }}>
        {inner}
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`tap-target ${base} focus:outline-none focus:ring-2 focus:ring-white/40`}
      style={{ aspectRatio: '5 / 7' }}
      aria-label={card.name}
    >
      {inner}
    </button>
  );
}
