/**
 * build-catalogue.ts
 *
 * Runs once on the developer machine (`npm run build:catalogue`).
 *
 * Live Scryfall bulk-data check (verified 2026-07-25):
 *   GET https://api.scryfall.com/bulk-data → data[].type === 'default_cards'
 *   The entry exposes BOTH `download_uri` (a gzip-encoded JSON array) and
 *   `jsonl_download_uri` (a .jsonl.gz — one card object per line). Per the spec
 *   we use `jsonl_download_uri` because it streams line-by-line without holding
 *   the whole ~620 MB array in memory.
 *
 * Output:
 *   public/data/catalogue-YYYYMMDD/{a..z,0}.jsonl.gz   (gzipped JSONL chunks)
 *   public/data/manifest.json                          (version + chunk list)
 */
import https from 'node:https';
import zlib from 'node:zlib';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../public/data');
const USER_AGENT = 'MTGCollectionPWA/1.0 (personal tool)';
const BULK_URL = 'https://api.scryfall.com/bulk-data';

// Chunk buckets: a–z plus '0' for names starting with a non-letter.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const CHUNK_KEYS = [...LETTERS, '0'];

interface ScryfallImageUris {
  small?: string;
  normal?: string;
}
interface ScryfallFace {
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ScryfallImageUris;
  colors?: string[];
  artist?: string;
}
interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  set: string;
  set_name: string;
  collector_number: string;
  color_identity: string[];
  colors?: string[];
  rarity: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallFace[];
  prices?: { eur?: string | null };
  artist?: string;
  released_at: string;
  keywords?: string[];
  oracle_text?: string;
  games?: string[];
  digital?: boolean;
}

interface CatalogueCardOut {
  id: string;
  name: string;
  oracleId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  colorIdentity: string;
  colors: string[];
  rarity: string;
  manaCost: string | null;
  cmc: number;
  typeLine: string;
  imgSmall: string;
  imgNormal: string;
  priceEur: number | null;
  artist: string | null;
  releasedAt: string;
  keywords: string[];
  oracleText: string | null;
}

const WUBRG = ['W', 'U', 'B', 'R', 'G'];
function sortColorIdentity(ci: string[]): string {
  return WUBRG.filter((c) => ci.includes(c)).join('');
}

function normalizeRarity(r: string): string {
  // Scryfall uses common|uncommon|rare|mythic|special|bonus.
  return r === 'bonus' ? 'special' : r;
}

function pickImages(card: ScryfallCard): { small: string; normal: string } {
  const top = card.image_uris;
  if (top?.small || top?.normal) {
    return { small: top.small ?? '', normal: top.normal ?? top.small ?? '' };
  }
  // Double-faced cards carry images per face; use the front face.
  const face = card.card_faces?.[0]?.image_uris;
  if (face?.small || face?.normal) {
    return { small: face.small ?? '', normal: face.normal ?? face.small ?? '' };
  }
  return { small: '', normal: '' };
}

function project(card: ScryfallCard): CatalogueCardOut | null {
  // English, paper printings only. This keeps the catalogue near ~110k cards.
  if (card.lang !== 'en') return null;
  if (card.digital) return null;
  if (card.games && !card.games.includes('paper')) return null;

  const { small, normal } = pickImages(card);

  const manaCost =
    card.mana_cost && card.mana_cost.length > 0
      ? card.mana_cost
      : card.card_faces?.[0]?.mana_cost || null;

  const oracleText =
    card.oracle_text ??
    (card.card_faces
      ? card.card_faces
          .map((f) => f.oracle_text)
          .filter(Boolean)
          .join('\n//\n')
      : null) ??
    null;

  const eur = card.prices?.eur;
  const priceEur = eur != null && eur !== '' ? Number(eur) : null;

  return {
    id: card.id,
    name: card.name,
    oracleId: card.oracle_id ?? '',
    setCode: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    colorIdentity: sortColorIdentity(card.color_identity ?? []),
    colors: card.colors ?? card.card_faces?.[0]?.colors ?? [],
    rarity: normalizeRarity(card.rarity),
    manaCost,
    cmc: card.cmc ?? 0,
    typeLine: card.type_line ?? card.card_faces?.[0]?.type_line ?? '',
    imgSmall: small,
    imgNormal: normal || small,
    priceEur: priceEur != null && Number.isFinite(priceEur) ? priceEur : null,
    artist: card.artist ?? card.card_faces?.[0]?.artist ?? null,
    releasedAt: card.released_at,
    keywords: card.keywords ?? [],
    oracleText,
  };
}

function chunkKeyFor(name: string): string {
  const c = name.trim().charAt(0).toLowerCase();
  return c >= 'a' && c <= 'z' ? c : '0';
}

/** GET a URL following redirects, resolving with the response stream. */
function httpsGet(url: string): Promise<import('node:http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          httpsGet(next).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        resolve(res);
      },
    );
    req.on('error', reject);
  });
}

async function fetchBulkMeta(): Promise<{ url: string; updatedAt: string }> {
  const res = await httpsGet(BULK_URL);
  const chunks: Buffer[] = [];
  for await (const c of res) chunks.push(c as Buffer);
  const meta = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const entry = meta.data.find((d: { type: string }) => d.type === 'default_cards');
  if (!entry) throw new Error('No default_cards entry in bulk-data');
  if (!entry.jsonl_download_uri) {
    throw new Error('default_cards entry has no jsonl_download_uri');
  }
  console.log(`✔ default_cards updated_at=${entry.updated_at}`);
  console.log(`  jsonl_download_uri=${entry.jsonl_download_uri}`);
  return { url: entry.jsonl_download_uri, updatedAt: entry.updated_at };
}

async function main() {
  console.log('→ Fetching Scryfall bulk-data metadata…');
  const { url, updatedAt } = await fetchBulkMeta();

  const version = updatedAt.slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const chunkDir = path.join(DATA_DIR, `catalogue-${version}`);
  fs.mkdirSync(chunkDir, { recursive: true });

  // One gzip write stream per chunk bucket.
  const writers = new Map<
    string,
    { gzip: zlib.Gzip; file: fs.WriteStream; count: number }
  >();
  for (const key of CHUNK_KEYS) {
    const gzip = zlib.createGzip();
    const file = fs.createWriteStream(path.join(chunkDir, `${key}.jsonl.gz`));
    gzip.pipe(file);
    writers.set(key, { gzip, file, count: 0 });
  }

  console.log('→ Downloading + streaming catalogue (this takes a minute)…');
  const res = await httpsGet(url);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({
    input: res.pipe(gunzip),
    crlfDelay: Infinity,
  });

  let total = 0;
  let kept = 0;
  for await (const line of rl) {
    if (!line) continue;
    total++;
    let card: ScryfallCard;
    try {
      card = JSON.parse(line);
    } catch {
      continue;
    }
    const out = project(card);
    if (!out) continue;
    const w = writers.get(chunkKeyFor(out.name))!;
    const ok = w.gzip.write(JSON.stringify(out) + '\n');
    if (!ok) await new Promise((r) => w.gzip.once('drain', r));
    w.count++;
    kept++;
    if (kept % 20000 === 0) console.log(`  …${kept} cards projected`);
  }

  // Flush + close every gzip stream.
  const chunks: { key: string; file: string; count: number }[] = [];
  for (const [key, w] of writers) {
    await new Promise<void>((resolve, reject) => {
      w.file.on('finish', () => resolve());
      w.file.on('error', reject);
      w.gzip.end();
    });
    const stat = fs.statSync(path.join(chunkDir, `${key}.jsonl.gz`));
    chunks.push({ key, file: `catalogue-${version}/${key}.jsonl.gz`, count: w.count });
    console.log(`  ${key}.jsonl.gz — ${w.count} cards, ${(stat.size / 1024).toFixed(0)} KB`);
  }

  const manifest = {
    version,
    updatedAt,
    generatedFrom: url,
    cardCount: kept,
    chunks: chunks.sort((a, b) => a.key.localeCompare(b.key)),
  };
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `\n✔ Done. Scanned ${total} rows → kept ${kept} English paper cards.\n` +
      `  Manifest: public/data/manifest.json (version ${version})`,
  );
}

main().catch((err) => {
  console.error('✖ build:catalogue failed:', err);
  process.exit(1);
});
