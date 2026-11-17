import { CardThumb } from './CardThumb';
import { CardHoverCard } from './CardHoverCard';
import { useReveal } from '../hooks/useReveal';
import type { GroupedCard } from '../lib/query';

interface CardGridProps {
  cards: GroupedCard[];
  onOpen: (catalogueId: string) => void;
}

export function CardGrid({ cards, onOpen }: CardGridProps) {
  const { count, sentinelRef } = useReveal(cards.length);

  return (
    <>
      <div className="grid grid-cols-3 gap-1.5 md:grid-cols-4">
        {cards.slice(0, count).map((c) => (
          <CardHoverCard key={c.catalogueId} catalogueId={c.catalogueId} className="block">
            <CardThumb
              catalogueId={c.catalogueId}
              name={c.name}
              quantity={c.totalQty}
              onClick={() => onOpen(c.catalogueId)}
            />
          </CardHoverCard>
        ))}
      </div>
      {count < cards.length && <div ref={sentinelRef} className="h-10" aria-hidden />}
    </>
  );
}
