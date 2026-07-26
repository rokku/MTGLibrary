import { useState } from 'react';
import { Dialog } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ManaPip } from './ManaPips';
import {
  CARD_TYPES,
  CMC_MAX,
  COLORS,
  CONDITIONS,
  FINISHES,
  RARITIES,
} from '../lib/constants';
import { EMPTY_FILTERS, type ActiveFilters, type FacetOptions } from '../lib/query';

interface FilterMenuProps {
  open: boolean;
  onClose: () => void;
  filters: ActiveFilters;
  onChange: (f: ActiveFilters) => void;
  facets: FacetOptions;
}

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-surface-2 py-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
      {children}
    </div>
  );
}

function CheckChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tap-target rounded-lg px-3 py-1.5 text-sm ${
        active ? 'bg-white text-black' : 'bg-surface-2 text-neutral-200'
      }`}
    >
      {label}
    </button>
  );
}

export function FilterMenu({ open, onClose, filters, onChange, facets }: FilterMenuProps) {
  const [setSearch, setSetSearch] = useState('');
  const set = (patch: Partial<ActiveFilters>) => onChange({ ...filters, ...patch });

  const visibleSets = facets.sets.filter(
    (s) =>
      !setSearch ||
      s.name.toLowerCase().includes(setSearch.toLowerCase()) ||
      s.code.toLowerCase().includes(setSearch.toLowerCase()),
  );

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/60" aria-hidden />
      <div className="fixed inset-y-0 right-0 flex w-full max-w-md">
        <Dialog.Panel className="flex w-full flex-col bg-surface-1">
          <div className="flex items-center justify-between border-b border-surface-2 px-4 py-3">
            <Dialog.Title className="text-lg font-semibold">Filters</Dialog.Title>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onChange({ ...EMPTY_FILTERS, search: filters.search })}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 active:bg-surface-2"
              >
                Clear
              </button>
              <button onClick={onClose} className="tap-target rounded-lg p-2 active:bg-surface-2" aria-label="Close">
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4">
            <Section title="Colour identity (matches all selected)">
              <div className="flex gap-2">
                {COLORS.map((c) => {
                  const active = filters.colors.includes(c);
                  return (
                    <button
                      key={c}
                      onClick={() => set({ colors: toggle(filters.colors, c) })}
                      className={`tap-target rounded-full p-0.5 ${active ? 'ring-2 ring-white' : 'opacity-50'}`}
                      aria-pressed={active}
                    >
                      <ManaPip color={c} size={32} />
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section title="Rarity">
              <div className="flex flex-wrap gap-2">
                {RARITIES.map((r) => (
                  <CheckChip
                    key={r.value}
                    label={r.label}
                    active={filters.rarities.includes(r.value)}
                    onClick={() => set({ rarities: toggle(filters.rarities, r.value) })}
                  />
                ))}
              </div>
            </Section>

            <Section title="Type">
              <div className="flex flex-wrap gap-2">
                {CARD_TYPES.map((t) => (
                  <CheckChip
                    key={t}
                    label={t}
                    active={filters.types.includes(t)}
                    onClick={() => set({ types: toggle(filters.types, t) })}
                  />
                ))}
              </div>
            </Section>

            <Section title={`Mana value: ${filters.cmcMin ?? 0}–${filters.cmcMax ?? CMC_MAX}`}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={CMC_MAX}
                  step={1}
                  value={filters.cmcMin ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    set({ cmcMin: v === 0 ? null : v, cmcMax: Math.max(v, filters.cmcMax ?? CMC_MAX) });
                  }}
                  className="w-full"
                />
                <input
                  type="range"
                  min={0}
                  max={CMC_MAX}
                  step={1}
                  value={filters.cmcMax ?? CMC_MAX}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    set({ cmcMax: v === CMC_MAX ? null : v, cmcMin: Math.min(v, filters.cmcMin ?? 0) });
                  }}
                  className="w-full"
                />
              </div>
            </Section>

            <Section title="Finish">
              <div className="flex flex-wrap gap-2">
                {FINISHES.map((f) => (
                  <CheckChip
                    key={f.value}
                    label={f.label}
                    active={filters.finishes.includes(f.value)}
                    onClick={() => set({ finishes: toggle(filters.finishes, f.value) })}
                  />
                ))}
              </div>
            </Section>

            <Section title="Condition">
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map((c) => (
                  <CheckChip
                    key={c.value}
                    label={c.label}
                    active={filters.conditions.includes(c.value)}
                    onClick={() => set({ conditions: toggle(filters.conditions, c.value) })}
                  />
                ))}
              </div>
            </Section>

            {facets.tags.length > 0 && (
              <Section title="Tags">
                <div className="flex flex-wrap gap-2">
                  {facets.tags.map((t) => (
                    <CheckChip
                      key={t.tag}
                      label={`${t.tag} (${t.count})`}
                      active={filters.tags.includes(t.tag)}
                      onClick={() => set({ tags: toggle(filters.tags, t.tag) })}
                    />
                  ))}
                </div>
              </Section>
            )}

            <Section title="Set">
              <input
                value={setSearch}
                onChange={(e) => setSetSearch(e.target.value)}
                placeholder="Search sets…"
                className="mb-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
              />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {visibleSets.map((s) => {
                  const active = filters.sets.includes(s.code);
                  return (
                    <button
                      key={s.code}
                      onClick={() => set({ sets: toggle(filters.sets, s.code) })}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm active:bg-surface-2"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded border ${
                            active ? 'border-white bg-white text-black' : 'border-neutral-600'
                          }`}
                        >
                          {active ? '✓' : ''}
                        </span>
                        <span className="truncate">{s.name}</span>
                      </span>
                      <span className="ml-2 text-xs uppercase text-neutral-500">
                        {s.code} · {s.count}
                      </span>
                    </button>
                  );
                })}
                {visibleSets.length === 0 && <p className="px-2 py-2 text-sm text-neutral-500">No sets</p>}
              </div>
            </Section>
          </div>

          <div className="border-t border-surface-2 p-4">
            <button
              onClick={onClose}
              className="tap-target w-full rounded-lg bg-white py-3 font-semibold text-black active:bg-neutral-200"
            >
              Show results
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
