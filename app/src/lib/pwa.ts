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

/** Which set of manual install instructions fits the current browser. */
export type ManualInstall = 'ios' | 'macos';

/**
 * Safari implements neither `beforeinstallprompt` nor any programmatic install,
 * on any OS — the event this module waits for simply never arrives there, so the
 * banner above would stay hidden forever. When Safari is the browser, installing
 * is a manual gesture the offer has to describe rather than drive: on iOS via
 * Share -> "Add to Home Screen", on macOS via File -> "Add to Dock".
 *
 * Returns which instructions fit, or null for browsers (Chromium, Edge) that
 * raise their own prompt and are handled by `beforeinstallprompt`. UA sniffing is
 * unavoidable here — there is no feature to detect, only the absence of one — so
 * it is kept narrow: any Chromium marker rules Safari out.
 */
export function manualInstallPlatform(): ManualInstall | null {
  if (typeof navigator === 'undefined' || !window.isSecureContext) return null;
  const ua = navigator.userAgent;
  // CriOS/FxIOS/EdgiOS are WebKit too, but they carry no home-screen action of
  // their own; only Safari does. Android is Chromium's territory.
  const isChromium = /chrome|crios|chromium|edg|edgios|opr|fxios|android/i.test(ua);
  const isSafari = /safari/i.test(ua) && !isChromium;
  if (!isSafari) return null;
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports itself as macOS; a touch-capable "Mac" is really an iPad.
    (navigator.maxTouchPoints > 1 && /macintosh/i.test(ua));
  return isIos ? 'ios' : 'macos';
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
