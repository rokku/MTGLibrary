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
import { projectCard, type ScryfallCard } from '../src/lib/projection';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../public/data');
const USER_AGENT = 'MTGCollectionPWA/1.0 (personal tool)';
const BULK_URL = 'https://api.scryfall.com/bulk-data';

// Chunk buckets: a–z plus '0' for names starting with a non-letter.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const CHUNK_KEYS = [...LETTERS, '0'];

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
    const out = projectCard(card);
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
