import { useState } from 'react';
import { BrandLogo } from '../../components/BrandLogo';
import { Alert, BackLink, Button, Card, Spinner, TextField } from '../../components/ui';
import { APP_VERSION } from '../../config/constants';
import { validateWalletPassword } from '../../lib/password';
import { useAuthStore } from '../../store/auth';

type View =
  | { name: 'list' }
  | { name: 'login'; wallet: string }
  | { name: 'create-form'; mode: 'create' | 'import' };

export default function AuthScreen() {
  const [view, setView] = useState<View>({ name: 'list' });
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandLogo size={88} glow className="mx-auto mb-4" />
          <h1 className="text-2xl font-semibold tracking-tight">KMD Wallet</h1>
          <p className="mt-1 text-sm text-zinc-400">Decker&apos;s Komodo Wallet, powered by KDF</p>
          <p className="mt-1 font-mono text-xs text-zinc-600">v{APP_VERSION}</p>
        </div>
        {view.name === 'list' && <WalletList onNavigate={setView} />}
        {view.name === 'login' && (
          <LoginForm wallet={view.wallet} onBack={() => setView({ name: 'list' })} />
        )}
        {view.name === 'create-form' && (
          <CreateForm mode={view.mode} onBack={() => setView({ name: 'list' })} />
        )}
      </div>
    </div>
  );
}

function WalletList({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { wallets, error, clearError, passkeyWallets, loginWithPasskey, phase } =
    useAuthStore();
  const busy = phase === 'authenticating';

  return (
    <Card>
      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      {wallets.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Your wallets</h2>
          <ul className="mb-5 space-y-2">
            {wallets.map((w) => {
              const hasPasskey = passkeyWallets.includes(w);
              return (
                <li key={w}>
                  <button
                    disabled={busy}
                    onClick={() => {
                      clearError();
                      // A registered passkey is the fast path; the password
                      // form stays one tap away for when it fails.
                      if (hasPasskey) void loginWithPasskey(w);
                      else onNavigate({ name: 'login', wallet: w });
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left transition hover:border-emerald-500/50 hover:bg-zinc-800/80 disabled:opacity-50"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-emerald-400">
                      {w.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium">{w}</span>
                    {hasPasskey && (
                      <span
                        title="Unlock with passkey"
                        aria-label={`${w} has a passkey`}
                        className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
                      >
                        🔑 PASSKEY
                      </span>
                    )}
                    <span className="text-zinc-600">→</span>
                  </button>
                  {hasPasskey && (
                    <button
                      onClick={() => {
                        clearError();
                        onNavigate({ name: 'login', wallet: w });
                      }}
                      className="mt-1 pl-1 text-xs text-zinc-500 transition hover:text-emerald-400"
                    >
                      Use password instead
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {busy && <Spinner label="Unlocking…" />}
        </>
      )}
      <div className="space-y-2">
        <Button
          className="w-full"
          onClick={() => {
            clearError();
            onNavigate({ name: 'create-form', mode: 'create' });
          }}
        >
          Create new wallet
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => {
            clearError();
            onNavigate({ name: 'create-form', mode: 'import' });
          }}
        >
          Import seed phrase
        </Button>
      </div>
    </Card>
  );
}

function LoginForm({ wallet, onBack }: { wallet: string; onBack: () => void }) {
  const { login, error, phase } = useAuthStore();
  const [password, setPassword] = useState('');
  const busy = phase === 'authenticating';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!busy && password) void login(wallet, password);
  };

  return (
    <Card>
      <BackLink onClick={onBack}>All wallets</BackLink>
      <h2 className="mb-4 text-lg font-semibold">
        Unlock <span className="text-emerald-400">{wallet}</span>
      </h2>
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoFocus
        />
        {error && <Alert kind="error">{error}</Alert>}
        {busy ? (
          <Spinner label="Starting wallet…" />
        ) : (
          <Button type="submit" className="w-full" disabled={!password}>
            Unlock
          </Button>
        )}
      </form>
    </Card>
  );
}

function CreateForm({
  mode,
  onBack,
}: {
  mode: 'create' | 'import';
  onBack: () => void;
}) {
  const {
    wallets,
    create,
    createWithPasskey,
    error,
    phase,
    passkeySupported,
    pendingPasskey,
    confirmPendingPasskey,
    cancelPendingPasskey,
  } = useAuthStore();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [seed, setSeed] = useState('');
  const [touched, setTouched] = useState(false);
  const [usePasskey, setUsePasskey] = useState(passkeySupported);
  const busy = phase === 'authenticating';

  // With a passkey the password is generated, so the password fields — and
  // their validation — drop out of the form entirely.
  const withPasskey = passkeySupported && usePasskey;

  const nameError = !touched
    ? null
    : name.trim().length === 0
      ? 'Wallet name is required'
      : wallets.includes(name.trim())
        ? 'A wallet with this name already exists'
        : null;
  const passwordError = touched && !withPasskey ? validateWalletPassword(password) : null;
  const confirmError =
    touched && !withPasskey && confirm !== password ? "Passwords don't match" : null;
  const seedError =
    mode === 'import' && touched && seed.trim().split(/\s+/).length < 12
      ? 'Enter your seed phrase (12 or 24 words)'
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim().length === 0 || wallets.includes(name.trim())) return;
    if (!withPasskey && (validateWalletPassword(password) || confirm !== password)) return;

    const mnemonic = mode === 'import' ? seed.trim() : undefined;
    if (mode === 'import' && (mnemonic?.split(/\s+/).length ?? 0) < 12) return;

    // No mnemonic passed on create — KDF generates and stores a fresh one.
    if (withPasskey) void createWithPasskey(name.trim(), mnemonic);
    else void create(name.trim(), password, mnemonic);
  };

  // Some passkey providers — Google Password Manager on Linux among them —
  // create the credential but hand over the PRF secret only on a later
  // assertion, and hang if that assertion is chained automatically. So it gets
  // its own button: the click supplies the user gesture the provider wants.
  if (pendingPasskey) {
    return (
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Confirm your passkey</h2>
        <div className="space-y-4">
          <Alert kind="info">
            Your passkey was created. Confirm it once more to finish protecting{' '}
            <span className="font-medium text-zinc-200">
              {pendingPasskey.pending.walletName}
            </span>
            .
          </Alert>
          {error && <Alert kind="error">{error}</Alert>}
          {busy ? (
            <Spinner label="Waiting for your passkey…" />
          ) : (
            <>
              <Button className="w-full" onClick={() => void confirmPendingPasskey()}>
                🔑 Confirm passkey
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  cancelPendingPasskey();
                  onBack();
                }}
              >
                Cancel
              </Button>
              <p className="text-center text-xs text-zinc-600">
                Cancelling leaves an unused passkey in your password manager, which you can
                delete there.
              </p>
            </>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <BackLink onClick={onBack}>All wallets</BackLink>
      <h2 className="mb-4 text-lg font-semibold">
        {mode === 'create' ? 'Create new wallet' : 'Import seed phrase'}
      </h2>
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label="Wallet name"
          value={name}
          onChange={setName}
          autoFocus
          error={nameError}
        />
        {passkeySupported && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <input
              type="checkbox"
              checked={usePasskey}
              onChange={(e) => setUsePasskey(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
            />
            <span className="text-sm">
              <span className="font-medium text-zinc-200">Protect with a passkey</span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Unlock with your fingerprint, face or device PIN. A strong password is
                generated for you — you&apos;ll see it once it&apos;s ready, and any time in
                Settings.
              </span>
            </span>
          </label>
        )}
        {!withPasskey && (
          <>
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              error={passwordError}
              hint="Min 8 chars, with digit, upper/lowercase and special character"
            />
            <TextField
              label="Confirm password"
              type="password"
              value={confirm}
              onChange={setConfirm}
              error={confirmError}
            />
          </>
        )}
        {mode === 'import' && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-300">Seed phrase</span>
            <textarea
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              rows={3}
              className={`w-full rounded-xl border bg-zinc-900 px-4 py-2.5 font-mono text-sm text-zinc-100 outline-none transition focus:border-emerald-500 ${seedError ? 'border-red-500/70' : 'border-zinc-700'}`}
              placeholder="word1 word2 word3 …"
            />
            {seedError && <span className="mt-1 block text-xs text-red-400">{seedError}</span>}
          </label>
        )}
        {mode === 'create' && (
          <Alert kind="info">
            A new seed phrase will be generated securely on your device. Once your wallet is
            ready, back it up from Settings → Show seed phrase.
          </Alert>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        {busy ? (
          <Spinner label={withPasskey ? 'Waiting for your passkey…' : 'Creating wallet…'} />
        ) : (
          <Button type="submit" className="w-full">
            {mode === 'create' ? 'Create wallet' : 'Import wallet'}
          </Button>
        )}
      </form>
    </Card>
  );
}
