# MTG Collection PWA

An offline-first, installable PWA for browsing your CardMarket / TCGPowertools
MTG collection. Import a CSV once, cache card images locally, then browse and
filter your library with zero network — built to work "in a cave."

Two jobs, done well:

1. **Import** a TCGPowertools CSV → match each card to Scryfall → cache
   thumbnails → store everything in IndexedDB.
2. **Browse** your collection offline with fast filtering, search and sort.

## Stack

Vite + React 18 + TypeScript (strict) · Tailwind + Headless UI · React Router ·
Dexie (IndexedDB) · PapaParse · `vite-plugin-pwa` (Workbox) · Scryfall bulk data.

No backend, no state library — React Context-free data flow via Dexie live queries.

## Getting started

```bash
npm install

# 1) Build the Scryfall catalogue (run once, or when a new set drops).
#    Streams Scryfall's ~600MB bulk JSONL and emits gzipped chunks +
#    public/data/manifest.json. Uses `jsonl_download_uri` per Scryfall's
#    July 2026 migration.
npm run build:catalogue

# 2) Dev server
npm run dev

# 3) Production build + local preview
npm run build
npm run preview
```

Open the app, complete the one-time welcome, then **Settings → Import
Collection** and upload a TCGPowertools CSV. A `sample-collection.csv` is
included for testing.

## How it works

- **Catalogue** (`scripts/build-catalogue.ts`) projects each Scryfall card to a
  compact `CatalogueCard`, filtered to English paper printings, split into 27
  gzipped chunks (`a`–`z`, `0`) under `public/data/`. On first launch the app
  decompresses these in-browser (`DecompressionStream`) into IndexedDB.
- **Import** (`src/lib/csv.ts`) parses the CSV, auto-detects columns, and matches
  each row by Scryfall ID → name+set → fuzzy (Levenshtein). Matched cards' `small`
  images are downloaded (6 concurrent, pausable) and stored as blobs.
- **Browse** (`src/routes/Library.tsx`) reads all owned rows via a Dexie live
  query and filters/sorts/groups in memory — a full scan of a few thousand rows
  stays well under the 200ms budget. Facet fields are denormalised onto
  `OwnedCard` so no joins are ever needed.
- **Offline**: the service worker precaches only the app shell; all collection
  data lives in IndexedDB. Call **Settings → Request persistent storage** after
  importing. Backup is a manual JSON export.

## CSV format (TCGPowertools)

Detected/normalised columns: `Quantity`, `Name` + `Expansion` (set name or code),
`Cardmarket ID` / `Scryfall ID`, `Foil`/`Finish`, `Condition`, `Language`.
Non-English rows are skipped. You can remap any column during import.

## Deploy

Static build (`dist/`) to any HTTPS host (Netlify, Vercel, Cloudflare Pages).
The deployed URL is what you add to your iOS home screen.

> **Note:** `public/data/` (the generated catalogue) is git-ignored. Either run
> `npm run build:catalogue` in CI before `npm run build`, or commit the generated
> chunks if you prefer a self-contained deploy.
