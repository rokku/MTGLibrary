import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { useSettings } from '../hooks/useSettings';
import { useCardImage } from '../hooks/useCardImage';
import {
  PER_PAGE_OPTIONS,
  loadBinderSet,
  paginate,
  type BinderSlot,
  type PerPage,
} from '../lib/binder';

const COLS: Record<PerPage, string> = {
  4: 'grid-cols-2',
  9: 'grid-cols-3',
  12: 'grid-cols-3',
};

/** One pocket in a binder page: an owned card image, or an empty labelled slot. */
function Pocket({ slot, accent, onOpen }: { slot: BinderSlot; accent: string; onOpen: () => void }) {
  const owned = slot.owned > 0;
  const { url } = useCardImage(owned ? slot.card.id : null, 'small');

  return (
    <button
      onClick={onOpen}
      className={`tap-target relative block w-full overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-white/40 ${
        owned ? 'bg-surface-2' : 'border border-dashed border-surface-3 bg-surface-1/40'
      }`}
      style={{ aspectRatio: '5 / 7' }}
      aria-label={`${slot.card.name} #${slot.card.collectorNumber}${owned ? '' : ' (not owned)'}`}
    >
      {owned && url ? (
        <img src={url} alt={slot.card.name} className="h-full w-full object-cover" loading="lazy" draggable={false} />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1.5 text-center">
          <span className={`text-[11px] font-semibold ${owned ? 'text-neutral-300' : 'text-neutral-600'}`}>
            #{slot.card.collectorNumber}
          </span>
          <span className={`line-clamp-3 text-[10px] leading-tight ${owned ? 'text-neutral-400' : 'text-neutral-500'}`}>
            {slot.card.name}
          </span>
        </span>
      )}
      {slot.owned > 1 && (
        <span
          className="absolute right-1 top-1 min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-xs font-bold text-black shadow"
          style={{ backgroundColor: accent }}
        >
          {slot.owned}
        </span>
      )}
    </button>
  );
}

function PageGrid({
  slots,
  perPage,
  accent,
  onOpen,
}: {
  slots: BinderSlot[];
  perPage: PerPage;
  accent: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={`grid ${COLS[perPage]} gap-2`}>
      {slots.map((s) => (
        <Pocket key={s.card.id} slot={s} accent={accent} onOpen={() => onOpen(s.card.id)} />
      ))}
      {/* Pad the last page so pockets keep their size */}
      {Array.from({ length: perPage - slots.length }).map((_, i) => (
        <div key={`pad-${i}`} className="rounded-lg" style={{ aspectRatio: '5 / 7' }} aria-hidden />
      ))}
    </div>
  );
}

export function BinderSet() {
  const { setCode } = useParams<{ setCode: string }>();
  const navigate = useNavigate();
  const settings = useSettings();

  const [perPage, setPerPage] = useState<PerPage>(9);
  const [page, setPage] = useState(0);
  // An in-flight page turn: which page is leaving, which is arriving, direction.
  const [anim, setAnim] = useState<{ from: number; to: number; dir: 'next' | 'prev' } | null>(null);
  const touchX = useRef<number | null>(null);

  const data = useLiveQuery(() => (setCode ? loadBinderSet(setCode) : null), [setCode]);
  const pages = useMemo(() => (data ? paginate(data.slots, perPage) : []), [data, perPage]);

  // Keep the page index valid when perPage changes or data loads.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, pages.length - 1)));
    setAnim(null);
  }, [pages.length]);

  function turn(dir: 'next' | 'prev') {
    if (anim) return;
    const to = dir === 'next' ? page + 1 : page - 1;
    if (to < 0 || to >= pages.length) return;
    setAnim({ from: page, to, dir });
  }

  // Arrow-key navigation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') turn('next');
      else if (e.key === 'ArrowLeft') turn('prev');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (data === undefined) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Binder" back="/binder" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Loading…</div>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Binder" back="/binder" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Set not found in catalogue.</div>
      </div>
    );
  }

  const open = (id: string) => navigate(`/card/${id}`);
  // What the stage shows beneath the turning leaf: going forward we reveal the
  // destination page; going back the current page stays put while the previous
  // page swings in over it.
  const basePage = anim ? (anim.dir === 'next' ? anim.to : anim.from) : page;

  return (
    <div className="flex h-full flex-col">
      <Header title={data.setName} back="/binder" accent={settings.accent} />

      {/* Per-page selector + set progress */}
      <div className="flex items-center justify-between gap-2 border-b border-surface-2 px-3 py-2">
        <span className="text-xs text-neutral-400">
          {data.ownedDistinct} / {data.total} owned
        </span>
        <div className="flex items-center gap-1 rounded-lg bg-surface-1 p-0.5">
          {PER_PAGE_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setPerPage(n)}
              className={`rounded-md px-3 py-1 text-sm ${perPage === n ? 'bg-white text-black' : 'text-neutral-300'}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Binder stage */}
      <main className="flex-1 overflow-y-auto p-3">
        <div
          className="binder-stage relative mx-auto max-w-md"
          onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
          onTouchEnd={(e) => {
            const endX = e.changedTouches[0]?.clientX;
            if (touchX.current == null || endX == null) return;
            const dx = endX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > 45) turn(dx < 0 ? 'next' : 'prev');
          }}
        >
          {/* Base layer: the page being revealed */}
          <PageGrid slots={pages[basePage] ?? []} perPage={perPage} accent={settings.accent} onOpen={open} />

          {/* Turning leaf */}
          {anim && (
            <div
              key={`${anim.from}-${anim.to}`}
              className={`binder-leaf ${anim.dir === 'next' ? 'binder-leaf--next' : 'binder-leaf--prev'}`}
              onAnimationEnd={() => {
                setPage(anim.to);
                setAnim(null);
              }}
            >
              <div className="binder-leaf__face binder-leaf__front">
                <PageGrid
                  slots={pages[anim.dir === 'next' ? anim.from : anim.to] ?? []}
                  perPage={perPage}
                  accent={settings.accent}
                  onOpen={() => {}}
                />
              </div>
              <div className="binder-leaf__face binder-leaf__back" aria-hidden />
            </div>
          )}
        </div>
      </main>

      {/* Pager */}
      <div className="flex items-center justify-between gap-3 border-t border-surface-2 px-3 py-2">
        <button
          onClick={() => turn('prev')}
          disabled={page === 0 || !!anim}
          className="tap-target flex items-center justify-center rounded-lg px-3 disabled:opacity-30 active:bg-surface-2"
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
        <span className="text-sm text-neutral-300">
          Page {page + 1} / {pages.length}
        </span>
        <button
          onClick={() => turn('next')}
          disabled={page >= pages.length - 1 || !!anim}
          className="tap-target flex items-center justify-center rounded-lg px-3 disabled:opacity-30 active:bg-surface-2"
          aria-label="Next page"
        >
          <ChevronRightIcon className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
