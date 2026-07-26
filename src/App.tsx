import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings } from './lib/settings';
import { ensureCatalogue, type LoadProgress } from './lib/catalogue';
import { Library } from './routes/Library';
import { Import } from './routes/Import';
import { CardDetail } from './routes/CardDetail';
import { Settings } from './routes/Settings';
import { Welcome } from './routes/Welcome';

/** Slim banner shown while the Scryfall catalogue loads into IndexedDB. */
function CatalogueBanner() {
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'missing' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    ensureCatalogue((p) => mounted && setProgress(p))
      .then((res) => {
        if (!mounted) return;
        if (res.ok) setState(res.offline ? 'offline' : 'ready');
        else setState(res.offline ? 'offline' : 'missing');
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setState('error');
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (state === 'ready' || state === 'offline') return null;

  if (state === 'missing') {
    return (
      <div className="bg-amber-950/70 px-3 py-1.5 text-center text-xs text-amber-200">
        Catalogue not found — run <code>npm run build:catalogue</code>, then reload.
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="bg-red-950/70 px-3 py-1.5 text-center text-xs text-red-200">
        Couldn't load catalogue: {errorMsg ?? 'unknown error'}
      </div>
    );
  }

  const pct = progress && progress.totalCards ? (progress.loadedCards / progress.totalCards) * 100 : 0;
  return (
    <div className="bg-surface-1 px-3 py-1.5 text-center text-xs text-neutral-300">
      Loading catalogue… {progress ? `${progress.loadedCards.toLocaleString()} / ${progress.totalCards.toLocaleString()}` : ''}
      <div className="mx-auto mt-1 h-1 max-w-xs overflow-hidden rounded-full bg-surface-3">
        <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function App() {
  const settings = useLiveQuery(() => getSettings(), []);

  // Apply the accent as a CSS variable for any consumers.
  useEffect(() => {
    if (settings?.accent) document.documentElement.style.setProperty('--accent', settings.accent);
  }, [settings?.accent]);

  if (settings === undefined) {
    return <div className="flex h-full items-center justify-center text-neutral-500">Loading…</div>;
  }

  return (
    <BrowserRouter>
      <div className="mx-auto flex h-full max-w-3xl flex-col">
        <CatalogueBanner />
        <div className="min-h-0 flex-1">
          <Routes>
            <Route path="/" element={settings.firstRunDone ? <Library /> : <Navigate to="/welcome" replace />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/import" element={<Import />} />
            <Route path="/card/:catalogueId" element={<CardDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
