import { useState } from 'react';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Alert, BackLink, Button, Card, Spinner, TextField } from '../../components/ui';
import { validateWalletPassword } from '../../lib/password';
import { useAuthStore } from '../../store/auth';

type View =
  | { name: 'list' }
  | { name: 'login'; wallet: string }
  | { name: 'create-form'; mode: 'create' | 'import' }
  | {
      name: 'backup-seed';
      walletName: string;
      password: string;
      mnemonic: string;
    };

export default function AuthScreen() {
  const [view, setView] = useState<View>({ name: 'list' });
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-2xl font-black text-emerald-950 shadow-lg shadow-emerald-500/20">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">KMD Wallet</h1>
          <p className="mt-1 text-sm text-zinc-400">Komodo &amp; KomodoClassic, powered by KDF</p>
        </div>
        {view.name === 'list' && <WalletList onNavigate={setView} />}
        {view.name === 'login' && (
          <LoginForm wallet={view.wallet} onBack={() => setView({ name: 'list' })} />
        )}
        {view.name === 'create-form' && (
          <CreateForm
            mode={view.mode}
            onBack={() => setView({ name: 'list' })}
            onSeedReady={(walletName, password, mnemonic) =>
              setView({ name: 'backup-seed', walletName, password, mnemonic })
            }
          />
        )}
        {view.name === 'backup-seed' && (
          <BackupSeed
            walletName={view.walletName}
            password={view.password}
            mnemonic={view.mnemonic}
            onBack={() => setView({ name: 'create-form', mode: 'create' })}
          />
        )}
      </div>
    </div>
  );
}

function WalletList({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { wallets, error, clearError } = useAuthStore();
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
            {wallets.map((w) => (
              <li key={w}>
                <button
                  onClick={() => {
                    clearError();
                    onNavigate({ name: 'login', wallet: w });
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left transition hover:border-emerald-500/50 hover:bg-zinc-800/80"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-emerald-400">
                    {w.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{w}</span>
                  <span className="text-zinc-600">→</span>
                </button>
              </li>
            ))}
          </ul>
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
  onSeedReady,
}: {
  mode: 'create' | 'import';
  onBack: () => void;
  onSeedReady: (walletName: string, password: string, mnemonic: string) => void;
}) {
  const { wallets, create, error, phase } = useAuthStore();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [seed, setSeed] = useState('');
  const [touched, setTouched] = useState(false);
  const busy = phase === 'authenticating';

  const nameError = !touched
    ? null
    : name.trim().length === 0
      ? 'Wallet name is required'
      : wallets.includes(name.trim())
        ? 'A wallet with this name already exists'
        : null;
  const passwordError = touched ? validateWalletPassword(password) : null;
  const confirmError = touched && confirm !== password ? "Passwords don't match" : null;
  const seedValid = validateMnemonic(seed.trim().toLowerCase(), wordlist);
  const seedError =
    mode === 'import' && touched && seed.trim().split(/\s+/).length < 12
      ? 'Enter your seed phrase (12 or 24 words)'
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (
      name.trim().length === 0 ||
      wallets.includes(name.trim()) ||
      validateWalletPassword(password) ||
      confirm !== password
    ) {
      return;
    }
    if (mode === 'create') {
      onSeedReady(name.trim(), password, generateMnemonic(wordlist, 256));
    } else {
      if (seed.trim().split(/\s+/).length < 12) return;
      void create(name.trim(), password, seed.trim());
    }
  };

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
            {!seedError && seed.trim() && !seedValid && (
              <span className="mt-1 block text-xs text-amber-400">
                Not a valid BIP39 phrase — it will still be accepted (legacy/custom seed).
              </span>
            )}
          </label>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        {busy ? (
          <Spinner label="Creating wallet…" />
        ) : (
          <Button type="submit" className="w-full">
            {mode === 'create' ? 'Continue' : 'Import wallet'}
          </Button>
        )}
      </form>
    </Card>
  );
}

function BackupSeed({
  walletName,
  password,
  mnemonic,
  onBack,
}: {
  walletName: string;
  password: string;
  mnemonic: string;
  onBack: () => void;
}) {
  const { create, error, phase } = useAuthStore();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = phase === 'authenticating';
  const words = mnemonic.split(' ');

  return (
    <Card>
      <BackLink onClick={onBack}>Back</BackLink>
      <h2 className="mb-1 text-lg font-semibold">Back up your seed phrase</h2>
      <p className="mb-4 text-sm text-zinc-400">
        These 24 words are the only way to recover <b>{walletName}</b>. Write them down and
        store them offline.
      </p>
      <ol className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:grid-cols-3">
        {words.map((w, i) => (
          <li key={i} className="font-mono text-sm">
            <span className="mr-1.5 inline-block w-5 text-right text-zinc-600">{i + 1}.</span>
            <span className="text-zinc-100">{w}</span>
          </li>
        ))}
      </ol>
      <div className="mb-4 flex gap-2">
        <Button
          variant="ghost"
          className="flex-1"
          onClick={() => {
            void navigator.clipboard.writeText(mnemonic).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? 'Copied ✓' : 'Copy to clipboard'}
        </Button>
      </div>
      <Alert kind="warning">
        Anyone with these words can spend your funds. Never share them.
      </Alert>
      <label className="my-4 flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-emerald-500"
        />
        I have written down my seed phrase and understand it cannot be recovered if lost.
      </label>
      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      {busy ? (
        <Spinner label="Creating wallet…" />
      ) : (
        <Button
          className="w-full"
          disabled={!confirmed}
          onClick={() => void create(walletName, password, mnemonic)}
        >
          Create wallet
        </Button>
      )}
    </Card>
  );
}
