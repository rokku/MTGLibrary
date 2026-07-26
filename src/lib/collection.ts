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
