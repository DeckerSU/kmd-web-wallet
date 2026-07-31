import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui';
import {
  isStandalone,
  manualInstallPlatform,
  onInstallAvailability,
  promptInstall,
} from '../../lib/pwa';

/**
 * Offer to install the wallet as an app.
 *
 * Shown as a dismissible bar rather than the browser's own infobar, so it can be
 * declined for good: a wallet that nags on every visit is worse than one that
 * never asks. The dismissal is remembered locally and only reset by clearing
 * site data — which also clears the wallets, so the two go together anyway.
 *
 * Two shapes, because two kinds of browser. Chromium fires `beforeinstallprompt`
 * and installs on a click. Safari fires nothing and exposes no install API, on
 * any OS, so there the bar can only tell the user how to do it by hand.
 */
const DISMISSED_KEY = 'kdf.installPromptDismissed';

const MANUAL_COPY = {
  ios: 'Tap the Share button, then choose “Add to Home Screen”.',
  macos: 'Open the File menu (or Share), then choose “Add to Dock”.',
} as const;

export default function InstallPrompt() {
  const [available, setAvailable] = useState(false);
  const manual = useMemo(() => manualInstallPlatform(), []);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => onInstallAvailability(setAvailable), []);

  // Nothing to offer when neither the browser has qualified the app (Chromium)
  // nor Safari needs the how-to, when the offer was declined, or when this *is*
  // the installed app.
  if ((!available && !manual) || dismissed || isStandalone()) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* a remembered dismissal is a nicety */
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <img src="/icon-192.png" alt="" className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">Install KMD Wallet</p>
          <p className="truncate text-xs text-zinc-500">
            {available
              ? 'Add it to your home screen - opens in its own window, no browser bar.'
              : MANUAL_COPY[manual!]}
          </p>
        </div>
        {available && (
          <Button
            onClick={() => {
              void promptInstall().then((accepted) => {
                if (accepted) setDismissed(true);
              });
            }}
          >
            Install
          </Button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-lg px-2 py-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
