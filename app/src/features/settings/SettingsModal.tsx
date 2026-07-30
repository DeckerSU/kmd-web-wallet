import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Spinner, TextField } from '../../components/ui';
import { APP_VERSION } from '../../config/constants';
import { getMnemonic, kdfVersion } from '../../kdf/methods';
import { PasskeyCancelled, unlockPassword } from '../../services/passkey';
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
          <div className="flex justify-between gap-4">
            <span className="text-zinc-500">App version</span>
            <span className="truncate font-mono text-xs leading-5">{APP_VERSION}</span>
          </div>
        </div>
        <PasskeySection />
        <RevealSeed />
      </div>
    </Modal>
  );
}

/**
 * Passkey status, the generated wallet password, and enrolment for wallets that
 * predate passkeys. The password lives behind the same passkey prompt that
 * unlocks the wallet, so revealing it is never cheaper than logging in.
 */
function PasskeySection() {
  const { walletName, passkeySupported, passkeyWallets, addPasskey, forgetPasskey } =
    useAuthStore();
  const [password, setPassword] = useState<string | null>(null);
  const [enrolPassword, setEnrolPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!walletName) return null;
  const hasPasskey = passkeyWallets.includes(walletName);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof PasskeyCancelled) setError(null);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!passkeySupported && !hasPasskey) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-zinc-300">Passkey</h3>
        <p className="text-xs text-zinc-500">
          This browser can&apos;t create passkeys that protect a wallet password. Unlock with
          your password instead.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-zinc-800 pt-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">Passkey</h3>
        <span className={`text-xs ${hasPasskey ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {hasPasskey ? '🔑 Enabled' : 'Not set up'}
        </span>
      </div>

      {hasPasskey ? (
        <>
          {password ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="mb-2 text-xs text-zinc-500">Wallet password</p>
                <p className="break-all font-mono text-sm text-emerald-300">{password}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    void navigator.clipboard.writeText(password).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </Button>
                <Button variant="ghost" className="flex-1" onClick={() => setPassword(null)}>
                  Hide
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="w-full"
              disabled={busy}
              onClick={() =>
                void run(async () => setPassword(await unlockPassword(walletName)))
              }
            >
              Show wallet password
            </Button>
          )}

          {confirmRemove ? (
            <div className="space-y-2">
              <Alert kind="warning">
                You&apos;ll need your wallet password to unlock this wallet again. Make sure
                you have it saved.
              </Alert>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={() => setConfirmRemove(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => void run(() => forgetPasskey(walletName))}
                >
                  Remove passkey
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              className="text-xs text-zinc-500 transition hover:text-red-400"
            >
              Remove passkey from this browser
            </button>
          )}
        </>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!enrolPassword || busy) return;
            void run(async () => {
              await addPasskey(walletName, enrolPassword);
              setEnrolPassword('');
            });
          }}
        >
          <p className="text-xs text-zinc-500">
            Add a passkey to unlock this wallet with your fingerprint, face or device PIN.
            Confirm your current password so it can be stored encrypted.
          </p>
          <TextField
            label="Wallet password"
            type="password"
            value={enrolPassword}
            onChange={setEnrolPassword}
          />
          <Button type="submit" className="w-full" disabled={!enrolPassword || busy}>
            Set up passkey
          </Button>
        </form>
      )}

      {busy && <Spinner label="Waiting for your passkey…" />}
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

function RevealSeed() {
  const { walletName, passkeyWallets } = useAuthStore();
  const [password, setPassword] = useState('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // get_mnemonic always needs the password; with a passkey the user doesn't
  // know it, so the passkey supplies it instead of a text field.
  const hasPasskey = !!walletName && passkeyWallets.includes(walletName);

  const reveal = async (withPassword: string) => {
    setBusy(true);
    setError(null);
    try {
      setMnemonic(await getMnemonic(withPassword));
      setPassword('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/password|decrypt/i.test(msg) ? 'Wrong password.' : msg);
    } finally {
      setBusy(false);
    }
  };

  const revealWithPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const stored = await unlockPassword(walletName!);
      setMnemonic(await getMnemonic(stored));
    } catch (e) {
      if (!(e instanceof PasskeyCancelled)) {
        setError(e instanceof Error ? e.message : String(e));
      }
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
      className="space-y-3 border-t border-zinc-800 pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (password && !busy) void reveal(password);
      }}
    >
      <h3 className="text-sm font-medium text-zinc-300">Show seed phrase</h3>
      {hasPasskey ? (
        <>
          {busy ? (
            <Spinner label="Waiting for your passkey…" />
          ) : (
            <Button
              type="button"
              variant="danger"
              className="w-full"
              onClick={() => void revealWithPasskey()}
            >
              🔑 Reveal with passkey
            </Button>
          )}
          {error && <Alert kind="error">{error}</Alert>}
        </>
      ) : (
        <>
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
        </>
      )}
    </form>
  );
}
