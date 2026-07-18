import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Spinner, TextField } from '../../components/ui';
import { getMnemonic, kdfVersion } from '../../kdf/methods';
import { useAuthStore } from '../../store/auth';

export default function SettingsModal(props: { onClose: () => void }) {
  const walletName = useAuthStore((s) => s.walletName);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void kdfVersion()
      .then(setVersion)
      .catch(() => setVersion('unavailable'));
  }, []);

  return (
    <Modal title="Settings" onClose={props.onClose}>
      <div className="space-y-5">
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-zinc-500">Wallet</span>
            <span className="truncate">{walletName}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-zinc-500">Mode</span>
            <span>Iguana (single address)</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-zinc-500">KDF version</span>
            <span className="truncate font-mono text-xs leading-5">
              {version ?? '…'}
            </span>
          </div>
        </div>
        <RevealSeed />
      </div>
    </Modal>
  );
}

function RevealSeed() {
  const [password, setPassword] = useState('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      setMnemonic(await getMnemonic(password));
      setPassword('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/password|decrypt/i.test(msg) ? 'Wrong password.' : msg);
    } finally {
      setBusy(false);
    }
  };

  if (mnemonic) {
    return (
      <div className="space-y-3">
        <Alert kind="warning">
          Anyone with these words can spend your funds. Never share them.
        </Alert>
        <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:grid-cols-3">
          {mnemonic.split(' ').map((w, i) => (
            <li key={i} className="font-mono text-sm">
              <span className="mr-1.5 inline-block w-5 text-right text-zinc-600">{i + 1}.</span>
              <span className="text-zinc-100">{w}</span>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              void navigator.clipboard.writeText(mnemonic).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setMnemonic(null)}>
            Hide
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (password && !busy) void reveal();
      }}
    >
      <h3 className="text-sm font-medium text-zinc-300">Show seed phrase</h3>
      <TextField
        label="Wallet password"
        type="password"
        value={password}
        onChange={setPassword}
      />
      {error && <Alert kind="error">{error}</Alert>}
      {busy ? (
        <Spinner />
      ) : (
        <Button type="submit" variant="danger" className="w-full" disabled={!password}>
          Reveal seed phrase
        </Button>
      )}
    </form>
  );
}
