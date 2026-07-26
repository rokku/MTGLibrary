import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ACCENTS, DEFAULT_SETTINGS, saveSettings } from '../lib/settings';

export function Welcome() {
  const navigate = useNavigate();
  const [name, setName] = useState(DEFAULT_SETTINGS.appName);
  const [accent, setAccent] = useState(DEFAULT_SETTINGS.accent);

  async function start() {
    await saveSettings({ appName: name.trim() || 'Collection', accent, firstRunDone: true });
    navigate('/import');
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl" style={{ backgroundColor: accent }} />
          <h1 className="text-2xl font-bold">Welcome</h1>
          <p className="mt-1 text-sm text-neutral-400">Your offline MTG collection browser.</p>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm text-neutral-400">Name your collection</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg bg-surface-2 px-3 py-3 text-center outline-none"
            placeholder="Collection"
          />
        </label>

        <div>
          <span className="mb-2 block text-center text-sm text-neutral-400">Pick an accent colour</span>
          <div className="flex justify-center gap-3">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                onClick={() => setAccent(a.value)}
                className={`h-10 w-10 rounded-full transition ${
                  accent === a.value ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-0' : ''
                }`}
                style={{ backgroundColor: a.value }}
                aria-label={a.name}
              />
            ))}
          </div>
        </div>

        <button
          onClick={start}
          className="tap-target w-full rounded-lg py-3 font-semibold text-black"
          style={{ backgroundColor: accent }}
        >
          Get started
        </button>
      </div>
    </div>
  );
}
