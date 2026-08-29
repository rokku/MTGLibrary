import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { db, type CatalogueCard } from '../lib/db';
import { useCardImage } from '../hooks/useCardImage';
import { ManaPips } from './ManaPips';

/** Devices with a real pointer get the hover preview; touch just taps through. */
const CAN_HOVER =
  typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// Small module-level cache so re-hovering a card doesn't hit IndexedDB again.
const cardCache = new Map<string, CatalogueCard>();
async function loadCard(id: string): Promise<CatalogueCard | undefined> {
  const hit = cardCache.get(id);
  if (hit) return hit;
  const c = await db.catalogue.get(id);
  if (c) cardCache.set(id, c);
  return c;
}

type Anchor = { top: number; left: number; right: number; bottom: number };

const PANEL_W = 380;

function PreviewPanel({ card, anchor }: { card: CatalogueCard; anchor: Anchor }) {
  const ref = useRef<HTMLDivElement>(null);
  const { url } = useCardImage(card.id, 'normal');
  const src = url ?? (card.imgNormal || card.imgSmall);
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    visibility: 'hidden',
    width: PANEL_W,
  });

  // Place beside the trigger, flipping/clamping to stay on screen. Re-runs when
  // the image loads (which changes the panel height).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const m = 8;
    let left = anchor.right + m;
    if (left + pw > window.innerWidth - m) left = anchor.left - m - pw; // flip to the left
    if (left < m) left = Math.max(m, window.innerWidth - pw - m);
    let top = anchor.top;
    if (top + ph > window.innerHeight - m) top = window.innerHeight - ph - m;
    if (top < m) top = m;
    setStyle({ position: 'fixed', top, left, width: PANEL_W, visibility: 'visible' });
  }, [anchor, card.id, url]);

  const ptLine =
    card.power != null && card.toughness != null
      ? `${card.power}/${card.toughness}`
      : card.loyalty != null
        ? `Loyalty ${card.loyalty}`
        : null;

  return createPortal(
    <div
      ref={ref}
      style={{ ...style, zIndex: 9999, pointerEvents: 'none' }}
      className="flex gap-3 rounded-xl border border-surface-3 bg-surface-0/95 p-3 shadow-2xl backdrop-blur"
    >
      <div className="w-[150px] shrink-0 overflow-hidden rounded-lg bg-surface-2" style={{ aspectRatio: '5 / 7' }}>
        {src ? (
          <img src={src} alt={card.name} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-neutral-400">
            {card.name}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight">{card.name}</h3>
          <ManaPips identity={card.colorIdentity} size={13} />
        </div>
        <p className="mt-0.5 text-xs text-neutral-400">{card.typeLine}</p>

        <div className="mt-1 flex items-center gap-3 text-xs text-neutral-300">
          <span className="tabular-nums">MV {card.cmc}</span>
          {ptLine && <span className="font-semibold tabular-nums">{ptLine}</span>}
        </div>

        {card.oracleText && (
          <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-snug text-neutral-200">
            {card.oracleText}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface CardHoverCardProps {
  catalogueId: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wrap any card trigger to show a floating preview (art + name, mana value,
 * oracle text, P/T) while the pointer rests on it. No-op on touch devices, so
 * the underlying tap/click behaviour is untouched.
 */
export function CardHoverCard({ catalogueId, children, className }: CardHoverCardProps) {
  const [card, setCard] = useState<CatalogueCard | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!CAN_HOVER) return <>{children}</>;

  function rectOf(): Anchor | null {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
  }

  function open() {
    if (timer.current) window.clearTimeout(timer.current);
    // Small delay so brushing past cards doesn't flash previews.
    timer.current = window.setTimeout(async () => {
      const c = await loadCard(catalogueId);
      if (!c) return;
      setAnchor(rectOf());
      setCard(c);
    }, 120);
  }

  function close() {
    if (timer.current) window.clearTimeout(timer.current);
    setCard(null);
    setAnchor(null);
  }

  return (
    <span
      ref={wrapRef}
      className={className}
      onMouseEnter={open}
      onMouseLeave={close}
      onMouseDown={close}
    >
      {children}
      {card && anchor && <PreviewPanel card={card} anchor={anchor} />}
    </span>
  );
}
