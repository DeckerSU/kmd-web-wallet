import { useEffect } from 'react';
import { Alert, Button, Card, Spinner } from './components/ui';
import AuthScreen from './features/auth/AuthScreen';
import DevConsole from './features/debug/DevConsole';
import { useAuthStore } from './store/auth';

export default function App() {
  const { phase, boot } = useAuthStore();
  const isDebug = new URLSearchParams(window.location.search).has('debug');

  useEffect(() => {
    if (!isDebug) void boot();
  }, [boot, isDebug]);

  if (isDebug) return <DevConsole />;

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-100">
      {phase === 'boot' && <BootScreen />}
      {phase === 'boot-error' && <BootError />}
      {(phase === 'ready' || phase === 'authenticating') && <AuthScreen />}
      {phase === 'authenticated' && <Dashboard />}
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-2xl font-black text-emerald-950 shadow-lg shadow-emerald-500/20">
        K
      </div>
      <Spinner label="Loading Komodo DeFi Framework…" />
    </div>
  );
}

function BootError() {
  const { error, boot } = useAuthStore();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md space-y-4">
        <h2 className="text-lg font-semibold">Failed to start</h2>
        <Alert kind="error">{error}</Alert>
        <Button className="w-full" onClick={() => void boot()}>
          Retry
        </Button>
      </Card>
    </div>
  );
}

/** Placeholder — becomes the portfolio screen in Phase 2. */
function Dashboard() {
  const { walletName, logout } = useAuthStore();
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {walletName}
          </h1>
          <p className="text-sm text-zinc-400">Wallet unlocked</p>
        </div>
        <Button variant="ghost" onClick={() => void logout()}>
          Log out
        </Button>
      </header>
      <Card>
        <p className="text-sm text-zinc-400">
          Phase 2 will show KMD / KMDCL balances here.
        </p>
      </Card>
    </div>
  );
}
