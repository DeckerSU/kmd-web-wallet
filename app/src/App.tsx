import { useEffect } from 'react';
import { BrandLogo } from './components/BrandLogo';
import { Alert, Button, Card, Spinner } from './components/ui';
import AuthScreen from './features/auth/AuthScreen';
import DevConsole from './features/debug/DevConsole';
import Dashboard from './features/portfolio/Dashboard';
import InstallPrompt from './features/pwa/InstallPrompt';
import { BOOT_LABELS } from './kdf/bootStage';
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
      <InstallPrompt />
    </div>
  );
}

function BootScreen() {
  const stage = useAuthStore((s) => s.bootStage);
  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

  if (!stage) return <BootFrame>{<Spinner label="Starting Komodo DeFi Framework…" />}</BootFrame>;

  const label = BOOT_LABELS[stage.phase];
  // A percentage is only shown when the total is genuinely comparable to the
  // bytes counted; for the gzipped wasm it is not, so bytes are shown instead.
  const percent =
    stage.phase === 'downloading' && stage.total != null
      ? Math.min(100, Math.round((stage.loaded / stage.total) * 100))
      : null;

  const detail =
    stage.phase === 'downloading'
      ? percent != null
        ? `${mb(stage.loaded)} / ${mb(stage.total!)} MB (${percent}%)`
        : `${mb(stage.loaded)} MB`
      : stage.phase === 'waiting-rpc' && stage.elapsedMs > 3000
        ? `${Math.round(stage.elapsedMs / 1000)}s`
        : null;

  return (
    <BootFrame>
      <div className="w-full max-w-xs text-center">
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full bg-emerald-500 transition-[width] duration-200 ${
              percent == null ? 'w-1/3 animate-pulse' : ''
            }`}
            style={percent != null ? { width: `${percent}%` } : undefined}
          />
        </div>
        <p className="text-xs text-zinc-500">
          {label}…{detail ? ` ${detail}` : ''}
        </p>
      </div>
    </BootFrame>
  );
}

function BootFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-8">
      <BrandLogo size={56} glow />
      {children}
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
