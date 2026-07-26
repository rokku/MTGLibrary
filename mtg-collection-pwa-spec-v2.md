# MTG Collection PWA — Development Specification v2

**Target audience:** Claude Code  
**Deliverable:** A complete, offline-first PWA for managing your CardMarket inventory  
**Input:** TCGPowertools CSV export  
**Output:** Installable app that works in a cave

---

## 1. Purpose

This is a **single deliverable**, not phased. You install it to your home screen once, import your CardMarket collection as a CSV, and browse it offline. No scanning, no syncing, no complexity.

**Two jobs:**

1. **Import a TCGPowertools CSV**, match each card to Scryfall, download thumbnail images, and store everything locally
2. **Browse and filter your collection** with zero network, in an interface that feels natural

That's the product.

---

## 2. What it is not

- **Not a full ManaBox clone.** ManaBox does 47 things. This does two, and does them well.
- **Not a card scanner.** You already have CardMarket for that. This is the home-library browser.
- **Not a deck builder.** Moxfield exists. No synergy engine, no legality checker.
- **Not a price tracker.** Prices in the CSV are stale within a day. The app shows historical import prices, that's all.
- **Not multi-user.** Single device, single user. Backup is a manual JSON export.

---

## 3. Technical constraints

| Constraint | Why |
|---|---|
| Installable PWA to iOS home screen | Primary use case is standalone, not in a browser tab |
| Fully functional offline | Cave = no signal |
| Static deployment (no backend) | Simpler, cheaper, more private |
| CSV import, not API sync | CardMarket/TCGPowertools as the source of truth |
| All images cached on first import | No runtime downloads during browsing |
| Dark theme by default | Underground venue |
| Single-device data (no account) | Simpler auth story (none), faster onboarding |

---

## 4. Architecture at a glance

```
User's CardMarket instance
         ↓
  TCGPowertools CSV
         ↓
  App: Match to Scryfall ──→ Download images ──→ IndexedDB
         ↓
  Browse offline (grid, filters, search)
```

Build once, deploy once, update when needed.

---

## 5. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite + TypeScript (strict mode) | |
| Framework | React 18 | |
| UI library | Headless UI + Tailwind CSS | No pre-built components; control the design |
| Routing | React Router v6 | Minimal. Two main routes: import, browse |
| Local DB | Dexie.js (IndexedDB) | Compound indexes for fast filtering |
| CSV parsing | PapaParse | Handles quoted fields, multiline cells, edge cases |
| PWA / SW | `vite-plugin-pwa` (Workbox) | Precaches app shell only; data is user-managed via IndexedDB |
| Scryfall integration | Fetch API + streams | No third-party SDK |
| Hosting | Static HTTPS (Netlify, Vercel, Cloudflare Pages) | |

**No state library.** React Context + Dexie's `useLiveQuery` hook keeps the data flow honest and comprehensible.

---

## 6. Data model (Dexie)

```ts
// db.ts
export interface CatalogueCard {
  id: string;                   // Scryfall UUID, primary key
  name: string;
  oracleId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  
  // Faceting fields (denormalised for performance)
  colorIdentity: string;        // 'WUBRG' string, e.g. 'BG'
  colors: string[];
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic' | 'special';
  manaCost: string | null;
  cmc: number;
  typeLine: string;
  
  // Display + offline
  imgSmall: string;             // URL to cache key in Images table
  imgNormal: string;            // URL to cache key
  priceEur: number | null;      // From CSV at import time (reference only)
  
  // Metadata
  artist: string | null;
  releasedAt: string;           // ISO date for sorting
  keywords: string[];
}

export interface OwnedCard {
  id: string;                   // local UUID
  catalogueId: string;          // → CatalogueCard.id
  
  // User inputs
  quantity: number;
  finish: 'nonfoil' | 'foil' | 'etched';
  condition: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
  
  // Metadata
  tags: string[];               // 'binder-1', 'trade', etc.
  notes: string | null;
  
  // Denormalised for faceting (sync with Catalogue on import)
  colorIdentity: string;
  rarity: string;
  cmc: number;
  setCode: string;
  
  // Bookkeeping
  importedAt: number;           // epoch ms
  importId: string;             // which CSV import this came from
}

export interface CardImage {
  key: string;                  // `${catalogueId}:${size}`
  size: 'small' | 'normal';
  blob: Blob;
  fetchedAt: number;
}

export interface ImportRecord {
  id: string;
  filename: string;
  importedAt: number;
  cardCount: number;
  imagesFetched: number;
  imagesFailed: number;
}

export class CollectionDB extends Dexie {
  catalogue!: Table<CatalogueCard, string>;
  owned!: Table<OwnedCard, string>;
  images!: Table<CardImage, string>;
  imports!: Table<ImportRecord, string>;

  constructor() {
    super('mtg-collection');
    this.version(1).stores({
      catalogue: 'id, oracleId, [setCode+collectorNumber]',
      owned:     'id, catalogueId, colorIdentity, rarity, cmc, setCode, *tags, importId',
      images:    'key, catalogueId',
      imports:   'id, importedAt',
    });
  }
}
```

Key design: **denormalised facet fields on `OwnedCard`.** IndexedDB has no joins. Duplicating `colorIdentity`, `rarity`, `cmc`, `setCode` at import time means filtering is a single indexed lookup — no lag.

---

## 7. CSV import pipeline

### 7.1 TCGPowertools format (what you export)

TCGPowertools supports several column names. Detect and normalize:

| TCGPowertools field | Normalized | Required? | Notes |
|---|---|---|---|
| `Quantity` | `quantity` | **yes** | |
| `Cardmarket ID` or `Scryfall ID` | `scryfallId` | one of these | Scryfall ID is preferred (direct UUID match) |
| `Name` + `Expansion` | `name`, `setCode` | if no ID | Fallback match via name + set; set must resolve to Scryfall code |
| `Foil` / `Condition` | `finish`, `condition` | no | Defaults: `nonfoil`, `NM` |
| `Language` | `language` | no | Verify it's English; filter others |

**Example TCGPowertools export header:**
```
Quantity,Name,Expansion,Cardmarket ID,Foil,Condition
2,Sol Ring,Commander 2019,123456,No,NM
1,Sol Ring,Commander Masters,654321,Yes,LP
```

Your workflow: **Export from CardMarket/TCGPowertools → Save as CSV → Upload to the app.**

### 7.2 Import flow (UI)

1. **File picker** — user selects a `.csv` file from their device
2. **Parse** — PapaParse detects headers and rows; display a preview (first 5 cards, mapped columns)
3. **Confirm columns** — auto-detect and let the user override any column mapping if headers are non-standard
4. **Match to Scryfall** — for each row:
   - If Scryfall ID → direct lookup in the catalogue
   - Else if name + set → fuzzy match on `name` + exact match on `setCode`, or prompt user
   - Else → error row
5. **Image download** — for each successfully matched card not already in the collection, download `small` image from Scryfall (throttled to 6 concurrent)
6. **Commit** — write all `OwnedCard` rows and images to IndexedDB
7. **Summary** — display result: "Imported 347 cards, 8 errors, 347 images downloaded"

### 7.3 Scryfall catalogue (build time)

This runs once on the developer machine, not in the app.

```bash
npm run build:catalogue
```

Does:

1. `GET https://api.scryfall.com/bulk-data` → find `default_cards` entry
2. Download the JSONL.gz file (Scryfall migrated from JSON arrays on 20 July 2026; use `jsonl_download_uri`)
3. For each line, parse and project to `CatalogueCard` schema
4. Gzip and split into chunks by first letter of name (26 files, makes resume easier)
5. Emit `public/data/catalogue-YYYYMMDD.json.gz` + `public/data/manifest.json`

**Expected output:** ~40–60 MB catalogue, 10–15 MB gzipped.

**Scryfall compliance:**
- Set a real `User-Agent` header (e.g. `MTGCollectionPWA/1.0`); include it in all requests
- Keep API traffic under 10 req/s (in practice this is a handful of requests)
- Do not modify or crop copyright/artist text on card images

---

## 8. Storage and data

### Budget

| Asset | Estimate |
|---|---|
| Catalogue (110k cards, indexed) | ~50–60 MB |
| Owned card images (`small`, ~5000 @ 25 KB each) | ~125 MB |
| App shell + dependencies | ~10 MB |
| **Total** | ~185 MB |

**Quota:** WebKit allows installed PWAs a quota proportional to free disk space. On a modern phone with >1 GB free, 200 MB is comfortable. Verify in initial testing on real device.

### Offline persistence

- Call `navigator.storage.persist()` after first successful import
- If granted, data survives app force-quit and 7-day idle
- If not granted, data is evicted if the app isn't used for 7 days
- **Manual export is the backup strategy.** Settings → Export Collection → saves JSON file; user downloads it

---

## 9. Browse interface (the main thing)

The library view lives at `/library`. It is **the default route after import.**

### 9.1 Grid view (default)

- Cards as a 3-column grid (two on narrow phone, three on iPad)
- Each card shows: `small` image thumbnail + quantity badge in corner
- Tap to open card detail (see §9.3)
- Quantity badge only shows if > 1; single cards have no badge

### 9.2 Filter bar (sticky at top)

Modelled on ManaBox's filter UX, but simpler:

```
[Search box] [Filters▼]

─────────────────────

Filters applied: Colour: WU | Rarity: Rare

Results: 247 cards | € 1,243
```

**Search** — free-text across `name` + `typeLine`. Debounced at 200ms.

**Filter menu** (slide-out or modal):

- **Color Identity** — WUBRG pips, multi-select AND (no "OR all colours" complexity)
- **Rarity** — checkboxes: Common, Uncommon, Rare, Mythic
- **Set** — searchable dropdown of all sets in your collection (not all sets ever)
- **Type** — searchable checkboxes: Creature, Sorcery, Instant, Artifact, Enchantment, Land, Planeswalker
- **Mana Value** — slider range (0–16, step 1)
- **Finish** — checkboxes: Nonfoil, Foil, Etched
- **Condition** — checkboxes: NM, LP, MP, HP, DMG
- **Tags** — checkboxes of all tags in your collection

All filters default to **"show all"** when empty. Apply immediately (no "submit" button).

**Sort** (always visible):
- Name (A–Z)
- Mana Value (low–high)
- Rarity (common → mythic, or reverse)
- Set release date (newest–oldest, or reverse)
- Recently added
- Quantity (high–low)

### 9.3 Card detail

Tap a card to see:

```
┌─────────────────┐
│                 │
│  normal image   │ (full-height, scroll if needed)
│                 │
├─────────────────┤
│ Sol Ring        │  (name, set symbol + collector number)
│ Legendaries - U │  (type, rarity icon)
│ CMC 1           │  (mana cost and CMC)
│                 │
│ ════════════════│
│ Owned (3)       │  collapsible detail per copy
│  ▼ [2x nonfoil, │  (click to expand and edit)
│      NM, Trade] │
│    ▼ [1x foil,  │
│      LP, Binder]│
│ ════════════════│
│ [Edit] [Delete] │
│ ════════════════│
│ €3.50 (import)  │  price from CSV at import time, FYI only
│ Artist: etc.    │
```

**Edit card** — modal to adjust quantity, finish, condition, tags, notes for any copy. Add/remove copies.

**Delete** — removes all copies of this card from the collection.

**Notes:** Display full Oracle text and keywords at the bottom for reference.

### 9.4 List view (toggle from grid)

Same filter/sort as grid, but cards displayed as rows:

```
Name                  | Set  | Qty | Finish | Condition
Sol Ring              | CMM  | 3   | NF/F/E | NM/LP
```

Faster to scan if you want a dense summary; less visual.

---

## 10. Import interface

Reachable from **Settings → Import Collection**.

1. **Upload CSV**
   - File picker, or drag-drop
   - Parse immediately, show preview of first 5 rows
   - Display detected columns and let user confirm or remap

2. **Matching**
   - Show matched vs unmatched cards
   - For unmatched, show closest name matches (fuzzy, top 3)
   - User can pick the right one, or skip the row

3. **Images**
   - "Fetching images..." progress bar
   - Show which are cached, which are downloading, which failed
   - Can pause/resume

4. **Commit**
   - Summary: 347 imported, 8 skipped, 347 images done
   - "Add to collection" button
   - Option to merge with existing or replace entirely (show a warning if replacing)

---

## 11. Settings

Accessible from a gear icon in the header.

- **Storage** — `navigator.storage.estimate()` displayed as used/quota; button to request persistent storage
- **Catalogue version** — which Scryfall export date is loaded; button to "check for update" (fetches manifest)
- **Imports** — list of all imports (date, card count, images); option to delete an import (remove cards tagged with that import ID)
- **Export backup** — button to download the entire collection as JSON
- **Import backup** — button to upload a previously exported JSON (merge or replace)
- **Clear all images** — frees space; re-download on next app launch or manual trigger

---

## 12. App shell and routing

```
/
├── / (or /library if logged in)     ← default route
│   └── Library (grid/list, filters, search)
├── /import
│   └── CSV Upload + preview + matching + progress
├── /card/:catalogueId
│   └── Card detail + edit
└── /settings
    └── Storage, catalogue version, backup/restore
```

**Header** — always shows app name (icon + "Collection"), current filter state, sort button. Gear icon for settings.

**No bottom nav.** At app load, show a welcome screen if it's first run (ask for app name, colours preference). Then straight to `/import` to upload the CSV. After import, default to `/library`.

---

## 13. Acceptance criteria (testable)

- [ ] **Install to home screen** on iOS; opens as a standalone app, not a web tab
- [ ] **Upload a real TCGPowertools CSV** (10+ cards)
- [ ] **Match and import** — all cards matched to Scryfall within 30 seconds
- [ ] **Images download and cache** — all thumbnail images cached in IndexedDB
- [ ] **Force quit the app**, open in aeroplane mode, browse the library → works, no network errors
- [ ] **Filter + sort** on 1000-card collection → results update in <200ms (no jank)
- [ ] **Storage estimate** in Settings shows realistic used/quota numbers
- [ ] **Export and import backup** — export JSON, wipe the app, import the JSON, see identical collection

---

## 14. Build & deploy

### Local development

```bash
# Install dependencies
npm install

# Fetch + build Scryfall catalogue (run once or when you have a new set)
npm run build:catalogue

# Dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

### Deployment

Push to GitHub (or equivalent). Every commit to `main` triggers a static build + deploy to your HTTPS host (Netlify, Vercel, Cloudflare Pages all work identically).

The deployed URL is the one you share / bookmark / add to home screen.

---

## 15. Specific implementation notes

### Scryfall API call (build script)

```ts
// scripts/build-catalogue.ts
const baseUrl = 'https://api.scryfall.com/bulk-data';
const res = await fetch(baseUrl, {
  headers: {
    'User-Agent': 'MTGCollectionPWA/1.0 (personal tool)',
    'Accept': 'application/json',
  },
});
const bulkMeta = await res.json();
const defaultCards = bulkMeta.data.find(
  (d) => d.type === 'default_cards'
);
// ⚠️ Important: use jsonl_download_uri, NOT download_uri
// The old download_uri was a gzipped JSON array.
// As of 20 July 2026, Scryfall serves JSONL only.
const catalogueUrl = defaultCards.jsonl_download_uri;
```

Decompress with `zlib.createGunzip()`, parse line by line (JSONL format).

### Image URLs in Scryfall cards

Each card object has `image_uris: { small, normal, ... }`. These are the URLs to fetch.

```ts
// Scryfall provides these sizes:
// small: ~240px (for thumbnails)
// normal: ~488px (full card art)
// art_crop: artist crop only (skip for this app)

const imageUrl = card.image_uris.small;
const response = await fetch(imageUrl);
const blob = await response.blob();

// Store in IndexedDB
await db.images.put({
  key: `${card.id}:small`,
  catalogueId: card.id,
  size: 'small',
  blob,
  fetchedAt: Date.now(),
});
```

### CSV parsing (import)

```ts
import Papa from 'papaparse';

const handleCsvUpload = (file: File) => {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // keep all as strings initially
    complete: (results) => {
      const rows = results.data as Record<string, string>[];
      // Detect columns, match to Scryfall, fetch images
    },
    error: (err) => {
      console.error('CSV parse error:', err);
    },
  });
};
```

### Fuzzy matching for unmatched cards

For cards where the CSV has a name but no Scryfall ID, use a simple distance metric:

```ts
// Simplest: Levenshtein distance on lowercased names
const distance = levenshtein(
  csvName.toLowerCase(),
  catalogueCard.name.toLowerCase()
);
// Accept if distance ≤ 2, or show top 3 closest to the user
```

Use the `fastest-levenshtein` npm package or write a simple impl; no need for complex NLP.

### Dexie live queries in React

```tsx
function LibraryGrid() {
  // Automatically re-render when query results change
  const cards = useLiveQuery(
    () =>
      db.owned
        .where('colorIdentity')
        .anyOf(activeFilters.colors)
        .and((c) => c.rarity === activeFilters.rarity)
        .toArray(),
    [activeFilters]
  );

  if (!cards) return <Loading />;
  return <div className="grid">{/* ... */}</div>;
}
```

---

## 16. Design language

- **Dark theme by default** (you're in a cave)
- **High contrast** — white text on dark grey/black
- **Large tap targets** — 44px minimum (iOS guideline)
- **Card grid** — use Tailwind's `grid-cols-3 gap-2` or similar
- **Filter bar** — sticky, icons for colours (W/U/B/R/G), text for others
- **Rounded corners** — subtle, Tailwind's `rounded-lg`
- **Icons** — Heroicons or Feather (lightweight, ship with the build)
- **No hover states** — mobile-first; any affordance must work on tap
- **Fast load** — app shell loads in <2s, library in <1s after

---

## 17. File structure

```
/
├── public/
│   └── data/
│       ├── catalogue-YYYYMMDD.json.gz    (generated by build:catalogue)
│       ├── manifest.json                  (list of bundles + versions)
│       └── icon.png, favicon.ico          (PWA metadata)
├── src/
│   ├── lib/
│   │   ├── db.ts                          (Dexie schema)
│   │   ├── scryfall.ts                    (API calls)
│   │   ├── csv.ts                         (TCGPowertools parser + matching)
│   │   └── image-cache.ts                 (download + store images)
│   ├── routes/
│   │   ├── Library.tsx                    (grid/list, filters, search)
│   │   ├── CardDetail.tsx                 (card view + edit)
│   │   ├── Import.tsx                     (CSV upload + wizard)
│   │   ├── Settings.tsx                   (storage, backup, etc.)
│   │   └── Welcome.tsx                    (first-run onboarding)
│   ├── components/
│   │   ├── FilterBar.tsx
│   │   ├── CardGrid.tsx
│   │   ├── CardListRow.tsx
│   │   ├── Header.tsx
│   │   └── ...
│   ├── App.tsx                            (root + routing)
│   ├── index.tsx                          (entry point)
│   └── globals.css                        (Tailwind imports)
├── scripts/
│   └── build-catalogue.ts                 (Scryfall fetcher + gzip)
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## 18. Instructions to Claude Code

1. **Before writing any code**, fetch `https://api.scryfall.com/bulk-data` and print the live response. Verify the `jsonl_download_uri` property exists (not `download_uri`). Document the result in a comment in the build script.

2. **Dexie first.** Schema + types before any UI. The data model drives everything.

3. **Build pipeline next.** `build:catalogue.ts` must be bulletproof — this is a dependency for the app to work at all. Test it locally on a small set before running on full data. Verify the gzipped catalogue can be downloaded and decompressed in the app.

4. **Import wizard third.** Wire up CSV parsing, Scryfall matching, image download, and IndexedDB writes. This is the user's first experience; it must be smooth.

5. **Library browse fourth.** Get filtering, sorting, and live-query rendering working. Performance on 5000 cards is non-negotiable.

6. **Polish last** — card detail, settings, backup, UX refinement.

7. **If you hit a decision point**, default to simplicity. No state management library, no complex caching, no optimistic updates. Single-threaded, straightforward data flow.

8. **Commit often.** After each major piece (DB, build pipeline, import, library), test it end-to-end before moving on.

