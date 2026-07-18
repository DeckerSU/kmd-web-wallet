import { useCallback, useEffect, useRef, useState } from 'react';
import { generateRpcPassword, kdf } from '../../kdf/client';
import { buildStartupConf } from '../../kdf/conf';
import { MainStatus, startupResultName } from '../../kdf/types';

/**
 * Developer console (open with ?debug in the URL): raw KDF lifecycle controls
 * and log view. Originally the Phase 0 smoke-test screen.
 */

interface LogEntry {
  ts: string;
  source: 'app' | 'kdf';
  line: string;
}

const STATUS_LABELS: Record<MainStatus, { label: string; cls: string }> = {
  [MainStatus.NotRunning]: { label: 'Not running', cls: 'bg-zinc-700 text-zinc-300' },
  [MainStatus.NoContext]: { label: 'Starting (no context)', cls: 'bg-amber-600 text-white' },
  [MainStatus.NoRpc]: { label: 'Starting (no RPC)', cls: 'bg-amber-600 text-white' },
  [MainStatus.RpcIsUp]: { label: 'RPC is up', cls: 'bg-emerald-600 text-white' },
};

export default function DevConsole() {
  const [status, setStatus] = useState<MainStatus>(MainStatus.NotRunning);
  const [wasmLoaded, setWasmLoaded] = useState(kdf.isLoaded);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const log = useCallback((source: LogEntry['source'], line: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-499), { ts, source, line }]);
  }, []);

  useEffect(() => {
    kdf.onLog((_level, line) => log('kdf', line));
    const timer = setInterval(() => setStatus(kdf.status()), 1000);
    return () => clearInterval(timer);
  }, [log]);

  useEffect(() => {
    logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight });
  }, [logs]);

  const run = useCallback(
    (name: string, fn: () => Promise<void>) => {
      void (async () => {
        setBusy(true);
        try {
          await fn();
        } catch (e) {
          log('app', `${name} failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setStatus(kdf.status());
          setBusy(false);
        }
      })();
    },
    [log],
  );

  const loadWasm = () =>
    run('load', async () => {
      log('app', 'Loading kdflib.js + kdflib_bg.wasm…');
      const t0 = performance.now();
      await kdf.load();
      setWasmLoaded(true);
      log('app', `WASM loaded in ${Math.round(performance.now() - t0)} ms`);
    });

  const startKdf = () =>
    run('start', async () => {
      log('app', 'Starting KDF with test wallet "phase0-test"…');
      const conf = buildStartupConf(
        {
          walletName: 'phase0-test',
          walletPassword: 'Phase0-Test!2026',
          allowRegistrations: true,
        },
        generateRpcPassword(),
      );
      const outcome = await kdf.start(conf);
      setWasmLoaded(true);
      log(
        'app',
        `mm2_main result: ${startupResultName(outcome.code)}${outcome.message ? ` — ${outcome.message}` : ''}`,
      );
    });

  const getVersion = () =>
    run('version', async () => {
      const res = await kdf.rpc<{ result: string }>({ method: 'version' });
      log('app', `KDF version: ${res.result}`);
    });

  const stopKdf = () =>
    run('stop', async () => {
      log('app', 'Stopping KDF…');
      await kdf.stop();
      log('app', 'KDF stopped');
    });

  const statusInfo = STATUS_LABELS[status];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">KMD Wallet — dev console</h1>
            <p className="text-sm text-zinc-400">Raw KDF controls (?debug)</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusInfo.cls}`}>
            {statusInfo.label}
          </span>
        </header>

        <div className="mb-6 flex flex-wrap gap-3">
          <DevButton onClick={loadWasm} disabled={busy || wasmLoaded}>
            1. Load WASM
          </DevButton>
          <DevButton onClick={startKdf} disabled={busy || status === MainStatus.RpcIsUp}>
            2. Start KDF (test wallet)
          </DevButton>
          <DevButton onClick={getVersion} disabled={busy || status !== MainStatus.RpcIsUp}>
            3. version RPC
          </DevButton>
          <DevButton onClick={stopKdf} disabled={busy || status === MainStatus.NotRunning}>
            4. Stop
          </DevButton>
        </div>

        <div
          ref={logBoxRef}
          className="h-[28rem] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4 font-mono text-xs leading-relaxed"
        >
          {logs.length === 0 && (
            <p className="text-zinc-500">Logs will appear here. Start with “Load WASM”.</p>
          )}
          {logs.map((entry, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              <span className="text-zinc-600">{entry.ts} </span>
              <span className={entry.source === 'app' ? 'text-sky-400' : 'text-zinc-400'}>
                [{entry.source}]{' '}
              </span>
              <span className="text-zinc-200">{entry.line}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DevButton(props: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
    >
      {props.children}
    </button>
  );
}
