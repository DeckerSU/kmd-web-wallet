import { useEffect, useState } from 'react';
import { randomBytes } from '../../lib/keywrap';
import {
  clearPasskeyLog,
  formatPasskeyLog,
  logPasskey,
  logPasskeyCapabilities,
} from '../../lib/passkeyLog';
import { readPrfSecret, registerPasskey, type RegisterOptions } from '../../lib/webauthn';

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

/**
 * Round two. The first sweep already showed that `userVerification: 'required'`
 * is what hangs — variant 2 carried no PRF at all and still stalled — so these
 * ask the follow-up question: can PRF work with a weaker UV setting, and is the
 * platform authenticator specifically to blame?
 *
 * The timeout is short here on purpose: a hanging variant costs that much wall
 * clock, and there are several.
 */
const DIAG_TIMEOUT_MS = 25_000;

const VARIANTS: Variant[] = [
  {
    id: 'baseline',
    label: '1. No PRF, UV discouraged',
    hint: 'Known-good control. Confirms the provider still works at all.',
    opts: { withPrf: false, userVerification: 'discouraged', residentKey: 'discouraged' },
  },
  {
    id: 'uv-preferred',
    label: '2. No PRF, UV preferred',
    hint: '“Preferred” lets the provider skip verification instead of demanding it. If this works but 3 hangs, that word is the whole fix.',
    opts: { withPrf: false, userVerification: 'preferred', residentKey: 'discouraged' },
  },
  {
    id: 'uv-required',
    label: '3. No PRF, UV required',
    hint: 'The one that hung last time. Re-run to confirm it is reproducible.',
    opts: { withPrf: false, userVerification: 'required', residentKey: 'discouraged' },
  },
  {
    id: 'prf-uv-discouraged',
    label: '4. PRF, UV discouraged',
    hint: 'Does PRF come back at all without verification? hmac-secret often requires UV, so this may create a credential yet return no secret.',
    opts: { withPrf: true, userVerification: 'discouraged', residentKey: 'discouraged' },
  },
  {
    id: 'prf-uv-preferred',
    label: '5. PRF, UV preferred',
    hint: 'The likely landing spot: PRF kept, verification requested but not demanded.',
    opts: { withPrf: true, userVerification: 'preferred', residentKey: 'discouraged' },
  },
  {
    id: 'prf-resident-preferred',
    label: '6. PRF, UV preferred, discoverable',
    hint: 'Google Password Manager prefers discoverable credentials; this pairs that with the softer UV.',
    opts: { withPrf: true, userVerification: 'preferred', residentKey: 'required' },
  },
  {
    id: 'platform-pinned',
    label: '8. PRF, UV required, pinned to this device',
    hint: 'Never tested before. Pinning authenticatorAttachment: "platform" is the closest thing to picking the local manager by hand in the browser dialog — which is the step that made it work.',
    opts: {
      withPrf: true,
      userVerification: 'required',
      residentKey: 'discouraged',
      attachment: 'platform',
    },
  },
  {
    id: 'platform-hint',
    label: '9. PRF, UV required, hint: client-device',
    hint: 'Same idea via the newer “hints” signal, which steers the chooser without constraining the authenticator.',
    opts: {
      withPrf: true,
      userVerification: 'required',
      residentKey: 'discouraged',
      hints: ['client-device'],
    },
  },
  {
    id: 'platform-resident',
    label: '10. PRF, UV required, pinned + discoverable — the shipping default',
    hint: 'What the wallet now uses. The only variant that returns a PRF secret on both Linux and Android.',
    opts: {
      withPrf: true,
      userVerification: 'required',
      residentKey: 'required',
      attachment: 'platform',
    },
  },
  {
    id: 'cross-platform',
    label: '7. PRF, UV required, security key or phone',
    hint: 'Skips the platform provider entirely. If this succeeds, the fault is Google Password Manager, not the request. Expect a QR code or a security-key prompt.',
    opts: {
      withPrf: true,
      userVerification: 'required',
      residentKey: 'discouraged',
      attachment: 'cross-platform',
    },
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
      const salt = randomBytes(32);
      const cred = await registerPasskey(`diagnostic-${v.id}`, salt, {
        ...v.opts,
        timeoutMs: DIAG_TIMEOUT_MS,
      });

      // A credential is only half the answer: what matters is whether a PRF
      // secret can actually be obtained, which for many providers only happens
      // on a later assertion. Try that too, from this same click.
      let detail: string;
      if (cred.prfSecret) {
        detail = 'created — PRF secret returned at create ✓';
      } else if (!v.opts.withPrf) {
        detail = 'created (PRF was not requested)';
      } else {
        try {
          await readPrfSecret(cred.credentialId, salt, {
            transports: cred.transports,
            attachment: cred.attachment ?? undefined,
          });
          detail = 'created — PRF secret returned on the follow-up assertion ✓';
        } catch (e) {
          detail = `created, but no PRF secret: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      setResults((r) => ({
        ...r,
        [v.id]: { state: 'ok', ms: Math.round(performance.now() - t0), detail },
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
        request every time; a hanging variant costs {DIAG_TIMEOUT_MS / 1000}s before it gives
        up. Test credentials named <code className="text-zinc-400">diagnostic-*</code> are
        created in your password manager — delete them there afterwards.
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
