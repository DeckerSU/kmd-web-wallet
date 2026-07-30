import { useEffect, useState } from 'react';
import { randomBytes } from '../../lib/keywrap';
import {
  clearPasskeyLog,
  formatPasskeyLog,
  logPasskey,
  logPasskeyCapabilities,
} from '../../lib/passkeyLog';
import { registerPasskey, type RegisterOptions } from '../../lib/webauthn';

/**
 * Bisects which WebAuthn option a passkey provider chokes on.
 *
 * Providers fail opaquely — the dialog spins and the promise never settles —
 * and the page cannot see inside it. Each variant below changes exactly one
 * thing from what the wallet normally asks for, so running them in order says
 * which knob is responsible. Each needs its own user gesture and its own PIN
 * entry, so they are separate buttons rather than one automated sweep.
 */

interface Variant {
  id: string;
  label: string;
  hint: string;
  opts: RegisterOptions;
}

const VARIANTS: Variant[] = [
  {
    id: 'baseline',
    label: '1. Plain credential (no PRF, no UV)',
    hint: 'Does this provider create a credential at all? If this hangs, nothing else matters.',
    opts: { withPrf: false, userVerification: 'discouraged', residentKey: 'discouraged' },
  },
  {
    id: 'uv',
    label: '2. + user verification required',
    hint: 'Adds the PIN/biometric step. Isolates UV as the cause.',
    opts: { withPrf: false, userVerification: 'required', residentKey: 'discouraged' },
  },
  {
    id: 'prf',
    label: '3. + PRF extension (what the wallet uses)',
    hint: 'The current settings. If 2 works and this hangs, PRF is the problem.',
    opts: { withPrf: true, userVerification: 'required', residentKey: 'discouraged' },
  },
  {
    id: 'resident',
    label: '4. PRF + discoverable credential',
    hint: 'Some providers only handle discoverable credentials properly.',
    opts: { withPrf: true, userVerification: 'required', residentKey: 'required' },
  },
];

type Outcome = { state: 'ok' | 'fail'; detail: string; ms: number };

export default function PasskeyDiagnostics() {
  const [results, setResults] = useState<Record<string, Outcome>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void logPasskeyCapabilities().then(() => setReport(formatPasskeyLog()));
  }, []);

  const run = async (v: Variant) => {
    setRunning(v.id);
    const t0 = performance.now();
    try {
      logPasskey(`diagnostic ${v.id}: begin`, v.opts);
      const cred = await registerPasskey(`diagnostic-${v.id}`, randomBytes(32), v.opts);
      const ms = Math.round(performance.now() - t0);
      setResults((r) => ({
        ...r,
        [v.id]: {
          state: 'ok',
          ms,
          detail: cred.prfSecret
            ? 'created, PRF secret returned at create'
            : 'created, but no PRF secret at create',
        },
      }));
    } catch (e) {
      setResults((r) => ({
        ...r,
        [v.id]: {
          state: 'fail',
          ms: Math.round(performance.now() - t0),
          detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        },
      }));
    } finally {
      setRunning(null);
      setReport(formatPasskeyLog());
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="mb-1 text-sm font-semibold text-zinc-200">Passkey diagnostics</h2>
      <p className="mb-4 text-xs text-zinc-500">
        Run these in order. Each opens a real passkey prompt, so expect a PIN or biometric
        request every time. A test credential is created in your password manager — delete
        them there afterwards.
      </p>

      <div className="space-y-2">
        {VARIANTS.map((v) => {
          const r = results[v.id];
          return (
            <div key={v.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{v.label}</p>
                  <p className="mt-0.5 text-xs text-zinc-600">{v.hint}</p>
                </div>
                <button
                  onClick={() => void run(v)}
                  disabled={running !== null}
                  className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-emerald-500/60 disabled:opacity-40"
                >
                  {running === v.id ? 'Running…' : 'Run'}
                </button>
              </div>
              {r && (
                <p
                  className={`mt-2 break-all font-mono text-xs ${r.state === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {r.state === 'ok' ? '✓' : '✕'} {r.detail} ({(r.ms / 1000).toFixed(1)}s)
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(formatPasskeyLog()).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-emerald-500/60"
        >
          {copied ? 'Copied ✓' : 'Copy full report'}
        </button>
        <button
          onClick={() => {
            clearPasskeyLog();
            setResults({});
            setReport('');
          }}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-500"
        >
          Clear
        </button>
      </div>

      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-800 bg-black p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
        {report || 'No passkey activity recorded yet.'}
      </pre>
    </section>
  );
}
