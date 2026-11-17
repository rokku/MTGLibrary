import { useCallback, useRef, useState } from 'react';
import { Dialog } from '@headlessui/react';

export interface Choice<T extends string> {
  value: T;
  label: string;
  tone?: 'primary' | 'danger';
}

interface ChoiceRequest {
  title: string;
  message?: string;
  choices: Choice<string>[];
}

const TONE: Record<NonNullable<Choice<string>['tone']>, string> = {
  primary: 'bg-accent text-on-accent font-semibold',
  danger: 'border border-red-800 text-red-300 font-semibold',
};

/**
 * In-app replacement for window.confirm(). `ask()` opens a sheet and resolves
 * with the chosen value, or null if dismissed; `confirm()` is the one-button
 * case. Render `dialog` once in the calling component.
 */
export function useChoice() {
  const [request, setRequest] = useState<ChoiceRequest | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const ask = useCallback(
    <T extends string>(req: { title: string; message?: string; choices: Choice<T>[] }): Promise<T | null> =>
      new Promise((resolve) => {
        resolver.current = resolve as (value: string | null) => void;
        setRequest(req);
      }),
    [],
  );

  const confirm = useCallback(
    async (title: string, message: string, label: string, tone: Choice<string>['tone'] = 'danger') =>
      (await ask({ title, message, choices: [{ value: 'yes', label, tone }] })) === 'yes',
    [ask],
  );

  function close(value: string | null) {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }

  const dialog = (
    <Dialog open={request !== null} onClose={() => close(null)} className="relative z-50">
      <div className="fixed inset-0 bg-black/60" aria-hidden />
      <div className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4">
        <Dialog.Panel className="w-full max-w-md rounded-t-2xl bg-surface-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl">
          <Dialog.Title className="text-lg font-semibold">{request?.title}</Dialog.Title>
          {request?.message && <p className="mt-1 text-sm text-neutral-400">{request.message}</p>}
          <div className="mt-5 flex flex-col gap-2">
            {request?.choices.map((c) => (
              <button
                key={c.value}
                onClick={() => close(c.value)}
                className={`tap-target rounded-xl py-3 text-sm ${c.tone ? TONE[c.tone] : 'bg-surface-2 active:bg-surface-3'}`}
              >
                {c.label}
              </button>
            ))}
            <button onClick={() => close(null)} className="tap-target rounded-xl bg-surface-2 py-3 text-sm active:bg-surface-3">
              Cancel
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );

  return { ask, confirm, dialog };
}
