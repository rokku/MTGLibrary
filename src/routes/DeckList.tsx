import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dialog } from '@headlessui/react';
import {
  ClipboardDocumentIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckIcon,
  Squares2X2Icon,
  ListBulletIcon,
} from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { ManaPips } from '../components/ManaPips';
import { CatalogueThumb } from '../components/CatalogueThumb';
import { CardHoverCard } from '../components/CardHoverCard';
import { useSettings } from '../hooks/useSettings';
import { db, type CatalogueCard, type RoleId } from '../lib/db';
import {
  ROLES,
  type DeckRow,
  deckRowsByRole,
  deckSize,
  getDeck,
  manaCurve,
  moxfieldExport,
} from '../lib/deck';

const CURVE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

// Remember the grid/list choice across navigation (opening a card unmounts this
// route), resetting on a full reload — mirrors the library's view state.
type DeckView = 'grid' | 'list';
let savedDeckView: DeckView = 'grid';

/** Single-series magnitude chart: nonland card counts by mana value. */
function ManaCurve({ buckets, accent }: { buckets: number[]; accent: string }) {
  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((n, b) => n + b, 0);

  return (
    <figure className="rounded-xl bg-surface-1 p-3">
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium">Mana curve</span>
        <span className="text-xs text-neutral-500">{total} nonland cards</span>
      </figcaption>
      <div className="flex items-end gap-1.5" style={{ height: 118 }}>
        {buckets.map((count, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`Mana value ${CURVE_LABELS[i]}: ${count} card${count === 1 ? '' : 's'}`}>
            <span className="text-[10px] tabular-nums text-neutral-400">{count || ''}</span>
            <div
              className="w-full rounded-t"
              style={{
                height: count > 0 ? Math.max(4, (count / max) * 96) : 0,
                backgroundColor: count > 0 ? accent : 'transparent',
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 border-t border-surface-3 pt-1">
        {CURVE_LABELS.map((l) => (
          <span key={l} className="flex-1 text-center text-[10px] tabular-nums text-neutral-500">
            {l}
          </span>
        ))}
      </div>
    </figure>
  );
}

function CardRow({ row, onOpen }: { row: DeckRow; onOpen: () => void }) {
  const { card, quantity } = row;
  return (
    <li className="flex items-center gap-2.5 rounded-lg bg-surface-1 p-1.5">
      <CardHoverCard catalogueId={card.id} className="w-8 shrink-0">
        <CatalogueThumb card={card} onClick={onOpen} />
      </CardHoverCard>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          {quantity > 1 && <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-300">{quantity}×</span>}
          <span className="truncate text-sm">{card.name}</span>
        </span>
        <span className="block truncate text-[11px] text-neutral-500">
          {card.cmc} MV · {card.typeLine}
        </span>
      </button>
    </li>
  );
}

function CardCell({ row, accent, onOpen }: { row: DeckRow; accent: string; onOpen: () => void }) {
  const { card, quantity } = row;
  return (
    <CardHoverCard catalogueId={card.id} className="block">
      <CatalogueThumb
        card={card}
        onClick={onOpen}
        badge={
          quantity > 1 ? (
            <span
              className="absolute right-1 top-1 min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-xs font-bold text-black shadow"
              style={{ backgroundColor: accent }}
            >
              {quantity}
            </span>
          ) : undefined
        }
      />
    </CardHoverCard>
  );
}

function ExportModal({
  open,
  text,
  onClose,
  deckName,
  accent,
}: {
  open: boolean;
  text: string;
  onClose: () => void;
  deckName: string;
  accent: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the textarea is selectable as a fallback */
    }
  }

  function download() {
    const safe = deckName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'deck';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/70" aria-hidden />
      <div className="fixed inset-0 flex items-end justify-center p-3 sm:items-center">
        <Dialog.Panel className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-surface-1 p-4">
          <Dialog.Title className="text-base font-semibold">Export decklist</Dialog.Title>
          <p className="mt-1 text-xs text-neutral-400">
            Moxfield format. Copy, then paste into Moxfield’s <span className="text-neutral-200">Import</span> box (or
            download the .txt).
          </p>
          <textarea
            readOnly
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-3 min-h-0 flex-1 resize-none rounded-lg bg-surface-0 p-3 font-mono text-xs text-neutral-200 outline-none"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={copy}
              className="tap-target flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-black"
              style={{ backgroundColor: accent }}
            >
              {copied ? <CheckIcon className="h-5 w-5" /> : <ClipboardDocumentIcon className="h-5 w-5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={download}
              className="tap-target flex items-center justify-center gap-2 rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-medium active:bg-surface-3"
            >
              <ArrowDownTrayIcon className="h-5 w-5" />
              .txt
            </button>
            <button onClick={onClose} className="tap-target rounded-lg bg-surface-2 px-4 py-2.5 text-sm active:bg-surface-3">
              Close
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

/** The finished decklist: commander first, then role sections, curve + export. */
export function DeckList() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const settings = useSettings();
  const [exportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<DeckView>(savedDeckView);
  function changeView(v: DeckView) {
    savedDeckView = v;
    setView(v);
  }

  const deck = useLiveQuery(async () => (await getDeck(deckId!)) ?? null, [deckId]);

  const byId = useLiveQuery(async () => {
    if (!deck) return new Map<string, CatalogueCard>();
    const ids = [...new Set([deck.commanderId, ...deck.entries.map((e) => e.catalogueId)])];
    const cats = await db.catalogue.bulkGet(ids);
    const m = new Map<string, CatalogueCard>();
    for (const c of cats) if (c) m.set(c.id, c);
    return m;
  }, [deck?.entries, deck?.commanderId]);

  const commander = deck && byId ? byId.get(deck.commanderId) : undefined;
  const rowsByRole = useMemo(() => (deck && byId ? deckRowsByRole(deck, byId) : null), [deck, byId]);
  const curve = useMemo(() => (deck && byId ? manaCurve(deck, commander, byId) : null), [deck, byId, commander]);
  const exportText = useMemo(() => (deck && byId ? moxfieldExport(deck, commander, byId) : ''), [deck, byId, commander]);

  if (deck === undefined || byId === undefined) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Decklist" back="/decks" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Loading…</div>
      </div>
    );
  }
  if (deck === null) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Decklist" back="/decks" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Deck not found.</div>
      </div>
    );
  }

  const total = deckSize(deck.entries) + 1;

  const exportButton = (
    <button
      onClick={() => setExportOpen(true)}
      className="tap-target flex items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-black"
      style={{ backgroundColor: settings.accent }}
    >
      <ArrowUpTrayIcon className="h-5 w-5" />
      Export
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <Header title={deck.name} back={`/decks/${deck.id}`} accent={settings.accent} right={exportButton} />

      <main className="flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-neutral-400">
            <span className="font-semibold tabular-nums text-neutral-200">{total}</span> / 100 cards
          </span>
          <div className="flex items-center gap-2">
            <ManaPips identity={deck.colorIdentity} size={14} />
            <div className="flex overflow-hidden rounded-lg bg-surface-1">
              <button
                onClick={() => changeView('grid')}
                className={`tap-target grid place-items-center px-2.5 ${view === 'grid' ? 'text-black' : 'text-neutral-400'}`}
                style={view === 'grid' ? { backgroundColor: settings.accent } : undefined}
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
              >
                <Squares2X2Icon className="h-5 w-5" />
              </button>
              <button
                onClick={() => changeView('list')}
                className={`tap-target grid place-items-center px-2.5 ${view === 'list' ? 'text-black' : 'text-neutral-400'}`}
                style={view === 'list' ? { backgroundColor: settings.accent } : undefined}
                aria-label="List view"
                aria-pressed={view === 'list'}
              >
                <ListBulletIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Commander */}
        {commander && (
          <section className="mb-4">
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Commander</h2>
            <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-2">
              <CardHoverCard catalogueId={commander.id} className="w-14 shrink-0">
                <CatalogueThumb card={commander} size="normal" onClick={() => navigate(`/card/${commander.id}`)} />
              </CardHoverCard>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{commander.name}</p>
                <p className="truncate text-xs text-neutral-400">{commander.typeLine}</p>
              </div>
            </div>
          </section>
        )}

        {curve && (
          <div className="mb-4">
            <ManaCurve buckets={curve} accent={settings.accent} />
          </div>
        )}

        {/* Role sections */}
        {rowsByRole &&
          ROLES.map((role) => {
            const rows = rowsByRole[role.id];
            const count = rows.reduce((n, r) => n + r.quantity, 0);
            if (count === 0) return null;
            return (
              <section key={role.id} className="mb-4">
                <h2 className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{role.label}</span>
                  <span className="text-xs tabular-nums text-neutral-500">{count}</span>
                </h2>
                {view === 'grid' ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {rows.map((r) => (
                      <CardCell
                        key={`${r.card.id}-${r.role as RoleId}`}
                        row={r}
                        accent={settings.accent}
                        onOpen={() => navigate(`/card/${r.card.id}`)}
                      />
                    ))}
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {rows.map((r) => (
                      <CardRow key={`${r.card.id}-${r.role as RoleId}`} row={r} onOpen={() => navigate(`/card/${r.card.id}`)} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

        <div className="h-8" />
      </main>

      <ExportModal
        open={exportOpen}
        text={exportText}
        onClose={() => setExportOpen(false)}
        deckName={deck.name}
        accent={settings.accent}
      />
    </div>
  );
}
