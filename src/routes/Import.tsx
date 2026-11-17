import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpTrayIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { useSettings } from '../hooks/useSettings';
import { db } from '../lib/db';
import {
  detectColumns,
  matchRows,
  parseCsv,
  rememberMatches,
  resolveOnline,
  type ColumnMapping,
  type MatchResult,
  type NormalizedField,
  type OnlineProgress,
  type OnlineSummary,
  type ParsedCsv,
} from '../lib/csv';
import { downloadImages, type ImageProgress } from '../lib/image-cache';
import { commitImport, syncImport, type SyncSummary } from '../lib/collection';

type Step = 'upload' | 'map' | 'match' | 'images' | 'commit' | 'done';

const FIELD_LABELS: Record<NormalizedField, string> = {
  quantity: 'Quantity',
  scryfallId: 'Scryfall ID',
  cardmarketId: 'Cardmarket ID',
  name: 'Name',
  expansion: 'Set / Expansion',
  finish: 'Foil / Finish',
  condition: 'Condition',
  language: 'Language',
  location: 'Location / Storage',
};

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs ${active ? 'text-white' : 'text-neutral-500'}`}>
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
          done ? 'bg-green-600 text-white' : active ? 'bg-white text-black' : 'bg-surface-2'
        }`}
      >
        {done ? '✓' : n}
      </span>
      {label}
    </div>
  );
}

export function Import() {
  const navigate = useNavigate();
  const settings = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [results, setResults] = useState<MatchResult[]>([]);
  const [matchProgress, setMatchProgress] = useState(0);
  const [imgProgress, setImgProgress] = useState<ImageProgress | null>(null);
  const [imgStats, setImgStats] = useState<{ fetched: number; failed: number } | null>(null);
  const [committing, setCommitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [existingCount, setExistingCount] = useState(0);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [online, setOnline] = useState<
    | { state: 'idle' }
    | { state: 'running'; progress: OnlineProgress }
    | { state: 'done'; summary: OnlineSummary }
    | { state: 'error'; message: string }
  >({ state: 'idle' });
  const [reviewOpen, setReviewOpen] = useState(false);

  // ── Step 1: upload ────────────────────────────────────────────────
  async function handleFile(file: File) {
    setError(null);
    setFilename(file.name);
    try {
      const p = await parseCsv(file);
      if (p.rows.length === 0) {
        setError('That CSV has no data rows.');
        return;
      }
      setParsed(p);
      setMapping(detectColumns(p.headers));
      setStep('map');
    } catch (e) {
      setError(`Could not parse CSV: ${(e as Error).message}`);
    }
  }

  // ── Step 2 → 3: run matching ──────────────────────────────────────
  async function runMatch() {
    if (!parsed) return;
    if (!mapping.name && !mapping.scryfallId) {
      setError('Map at least a Name or Scryfall ID column to match cards.');
      return;
    }
    if ((await db.catalogue.count()) === 0) {
      setError('The Scryfall catalogue is not loaded. Run `npm run build:catalogue` and reload.');
      return;
    }
    setError(null);
    setStep('match');
    setMatchProgress(0);
    setOnline({ state: 'idle' });
    const res = await matchRows(parsed.rows, mapping, {
      onProgress: (done, total) => setMatchProgress(Math.round((done / total) * 100)),
    });
    setResults(res);
    if (navigator.onLine && needsOnline(res)) await runOnline(res);
  }

  // ── Step 3b: look up what the local catalogue missed on Scryfall ──
  const needsOnline = (rs: MatchResult[]) => rs.some((r) => r.status === 'unmatched' || r.printingGuessed);

  async function runOnline(base: MatchResult[]) {
    setOnline({ state: 'running', progress: { done: 0, total: 0 } });
    try {
      const { results: next, summary } = await resolveOnline(base, {
        onProgress: (progress) => setOnline({ state: 'running', progress }),
      });
      setResults(next);
      setOnline({ state: 'done', summary });
    } catch (e) {
      setOnline({ state: 'error', message: (e as Error).message });
    }
  }

  // ── Step 3 → 4: download images ───────────────────────────────────
  async function runImages() {
    const matched = results.filter((r) => r.status === 'matched' && r.catalogueId);
    const ids = [...new Set(matched.map((r) => r.catalogueId!))];
    const cards = (await db.catalogue.bulkGet(ids)).filter((c): c is NonNullable<typeof c> => !!c);

    setStep('images');
    setExistingCount(await db.owned.count());
    const controller = new AbortController();
    abortRef.current = controller;
    setImgProgress({ done: 0, total: cards.length, failed: 0, cached: 0 });

    try {
      const stats = await downloadImages(cards, 'small', (p) => setImgProgress(p), controller.signal);
      setImgStats({ fetched: stats.total - stats.failed, failed: stats.failed });
      setStep('commit');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // Paused — stay on the images step; user can resume.
        return;
      }
      setError((e as Error).message);
    }
  }

  function pauseImages() {
    abortRef.current?.abort();
  }

  // ── Step 5: commit ────────────────────────────────────────────────
  async function commit(mode: 'merge' | 'replace' | 'sync') {
    const matched = results.filter((r) => r.status === 'matched' && r.catalogueId);
    setCommitting(true);
    try {
      await rememberMatches(results);
      if (mode === 'sync') {
        const unmatchedNames = results.filter((r) => r.status !== 'matched').map((r) => r.rawName);
        const { summary } = await syncImport(matched, filename, imgStats ?? { fetched: 0, failed: 0 }, unmatchedNames);
        setSyncSummary(summary);
      } else {
        setSyncSummary(null);
        await commitImport(matched, filename, mode, imgStats ?? { fetched: 0, failed: 0 });
      }
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCommitting(false);
    }
  }

  const matchedCount = results.filter((r) => r.status === 'matched').length;
  const unmatchedCount = results.filter((r) => r.status === 'unmatched').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const locatedCount = results.filter((r) => r.status === 'matched' && r.location).length;
  const guessed = results.filter((r) => r.status === 'matched' && r.printingGuessed);
  const nonEnglishCount = results.filter((r) => r.status === 'matched' && r.language).length;
  const onlineRunning = online.state === 'running';

  function resolveRow(rowIndex: number, catalogueId: string | null) {
    setResults((prev) =>
      prev.map((r) =>
        r.rowIndex === rowIndex
          ? catalogueId
            ? { ...r, status: 'matched', catalogueId, method: 'manual', printingGuessed: false, reason: undefined }
            : { ...r, status: 'skipped', reason: 'Skipped by you' }
          : r,
      ),
    );
  }

  const stepOrder: Step[] = ['upload', 'map', 'match', 'images', 'commit'];
  const stepIndex = stepOrder.indexOf(step === 'done' ? 'commit' : step);

  return (
    <div className="flex h-full flex-col">
      <Header title="Import collection" back="/settings" accent={settings.accent} />

      <div className="flex items-center justify-between gap-1 overflow-x-auto border-b border-surface-2 px-3 py-2">
        {['Upload', 'Map', 'Match', 'Images', 'Commit'].map((label, i) => (
          <StepBadge key={label} n={i + 1} label={label} active={i === stepIndex} done={i < stepIndex || step === 'done'} />
        ))}
      </div>

      <main className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-950/60 p-3 text-sm text-red-200">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-surface-3 p-10 text-center"
          >
            <ArrowUpTrayIcon className="h-10 w-10 text-neutral-500" />
            <div>
              <p className="font-medium">Drop your TCGPowertools CSV here</p>
              <p className="text-sm text-neutral-500">or choose a file</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              className="tap-target rounded-lg px-5 py-3 font-semibold text-black"
              style={{ backgroundColor: settings.accent }}
            >
              Choose CSV
            </button>
          </div>
        )}

        {/* Step 2: Map columns + preview */}
        {step === 'map' && parsed && (
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-neutral-300">Column mapping</h2>
              <div className="space-y-2">
                {(Object.keys(FIELD_LABELS) as NormalizedField[]).map((field) => (
                  <label key={field} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-neutral-400">{FIELD_LABELS[field]}</span>
                    <select
                      value={mapping[field] ?? ''}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))
                      }
                      className="min-w-[160px] rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
                    >
                      <option value="">— none —</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-neutral-300">Preview (first 5 rows)</h2>
              <div className="overflow-x-auto rounded-lg border border-surface-2">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-1 text-neutral-400">
                    <tr>
                      {parsed.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-1.5">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t border-surface-2">
                        {parsed.headers.map((h) => (
                          <td key={h} className="whitespace-nowrap px-2 py-1.5 text-neutral-300">
                            {row[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-neutral-500">{parsed.rows.length} rows total</p>
            </section>

            <button
              onClick={runMatch}
              className="tap-target w-full rounded-lg py-3 font-semibold text-black"
              style={{ backgroundColor: settings.accent }}
            >
              Match to Scryfall
            </button>
          </div>
        )}

        {/* Step 3: Match results */}
        {step === 'match' && (
          <div className="space-y-4">
            {results.length === 0 ? (
              <div>
                <p className="mb-2 text-sm text-neutral-400">Matching… {matchProgress}%</p>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-white transition-all" style={{ width: `${matchProgress}%` }} />
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-surface-1 p-3">
                    <div className="text-xl font-bold text-green-400">{matchedCount}</div>
                    <div className="text-xs text-neutral-400">Matched</div>
                  </div>
                  <div className="rounded-lg bg-surface-1 p-3">
                    <div className="text-xl font-bold text-amber-400">{unmatchedCount}</div>
                    <div className="text-xs text-neutral-400">Unmatched</div>
                  </div>
                  <div className="rounded-lg bg-surface-1 p-3">
                    <div className="text-xl font-bold text-neutral-400">{skippedCount}</div>
                    <div className="text-xs text-neutral-400">Skipped</div>
                  </div>
                </div>

                {onlineRunning && (
                  <div>
                    <p className="mb-2 text-sm text-neutral-400">
                      Looking up missing cards on Scryfall…
                      {online.progress.total > 0 && ` ${online.progress.done}/${online.progress.total}`}
                    </p>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full bg-white transition-all"
                        style={{
                          width: `${online.progress.total ? (online.progress.done / online.progress.total) * 100 : 5}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {online.state === 'done' && (
                  <p className="rounded-lg bg-surface-1 p-3 text-sm text-neutral-300">
                    Scryfall found {online.summary.resolved} card{online.summary.resolved === 1 ? '' : 's'}
                    {online.summary.refined > 0 && ` and corrected ${online.summary.refined} printing${online.summary.refined === 1 ? '' : 's'}`}
                    {online.summary.suggested > 0 && `, with ${online.summary.suggested} suggestion${online.summary.suggested === 1 ? '' : 's'} to confirm below`}
                    .
                    {online.summary.failed > 0 && ` ${online.summary.failed} lookups failed.`}
                  </p>
                )}
                {online.state === 'error' && (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 p-3 text-sm text-neutral-300">
                    <span>{online.message}</span>
                    <button
                      onClick={() => runOnline(results)}
                      className="shrink-0 rounded-lg bg-surface-2 px-3 py-1.5 active:bg-surface-3"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {online.state === 'idle' && needsOnline(results) && (
                  <button
                    onClick={() => runOnline(results)}
                    className="w-full rounded-lg bg-surface-2 py-3 text-sm active:bg-surface-3"
                  >
                    Look up missing cards on Scryfall
                  </button>
                )}

                {guessed.length > 0 && !onlineRunning && (
                  <section className="rounded-lg bg-surface-1 p-3">
                    <button
                      onClick={() => setReviewOpen((v) => !v)}
                      className="flex w-full items-center justify-between text-left text-sm"
                    >
                      <span>
                        <span className="font-semibold text-amber-400">{guessed.length}</span> matched by name only.
                        The printing may differ from your CSV.
                      </span>
                      <span className="text-xs text-neutral-400 underline">{reviewOpen ? 'Hide' : 'Review'}</span>
                    </button>
                    {reviewOpen && (
                      <ul className="mt-3 space-y-3">
                        {guessed.map((r) => (
                          <li key={r.rowIndex}>
                            <p className="mb-1.5 text-sm">
                              {r.rawName}
                              <span className="ml-1.5 text-xs text-neutral-500">CSV set: {r.expansion}</span>
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {r.candidates.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => resolveRow(r.rowIndex, c.id)}
                                  className={`rounded-lg px-2.5 py-1.5 text-left text-xs ${
                                    c.id === r.catalogueId ? 'bg-white text-black' : 'bg-surface-2 active:bg-surface-3'
                                  }`}
                                >
                                  {c.setName}
                                  <span className="block text-[10px] uppercase opacity-60">
                                    {c.setCode} · {c.collectorNumber}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {unmatchedCount > 0 && !onlineRunning && (
                  <section>
                    <h2 className="mb-2 text-sm font-semibold text-neutral-300">Resolve unmatched</h2>
                    <ul className="space-y-3">
                      {results
                        .filter((r) => r.status === 'unmatched')
                        .map((r) => (
                          <li key={r.rowIndex} className="rounded-lg bg-surface-1 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="min-w-0">
                                <span className="font-medium">{r.rawName || '(no name)'}</span>
                                {r.expansion && (
                                  <span className="block text-xs text-neutral-500">{r.expansion}</span>
                                )}
                              </span>
                              <button
                                onClick={() => resolveRow(r.rowIndex, null)}
                                className="text-xs text-neutral-400 underline"
                              >
                                Skip
                              </button>
                            </div>
                            {r.candidates.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {r.candidates.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={() => resolveRow(r.rowIndex, c.id)}
                                    className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-left text-xs active:bg-surface-3"
                                  >
                                    {c.name}
                                    <span className="block text-[10px] text-neutral-500">
                                      {c.setName} · <span className="uppercase">{c.setCode}</span> {c.collectorNumber}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-500">{r.reason ?? 'No candidates found'}</p>
                            )}
                          </li>
                        ))}
                    </ul>
                  </section>
                )}

                <button
                  onClick={runImages}
                  disabled={matchedCount === 0 || onlineRunning}
                  className="tap-target w-full rounded-lg py-3 font-semibold text-black disabled:opacity-40"
                  style={{ backgroundColor: settings.accent }}
                >
                  Download images ({matchedCount} cards)
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 4: Images */}
        {step === 'images' && imgProgress && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-400">
              Fetching images… {imgProgress.done}/{imgProgress.total}
              {imgProgress.failed > 0 && ` · ${imgProgress.failed} failed`}
              {imgProgress.cached > 0 && ` · ${imgProgress.cached} already cached`}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${imgProgress.total ? (imgProgress.done / imgProgress.total) * 100 : 100}%` }}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={pauseImages} className="flex-1 rounded-lg bg-surface-2 py-3 text-sm active:bg-surface-3">
                Pause
              </button>
              <button onClick={runImages} className="flex-1 rounded-lg bg-surface-2 py-3 text-sm active:bg-surface-3">
                Resume
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Commit */}
        {step === 'commit' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-surface-1 p-4 text-sm">
              <p className="mb-1">
                <span className="font-semibold text-green-400">{matchedCount}</span> cards ready to import.
              </p>
              {skippedCount > 0 && <p className="text-neutral-400">{skippedCount} skipped.</p>}
              {unmatchedCount > 0 && (
                <p className="text-neutral-400">{unmatchedCount} still unmatched and won’t be imported.</p>
              )}
              {nonEnglishCount > 0 && (
                <p className="text-neutral-400">{nonEnglishCount} non-English cards are stored as their English printing.</p>
              )}
              {imgStats && (
                <p className="text-neutral-400">
                  {imgStats.fetched} images cached{imgStats.failed > 0 && `, ${imgStats.failed} failed`}.
                </p>
              )}
              <p className="text-neutral-400">
                {locatedCount > 0
                  ? `${locatedCount} have a location.`
                  : mapping.location
                    ? 'No locations found — the mapped Location column is empty.'
                    : 'No location column mapped — go back to Map to set one.'}
              </p>
            </div>

            {existingCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-surface-1 p-3 text-sm text-neutral-300">
                <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
                <span>
                  You already have {existingCount} cards. <b>Sync</b> makes your collection match this
                  CSV — adding new cards, updating quantities, and removing cards no longer listed, while
                  keeping your tags, notes, and any copies you added by hand.
                </span>
              </div>
            )}

            {existingCount > 0 ? (
              <>
                <button
                  onClick={() => commit('sync')}
                  disabled={committing}
                  className="tap-target w-full rounded-lg py-3 font-semibold text-black disabled:opacity-40"
                  style={{ backgroundColor: settings.accent }}
                >
                  Sync to match CSV
                </button>
                <button
                  onClick={() => commit('merge')}
                  disabled={committing}
                  className="tap-target w-full rounded-lg bg-surface-2 py-3 font-semibold disabled:opacity-40 active:bg-surface-3"
                >
                  Merge (add as extra copies)
                </button>
                <button
                  onClick={() => commit('replace')}
                  disabled={committing}
                  className="tap-target w-full rounded-lg border border-red-800 py-3 font-semibold text-red-300 disabled:opacity-40"
                >
                  Replace entire collection
                </button>
              </>
            ) : (
              <button
                onClick={() => commit('merge')}
                disabled={committing}
                className="tap-target w-full rounded-lg py-3 font-semibold text-black disabled:opacity-40"
                style={{ backgroundColor: settings.accent }}
              >
                Add to collection
              </button>
            )}
          </div>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 pt-16 text-center">
            <CheckCircleIcon className="h-16 w-16 text-green-500" />
            {syncSummary ? (
              <>
                <p className="text-lg font-semibold">Collection synced</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-surface-1 px-4 py-2">
                    <span className="font-bold text-green-400">{syncSummary.added}</span> added
                  </div>
                  <div className="rounded-lg bg-surface-1 px-4 py-2">
                    <span className="font-bold text-sky-400">{syncSummary.updated}</span> updated
                  </div>
                  <div className="rounded-lg bg-surface-1 px-4 py-2">
                    <span className="font-bold text-red-400">{syncSummary.removed}</span> removed
                  </div>
                  <div className="rounded-lg bg-surface-1 px-4 py-2">
                    <span className="font-bold text-neutral-300">{syncSummary.unchanged}</span> unchanged
                  </div>
                </div>
                {syncSummary.kept > 0 && (
                  <p className="text-sm text-neutral-400">
                    Kept {syncSummary.kept} owned card{syncSummary.kept === 1 ? '' : 's'} whose CSV rows didn’t match.
                  </p>
                )}
                <p className="text-sm text-neutral-500">
                  {imgStats?.fetched ?? 0} new images cached{skippedCount > 0 && `, ${skippedCount} skipped`}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">Imported {matchedCount} cards</p>
                <p className="text-sm text-neutral-400">
                  {imgStats?.fetched ?? 0} images cached, {skippedCount} skipped
                </p>
              </>
            )}
            <button
              onClick={() => navigate('/')}
              className="tap-target rounded-lg px-6 py-3 font-semibold text-black"
              style={{ backgroundColor: settings.accent }}
            >
              View library
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
