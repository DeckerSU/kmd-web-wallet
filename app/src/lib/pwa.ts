/**
 * Install-to-home-screen support.
 *
 * Browsers fire `beforeinstallprompt` when the app qualifies, and the event must
 * be kept so the prompt can be raised later from a real user gesture — calling
 * `prompt()` straight away is not allowed, and browsers only fire the event once
 * per page load, so losing it means losing the ability to offer installation at
 * all until reload.
 */

/** Not in lib.dom yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = (available: boolean) => void;

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<Listener>();

const notify = () => {
  for (const fn of listeners) fn(deferred !== null);
};

/** True when the app is already running as an installed app. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates the display-mode query.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function onInstallAvailability(fn: Listener): () => void {
  listeners.add(fn);
  fn(deferred !== null);
  return () => listeners.delete(fn);
}

/**
 * Raise the browser's install dialog. Must be called from a user gesture.
 * Returns whether the user accepted; either way the event is spent and cannot
 * be reused.
 */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === 'accepted';
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress the browser's own mini-infobar so the offer appears where the
    // rest of the UI lives, at a moment that makes sense.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });

  // Registered only in production: in dev, Vite serves modules the worker would
  // shadow, and a stale worker is a confusing thing to debug.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch((e: unknown) => {
        console.warn('[pwa] service worker registration failed', e);
      });
    });
  }
}
