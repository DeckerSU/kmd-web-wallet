import { useEffect } from 'react';
import { BrandLogo } from './components/BrandLogo';
import { Alert, Button, Card, Spinner } from './components/ui';
import AuthScreen from './features/auth/AuthScreen';
import DevConsole from './features/debug/DevConsole';
import Dashboard from './features/portfolio/Dashboard';
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
  const progress = useAuthStore((s) => s.bootProgress);
  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
  const percent =
    progress?.total != null
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-8">
      <BrandLogo size={56} glow />
      {progress ? (
        <div className="w-full max-w-xs text-center">
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
              style={{ width: `${percent ?? 100}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500">
            Downloading wallet engine… {mb(progress.loaded)}
            {progress.total != null ? ` / ${mb(progress.total)} MB (${percent}%)` : ' MB'}
          </p>
        </div>
      ) : (
        <Spinner label="Starting Komodo DeFi Framework…" />
      )}
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
