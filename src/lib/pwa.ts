import { registerSW } from 'virtual:pwa-register';

/** The built app-shell version + build time, injected by Vite (vite.config.ts). */
export const APP_VERSION: string = __APP_VERSION__;
export const BUILD_TIME: string = __BUILD_TIME__;

/** The canonical production deployment. */
export const PROD_HOST = 'relmtglibrary.netlify.app';

/** Are we running on the production host? There, updates apply silently and the
 * in-app updater is hidden (it would be redundant). Everywhere else — local,
 * preview, a tunnel on a phone — the updater is shown so you can confirm and
 * trigger it. */
export const isProdHost = (): boolean =>
  typeof location !== 'undefined' && location.hostname === PROD_HOST;

type Listener = (needRefresh: boolean) => void;

const listeners = new Set<Listener>();
let needRefresh = false;
let registration: ServiceWorkerRegistration | undefined;
let applyUpdateFn: ((reload?: boolean) => Promise<void>) | null = null;
let started = false;

/** Register the service worker once, at app startup. */
export function initPWA(): void {
  if (started) return;
  started = true;

  applyUpdateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      // A new app shell is waiting to activate.
      if (isProdHost()) {
        // Behave like autoUpdate on production: swap and reload immediately.
        void applyUpdateFn?.(true);
        return;
      }
      needRefresh = true;
      for (const l of listeners) l(true);
    },
    onRegisteredSW(_swUrl, r) {
      registration = r;
      // A long-open standalone PWA rarely triggers a navigation, so poll for a
      // new shell hourly while the app stays open.
      if (r) setInterval(() => void r.update().catch(() => {}), 60 * 60 * 1000);
    },
  });
}

/** Subscribe to "update available" changes. Fires immediately with current state. */
export function subscribeNeedRefresh(l: Listener): () => void {
  listeners.add(l);
  l(needRefresh);
  return () => {
    listeners.delete(l);
  };
}

/** Activate the waiting service worker and reload into the new version. */
export function applyUpdate(): Promise<void> {
  return applyUpdateFn?.(true) ?? Promise.resolve();
}

/**
 * Ask the browser to re-fetch the service worker now (rather than waiting for the
 * next navigation). Resolves to whether a waiting/new worker is present after the
 * check. Throws if there's no registration (SW unsupported / not yet ready).
 */
export async function checkForUpdate(): Promise<boolean> {
  if (!registration) throw new Error('Service worker not registered yet.');
  await registration.update();
  return needRefresh || !!registration.waiting || !!registration.installing;
}
