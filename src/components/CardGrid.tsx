import { CardThumb } from './CardThumb';
import { useReveal } from '../hooks/useReveal';
import type { GroupedCard } from '../lib/query';

interface CardGridProps {
  cards: GroupedCard[];
  onOpen: (catalogueId: string) => void;
  accent: string;
}

export function CardGrid({ cards, onOpen, accent }: CardGridProps) {
  const { count, sentinelRef } = useReveal(cards.length);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {cards.slice(0, count).map((c) => (
          <CardThumb
            key={c.catalogueId}
            catalogueId={c.catalogueId}
            name={c.name}
            quantity={c.totalQty}
            accent={accent}
            onClick={() => onOpen(c.catalogueId)}
          />
        ))}
      </div>
      {count < cards.length && <div ref={sentinelRef} className="h-10" aria-hidden />}
    </>
  );
}
