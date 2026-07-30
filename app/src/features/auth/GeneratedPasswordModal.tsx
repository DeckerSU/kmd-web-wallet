import { useState } from 'react';
import { Alert, Button, Modal } from '../../components/ui';
import { useAuthStore } from '../../store/auth';

/**
 * Shown once, right after a wallet is created with a passkey.
 *
 * The user never chose this password, so this is the only moment they learn it
 * exists. It matters because the passkey is not a backup of itself: lose the
 * authenticator and the encrypted copy in IndexedDB can never be opened again.
 * Dismissal is gated behind an explicit acknowledgement for that reason.
 */
export default function GeneratedPasswordModal() {
  const { generatedPassword, clearGeneratedPassword } = useAuthStore();
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  if (!generatedPassword) return null;

  const copy = () => {
    void navigator.clipboard.writeText(generatedPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal title="Save your wallet password" onClose={() => undefined}>
      <div className="space-y-4">
        <Alert kind="warning">
          Your passkey unlocks this wallet on this device. If you lose it, this password is
          the only other way in — apart from re-importing your seed phrase.
        </Alert>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <p className="mb-2 text-xs text-zinc-500">Wallet password</p>
          <p className="break-all font-mono text-sm text-emerald-300">{generatedPassword}</p>
        </div>

        <Button variant="ghost" className="w-full" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy password'}
        </Button>

        <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
          />
          I have saved this password somewhere safe
        </label>

        <Button className="w-full" disabled={!acknowledged} onClick={clearGeneratedPassword}>
          Continue
        </Button>

        <p className="text-center text-xs text-zinc-600">
          You can see it again any time in Settings.
        </p>
      </div>
    </Modal>
  );
}
