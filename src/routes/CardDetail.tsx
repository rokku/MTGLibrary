import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dialog } from '@headlessui/react';
import { MapPinIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { ManaPips } from '../components/ManaPips';
import { useSettings } from '../hooks/useSettings';
import { db, type CatalogueCard, type Condition, type Finish, type OwnedCard } from '../lib/db';
import { getImageBlob, ensureImage } from '../lib/image-cache';
import { addCopy, deleteCard, removeCopy, updateCopy } from '../lib/collection';
import { CONDITIONS, FINISHES, RARITY_LABEL, formatEur } from '../lib/constants';

function useNormalImage(card: CatalogueCard | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (!card) return;
    (async () => {
      let blob = await getImageBlob(card.id, 'normal');
      if (!blob) blob = await getImageBlob(card.id, 'small'); // offline fallback
      if (!blob) blob = await ensureImage(card, 'normal'); // online fetch
      if (blob && !cancelled) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [card]);
  return url;
}

interface CopyDraft {
  id?: string;
  quantity: number;
  finish: Finish;
  condition: Condition;
  tags: string;
  notes: string;
  location: string;
}

function EditCopyModal({
  open,
  draft,
  onClose,
  onSave,
  onDelete,
  accent,
}: {
  open: boolean;
  draft: CopyDraft | null;
  onClose: () => void;
  onSave: (d: CopyDraft) => void;
  onDelete?: () => void;
  accent: string;
}) {
  const [local, setLocal] = useState<CopyDraft | null>(draft);
  useEffect(() => setLocal(draft), [draft]);
  if (!local) return null;

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/60" aria-hidden />
      <div className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4">
        <Dialog.Panel className="w-full max-w-md rounded-t-2xl bg-surface-1 p-4 sm:rounded-2xl">
          <Dialog.Title className="mb-4 text-lg font-semibold">
            {local.id ? 'Edit copy' : 'Add copy'}
          </Dialog.Title>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-neutral-400">Quantity</label>
              <input
                type="number"
                min={1}
                value={local.quantity}
                onChange={(e) => setLocal({ ...local, quantity: Math.max(1, Number(e.target.value)) })}
                className="w-full rounded-lg bg-surface-2 px-3 py-2 outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-neutral-400">Finish</label>
              <div className="flex gap-2">
                {FINISHES.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setLocal({ ...local, finish: f.value })}
                    className={`flex-1 rounded-lg py-2 text-sm ${
                      local.finish === f.value ? 'bg-white text-black' : 'bg-surface-2'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-neutral-400">Condition</label>
              <div className="flex gap-2">
                {CONDITIONS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setLocal({ ...local, condition: c.value })}
                    className={`flex-1 rounded-lg py-2 text-sm ${
                      local.condition === c.value ? 'bg-white text-black' : 'bg-surface-2'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-neutral-400">Location</label>
              <input
                value={local.location}
                onChange={(e) => setLocal({ ...local, location: e.target.value })}
                placeholder="Binder 2 · page 4"
                className="w-full rounded-lg bg-surface-2 px-3 py-2 outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-neutral-400">Tags (comma separated)</label>
              <input
                value={local.tags}
                onChange={(e) => setLocal({ ...local, tags: e.target.value })}
                placeholder="binder-1, trade"
                className="w-full rounded-lg bg-surface-2 px-3 py-2 outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-neutral-400">Notes</label>
              <textarea
                value={local.notes}
                onChange={(e) => setLocal({ ...local, notes: e.target.value })}
                rows={2}
                className="w-full resize-none rounded-lg bg-surface-2 px-3 py-2 outline-none"
              />
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            {onDelete && (
              <button onClick={onDelete} className="rounded-lg border border-red-800 px-4 py-3 text-sm text-red-300">
                Remove
              </button>
            )}
            <button onClick={onClose} className="flex-1 rounded-lg bg-surface-2 py-3 text-sm">
              Cancel
            </button>
            <button
              onClick={() => onSave(local)}
              className="flex-1 rounded-lg py-3 text-sm font-semibold text-black"
              style={{ backgroundColor: accent }}
            >
              Save
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

export function CardDetail() {
  const { catalogueId } = useParams<{ catalogueId: string }>();
  const navigate = useNavigate();
  const settings = useSettings();

  const card = useLiveQuery(() => (catalogueId ? db.catalogue.get(catalogueId) : undefined), [catalogueId]);
  const copies = useLiveQuery(
    () => (catalogueId ? db.owned.where('catalogueId').equals(catalogueId).toArray() : []),
    [catalogueId],
    [] as OwnedCard[],
  );
  const imageUrl = useNormalImage(card);

  const [editing, setEditing] = useState<CopyDraft | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  if (card === undefined) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Card" back="/" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Loading…</div>
      </div>
    );
  }
  if (card === null) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Card" back="/" accent={settings.accent} />
        <div className="flex flex-1 items-center justify-center text-neutral-500">Card not found.</div>
      </div>
    );
  }

  const totalQty = (copies ?? []).reduce((s, c) => s + c.quantity, 0);

  function openEdit(copy: OwnedCard) {
    setEditing({
      id: copy.id,
      quantity: copy.quantity,
      finish: copy.finish,
      condition: copy.condition,
      tags: copy.tags.join(', '),
      notes: copy.notes ?? '',
      location: copy.location ?? '',
    });
    setModalOpen(true);
  }

  function openAdd() {
    setEditing({ quantity: 1, finish: 'nonfoil', condition: 'NM', tags: '', notes: '', location: '' });
    setModalOpen(true);
  }

  async function saveDraft(d: CopyDraft) {
    const tags = d.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const notes = d.notes.trim() || null;
    const location = d.location.trim() || null;
    if (d.id) {
      const existing = (copies ?? []).find((c) => c.id === d.id);
      if (existing) {
        await updateCopy({ ...existing, quantity: d.quantity, finish: d.finish, condition: d.condition, tags, notes, location });
      }
    } else {
      await addCopy(card!, { quantity: d.quantity, finish: d.finish, condition: d.condition, tags, notes, location });
    }
    setModalOpen(false);
    setEditing(null);
  }

  async function deleteDraft() {
    if (editing?.id) await removeCopy(editing.id);
    setModalOpen(false);
    setEditing(null);
  }

  async function handleDeleteCard() {
    if (confirm(`Remove all copies of ${card!.name}?`)) {
      await deleteCard(card!.id);
      navigate('/');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        title={card.name}
        back="/"
        accent={settings.accent}
        right={
          totalQty > 0 ? (
            <button onClick={handleDeleteCard} className="tap-target flex items-center justify-center rounded-lg text-red-400 active:bg-surface-2" aria-label="Delete card">
              <TrashIcon className="h-5 w-5" />
            </button>
          ) : undefined
        }
      />

      <main className="flex-1 overflow-y-auto">
        <div className="flex justify-center bg-surface-0 p-4">
          {imageUrl ? (
            <img src={imageUrl} alt={card.name} className="w-full max-w-xs rounded-xl" draggable={false} />
          ) : (
            <div className="flex aspect-[5/7] w-full max-w-xs items-center justify-center rounded-xl bg-surface-2 text-neutral-500">
              No image
            </div>
          )}
        </div>

        <div className="space-y-4 px-4 pb-8">
          <div>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-bold">{card.name}</h2>
              <ManaPips identity={card.colorIdentity} size={22} />
            </div>
            <p className="text-sm text-neutral-400">
              {card.setName} · #{card.collectorNumber} · {RARITY_LABEL[card.rarity] ?? card.rarity}
            </p>
            <p className="text-sm text-neutral-400">{card.typeLine}</p>
            <p className="text-sm text-neutral-400">
              {card.manaCost ? `${card.manaCost} · ` : ''}Mana value {card.cmc}
            </p>
          </div>

          {/* Owned copies */}
          <section className="rounded-xl bg-surface-1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">Owned ({totalQty})</h3>
              <button onClick={openAdd} className="flex items-center gap-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm active:bg-surface-3">
                <PlusIcon className="h-4 w-4" /> Add copy
              </button>
            </div>
            {(copies ?? []).length === 0 ? (
              <p className="text-sm text-neutral-500">You don't own this card.</p>
            ) : (
              <ul className="space-y-2">
                {(copies ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => openEdit(c)}
                      className="flex w-full items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-left text-sm active:bg-surface-3"
                    >
                      <span>
                        {c.quantity}× {c.finish}, {c.condition}
                        {c.tags.length > 0 && (
                          <span className="ml-2 text-xs text-neutral-400">{c.tags.join(', ')}</span>
                        )}
                        {c.location && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-neutral-400">
                            <MapPinIcon className="h-3.5 w-3.5" /> {c.location}
                          </span>
                        )}
                        {c.notes && <span className="block text-xs text-neutral-500">{c.notes}</span>}
                      </span>
                      <PencilSquareIcon className="h-4 w-4 text-neutral-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Reference */}
          <section className="space-y-2 text-sm text-neutral-400">
            {card.priceEur != null && <p>{formatEur(card.priceEur)} (import reference price)</p>}
            {card.artist && <p>Artist: {card.artist}</p>}
            {card.keywords.length > 0 && <p>Keywords: {card.keywords.join(', ')}</p>}
            {card.oracleText && (
              <div className="whitespace-pre-wrap rounded-lg bg-surface-1 p-3 text-neutral-300">{card.oracleText}</div>
            )}
          </section>
        </div>
      </main>

      <EditCopyModal
        open={modalOpen}
        draft={editing}
        accent={settings.accent}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={saveDraft}
        onDelete={editing?.id ? deleteDraft : undefined}
      />
    </div>
  );
}
