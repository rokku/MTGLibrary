import {
  db,
  type CatalogueCard,
  type Condition,
  type Finish,
  type ImportRecord,
  type OwnedCard,
} from './db';
import type { MatchResult } from './csv';

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

export function ownedFromCatalogue(
  cat: CatalogueCard,
  fields: {
    quantity: number;
    finish: Finish;
    condition: Condition;
    tags?: string[];
    notes?: string | null;
    importId: string;
    importedAt: number;
  },
): OwnedCard {
  return {
    id: uuid(),
    catalogueId: cat.id,
    quantity: fields.quantity,
    finish: fields.finish,
    condition: fields.condition,
    tags: fields.tags ?? [],
    notes: fields.notes ?? null,
    // Denormalised facets
    name: cat.name,
    typeLine: cat.typeLine,
    colorIdentity: cat.colorIdentity,
    colors: cat.colors,
    rarity: cat.rarity,
    cmc: cat.cmc,
    setCode: cat.setCode,
    setName: cat.setName,
    releasedAt: cat.releasedAt,
    priceEur: cat.priceEur,
    importedAt: fields.importedAt,
    importId: fields.importId,
  };
}

export interface CommitResult {
  record: ImportRecord;
}

/**
 * Write matched cards into the collection. `imagesFetched/Failed` come from the
 * image-download step run beforehand in the wizard.
 */
export async function commitImport(
  matched: MatchResult[],
  filename: string,
  mode: 'merge' | 'replace',
  imageStats: { fetched: number; failed: number },
): Promise<CommitResult> {
  const importId = uuid();
  const importedAt = Date.now();

  const catalogueIds = matched.map((m) => m.catalogueId!).filter(Boolean);
  const cats = await db.catalogue.bulkGet(catalogueIds);
  const catById = new Map<string, CatalogueCard>();
  cats.forEach((c) => {
    if (c) catById.set(c.id, c);
  });

  const owned: OwnedCard[] = [];
  for (const m of matched) {
    if (m.status !== 'matched' || !m.catalogueId) continue;
    const cat = catById.get(m.catalogueId);
    if (!cat) continue;
    owned.push(
      ownedFromCatalogue(cat, {
        quantity: m.quantity,
        finish: m.finish,
        condition: m.condition,
        importId,
        importedAt,
      }),
    );
  }

  const record: ImportRecord = {
    id: importId,
    filename,
    importedAt,
    cardCount: owned.length,
    imagesFetched: imageStats.fetched,
    imagesFailed: imageStats.failed,
  };

  await db.transaction('rw', db.owned, db.imports, async () => {
    if (mode === 'replace') {
      await db.owned.clear();
      await db.imports.clear();
    }
    await db.owned.bulkAdd(owned);
    await db.imports.add(record);
  });

  return { record };
}

// ── Sync (diff a re-exported CSV against the collection) ─────────────

export interface SyncSummary {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/** Identity of a physical stack: a specific printing in a specific finish + condition. */
const stackKey = (catalogueId: string, finish: Finish, condition: Condition): string =>
  `${catalogueId}|${finish}|${condition}`;

/**
 * Reconcile the collection to match a freshly-exported CSV, treating the CSV as
 * the source of truth for the CSV-managed portion:
 *  - stacks new in the CSV are added,
 *  - quantity changes are applied in place (tags/notes preserved),
 *  - stacks that came from a prior import but are gone from the CSV are removed,
 *  - copies added manually in-app (importId 'manual') are never touched.
 * Duplicate CSV rows for the same stack are summed. Images are fetched by the
 * wizard beforehand and are already skipped when cached, so only genuinely new
 * cards cost a download.
 */
export async function syncImport(
  matched: MatchResult[],
  filename: string,
  imageStats: { fetched: number; failed: number },
): Promise<{ record: ImportRecord; summary: SyncSummary }> {
  const importId = uuid();
  const importedAt = Date.now();

  // 1. Desired state from the CSV: one entry per stack, quantities summed.
  interface Desired {
    catalogueId: string;
    finish: Finish;
    condition: Condition;
    quantity: number;
  }
  const desired = new Map<string, Desired>();
  for (const m of matched) {
    if (m.status !== 'matched' || !m.catalogueId) continue;
    const key = stackKey(m.catalogueId, m.finish, m.condition);
    const cur = desired.get(key);
    if (cur) cur.quantity += m.quantity;
    else
      desired.set(key, {
        catalogueId: m.catalogueId,
        finish: m.finish,
        condition: m.condition,
        quantity: m.quantity,
      });
  }

  // Catalogue rows for any brand-new stacks we may need to create.
  const catIds = [...new Set([...desired.values()].map((d) => d.catalogueId))];
  const cats = await db.catalogue.bulkGet(catIds);
  const catById = new Map<string, CatalogueCard>();
  cats.forEach((c) => {
    if (c) catById.set(c.id, c);
  });

  // 2. Current owned rows, grouped by the same key.
  const owned = await db.owned.toArray();
  const ownedByKey = new Map<string, OwnedCard[]>();
  for (const o of owned) {
    const key = stackKey(o.catalogueId, o.finish, o.condition);
    const list = ownedByKey.get(key);
    if (list) list.push(o);
    else ownedByKey.set(key, [o]);
  }

  const toAdd: OwnedCard[] = [];
  const toPut: OwnedCard[] = [];
  const toDelete: string[] = [];
  const summary: SyncSummary = { added: 0, updated: 0, removed: 0, unchanged: 0 };

  // 3. Reconcile each desired stack.
  for (const [key, d] of desired) {
    const rows = ownedByKey.get(key);
    if (rows && rows.length > 0) {
      // Carry the CSV quantity on an existing row (prefer a CSV-managed one so
      // manual copies are left alone), preserving its id/tags/notes.
      const primary = rows.find((r) => r.importId !== 'manual') ?? rows[0]!;
      if (primary.quantity !== d.quantity) {
        toPut.push({ ...primary, quantity: d.quantity });
        summary.updated++;
      } else {
        summary.unchanged++;
      }
      // Fold any duplicate CSV-managed rows for this stack into the primary.
      for (const r of rows) {
        if (r !== primary && r.importId !== 'manual') toDelete.push(r.id);
      }
      ownedByKey.delete(key);
    } else {
      const cat = catById.get(d.catalogueId);
      if (!cat) continue; // can't materialise without a catalogue entry
      toAdd.push(
        ownedFromCatalogue(cat, {
          quantity: d.quantity,
          finish: d.finish,
          condition: d.condition,
          importId,
          importedAt,
        }),
      );
      summary.added++;
    }
  }

  // 4. Whatever CSV-managed rows remain are no longer in the CSV → remove.
  //    Manually-added copies are deliberately kept.
  for (const [, rows] of ownedByKey) {
    for (const r of rows) {
      if (r.importId !== 'manual') {
        toDelete.push(r.id);
        summary.removed++;
      }
    }
  }

  const record: ImportRecord = {
    id: importId,
    filename,
    importedAt,
    cardCount: summary.added,
    imagesFetched: imageStats.fetched,
    imagesFailed: imageStats.failed,
  };

  await db.transaction('rw', db.owned, db.imports, async () => {
    if (toDelete.length) await db.owned.bulkDelete(toDelete);
    if (toPut.length) await db.owned.bulkPut(toPut);
    if (toAdd.length) await db.owned.bulkAdd(toAdd);
    await db.imports.add(record);
  });

  return { record, summary };
}

/** Remove every owned copy that came from a given import, plus its record. */
export async function deleteImport(importId: string): Promise<void> {
  await db.transaction('rw', db.owned, db.imports, async () => {
    await db.owned.where('importId').equals(importId).delete();
    await db.imports.delete(importId);
  });
}

/** Remove all owned copies of a catalogue card. */
export async function deleteCard(catalogueId: string): Promise<void> {
  await db.owned.where('catalogueId').equals(catalogueId).delete();
}

export async function updateCopy(copy: OwnedCard): Promise<void> {
  await db.owned.put(copy);
}

export async function addCopy(cat: CatalogueCard, fields: {
  quantity: number;
  finish: Finish;
  condition: Condition;
  tags?: string[];
  notes?: string | null;
}): Promise<void> {
  const copy = ownedFromCatalogue(cat, {
    ...fields,
    importId: 'manual',
    importedAt: Date.now(),
  });
  await db.owned.add(copy);
}

export async function removeCopy(id: string): Promise<void> {
  await db.owned.delete(id);
}

// ── Backup / restore ────────────────────────────────────────────────

export interface BackupFile {
  app: 'mtg-collection';
  version: 1;
  exportedAt: number;
  owned: OwnedCard[];
  imports: ImportRecord[];
}

export async function exportBackup(): Promise<BackupFile> {
  const [owned, imports] = await Promise.all([db.owned.toArray(), db.imports.toArray()]);
  return { app: 'mtg-collection', version: 1, exportedAt: Date.now(), owned, imports };
}

export async function importBackup(
  backup: BackupFile,
  mode: 'merge' | 'replace',
): Promise<{ owned: number }> {
  if (backup.app !== 'mtg-collection') throw new Error('Not an MTG Collection backup file');
  await db.transaction('rw', db.owned, db.imports, async () => {
    if (mode === 'replace') {
      await db.owned.clear();
      await db.imports.clear();
    }
    await db.owned.bulkPut(backup.owned);
    await db.imports.bulkPut(backup.imports ?? []);
  });
  return { owned: backup.owned.length };
}

// ── Stats ───────────────────────────────────────────────────────────

export async function collectionStats(): Promise<{
  distinctCards: number;
  totalCopies: number;
  valueEur: number;
}> {
  let distinctCards = 0;
  let totalCopies = 0;
  let valueEur = 0;
  await db.owned.each((o) => {
    distinctCards++;
    totalCopies += o.quantity;
    if (o.priceEur) valueEur += o.priceEur * o.quantity;
  });
  return { distinctCards, totalCopies, valueEur };
}
