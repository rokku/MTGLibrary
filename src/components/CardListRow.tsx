import { ManaPips } from './ManaPips';
import { useReveal } from '../hooks/useReveal';
import type { GroupedCard } from '../lib/query';

function finishSummary(card: GroupedCard): string {
  const set = new Set(card.copies.map((c) => c.finish));
  const parts: string[] = [];
  if (set.has('nonfoil')) parts.push('NF');
  if (set.has('foil')) parts.push('F');
  if (set.has('etched')) parts.push('E');
  return parts.join('/') || '—';
}

function conditionSummary(card: GroupedCard): string {
  return [...new Set(card.copies.map((c) => c.condition))].join('/');
}

interface CardListProps {
  cards: GroupedCard[];
  onOpen: (catalogueId: string) => void;
}

export function CardList({ cards, onOpen }: CardListProps) {
  const { count, sentinelRef } = useReveal(cards.length, 100);

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-surface-2">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-surface-2 bg-surface-1 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          <span>Name</span>
          <span className="w-16 text-right">Set</span>
          <span className="w-24 text-right">Qty · Finish</span>
        </div>
        <ul>
          {cards.slice(0, count).map((c) => (
            <li key={c.catalogueId}>
              <button
                onClick={() => onOpen(c.catalogueId)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-surface-1 px-3 py-2 text-left active:bg-surface-1"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ManaPips identity={c.colorIdentity} size={16} />
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="w-16 text-right text-xs uppercase text-neutral-400">{c.setCode}</span>
                <span className="w-24 text-right text-xs text-neutral-300">
                  {c.totalQty} · {finishSummary(c)}
                  <span className="block text-[10px] text-neutral-500">{conditionSummary(c)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {count < cards.length && <div ref={sentinelRef} className="h-10" aria-hidden />}
    </>
  );
}
