import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowUpTrayIcon, ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Header } from '../components/Header';
import { useSettings } from '../hooks/useSettings';
import { db } from '../lib/db';
import { ACCENTS, saveSettings } from '../lib/settings';
import { exportBackup, importBackup, deleteImport, type BackupFile } from '../lib/collection';
import { fetchManifest, loadedCatalogueVersion } from '../lib/catalogue';

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-surface-2 py-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
      {children}
    </section>
  );
}

export function Settings() {
  const settings = useSettings();
  const imports = useLiveQuery(() => db.imports.orderBy('importedAt').reverse().toArray(), [], []);
  const backupInput = useRef<HTMLInputElement>(null);

  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [catVersion, setCatVersion] = useState<string | null>(null);
  const [catCount, setCatCount] = useState<number>(0);
  const [updateInfo, setUpdateInfo] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function refreshStorage() {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
    }
    if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted());
    setCatVersion(await loadedCatalogueVersion());
    setCatCount(await db.catalogue.count());
  }

  useEffect(() => {
    refreshStorage();
  }, []);

  async function requestPersist() {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      setPersisted(granted);
      setStatus(granted ? 'Persistent storage granted.' : 'Persistent storage was denied by the browser.');
    }
  }

  async function checkUpdate() {
    setUpdateInfo('Checking…');
    const manifest = await fetchManifest();
    if (!manifest) {
      setUpdateInfo('Could not reach the catalogue manifest (offline?).');
      return;
    }
    const local = await loadedCatalogueVersion();
    setUpdateInfo(
      manifest.version === local
        ? `Up to date (version ${manifest.version}).`
        : `Update available: ${manifest.version} (you have ${local ?? 'none'}). Reload the app to load it.`,
    );
  }

  async function doExport() {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date(backup.exportedAt).toISOString().slice(0, 10);
    a.href = url;
    a.download = `mtg-collection-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${backup.owned.length} cards.`);
  }

  async function doImportBackup(file: File, mode: 'merge' | 'replace') {
    try {
      const text = await file.text();
      const backup = JSON.parse(text) as BackupFile;
      const res = await importBackup(backup, mode);
      setStatus(`Restored ${res.owned} cards.`);
    } catch (e) {
      setStatus(`Import failed: ${(e as Error).message}`);
    }
  }

  async function clearImages() {
    if (confirm('Clear all cached images? They will re-download when needed.')) {
      await db.images.clear();
      await refreshStorage();
      setStatus('Cleared cached images.');
    }
  }

  async function removeImport(id: string) {
    if (confirm('Delete this import and all its cards?')) {
      await deleteImport(id);
      setStatus('Import deleted.');
    }
  }

  const usagePct = estimate && estimate.quota > 0 ? (estimate.usage / estimate.quota) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      <Header title="Settings" back="/" accent={settings.accent} />
      <main className="flex-1 overflow-y-auto px-4">
        {status && (
          <div className="mt-3 rounded-lg bg-surface-1 p-3 text-sm text-neutral-300">{status}</div>
        )}

        <SettingSection title="Appearance">
          <label className="mb-3 block">
            <span className="mb-1 block text-sm text-neutral-400">Collection name</span>
            <input
              defaultValue={settings.appName}
              onBlur={(e) => saveSettings({ appName: e.target.value.trim() || 'Collection' })}
              className="w-full rounded-lg bg-surface-2 px-3 py-2 outline-none"
            />
          </label>
          <span className="mb-1 block text-sm text-neutral-400">Accent</span>
          <div className="flex gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                onClick={() => saveSettings({ accent: a.value })}
                className={`h-9 w-9 rounded-full ${settings.accent === a.value ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-0' : ''}`}
                style={{ backgroundColor: a.value }}
                aria-label={a.name}
              />
            ))}
          </div>
        </SettingSection>

        <SettingSection title="Storage">
          {estimate ? (
            <>
              <div className="mb-2 flex justify-between text-sm text-neutral-300">
                <span>{bytes(estimate.usage)} used</span>
                <span className="text-neutral-500">of {bytes(estimate.quota)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full" style={{ width: `${Math.min(usagePct, 100)}%`, backgroundColor: settings.accent }} />
              </div>
            </>
          ) : (
            <p className="text-sm text-neutral-500">Storage estimate unavailable.</p>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-neutral-400">
              Persistent storage: {persisted == null ? '—' : persisted ? 'granted' : 'not granted'}
            </span>
            {!persisted && (
              <button onClick={requestPersist} className="rounded-lg bg-surface-2 px-3 py-2 text-sm active:bg-surface-3">
                Request
              </button>
            )}
          </div>
        </SettingSection>

        <SettingSection title="Catalogue">
          <p className="text-sm text-neutral-300">
            Version {catVersion ?? 'not loaded'} · {catCount.toLocaleString()} cards
          </p>
          <button onClick={checkUpdate} className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm active:bg-surface-3">
            Check for update
          </button>
          {updateInfo && <p className="mt-2 text-sm text-neutral-400">{updateInfo}</p>}
        </SettingSection>

        <SettingSection title="Imports">
          <Link
            to="/import"
            className="mb-3 flex items-center gap-2 rounded-lg px-4 py-3 font-semibold text-black"
            style={{ backgroundColor: settings.accent }}
          >
            <ArrowUpTrayIcon className="h-5 w-5" /> Import collection
          </Link>
          {imports && imports.length > 0 ? (
            <ul className="space-y-2">
              {imports.map((imp) => (
                <li key={imp.id} className="flex items-center justify-between rounded-lg bg-surface-1 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{imp.filename}</p>
                    <p className="text-xs text-neutral-500">
                      {new Date(imp.importedAt).toLocaleDateString()} · {imp.cardCount} cards · {imp.imagesFetched} images
                    </p>
                  </div>
                  <button onClick={() => removeImport(imp.id)} className="tap-target text-red-400" aria-label="Delete import">
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">No imports yet.</p>
          )}
        </SettingSection>

        <SettingSection title="Backup">
          <div className="flex flex-col gap-2">
            <button onClick={doExport} className="flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-3 text-sm active:bg-surface-3">
              <ArrowDownTrayIcon className="h-5 w-5" /> Export collection (JSON)
            </button>
            <input
              ref={backupInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const mode = confirm('Replace your current collection? OK = replace, Cancel = merge.')
                  ? 'replace'
                  : 'merge';
                doImportBackup(f, mode);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => backupInput.current?.click()}
              className="flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-3 text-sm active:bg-surface-3"
            >
              <ArrowUpTrayIcon className="h-5 w-5" /> Import backup (JSON)
            </button>
          </div>
        </SettingSection>

        <SettingSection title="Maintenance">
          <button
            onClick={clearImages}
            className="flex items-center gap-2 rounded-lg border border-red-900 px-4 py-3 text-sm text-red-300"
          >
            <TrashIcon className="h-5 w-5" /> Clear all cached images
          </button>
        </SettingSection>

        <div className="py-6 text-center text-xs text-neutral-600">MTG Collection PWA · offline-first</div>
      </main>
    </div>
  );
}
