/**
 * A small in-memory trace of WebAuthn activity.
 *
 * Passkey failures are hard to debug remotely: the interesting parts happen in
 * a native dialog the page cannot see, and the browser reports almost nothing
 * back. This records what was asked for and what came back, so a user hitting a
 * provider-specific problem can copy a report instead of describing symptoms.
 *
 * Nothing secret is recorded — no PRF secrets, no passwords, no raw credential
 * ids beyond a short prefix used to correlate entries.
 */

export interface PasskeyLogEntry {
  t: number;
  event: string;
  data?: unknown;
}

const MAX_ENTRIES = 200;
const entries: PasskeyLogEntry[] = [];
let started = 0;

export function logPasskey(event: string, data?: unknown): void {
  started ||= Date.now();
  if (entries.length >= MAX_ENTRIES) entries.shift();
  entries.push({ t: Date.now(), event, data });
  console.debug(`[passkey] ${event}`, data ?? '');
}

export function getPasskeyLog(): PasskeyLogEntry[] {
  return [...entries];
}

export function clearPasskeyLog(): void {
  entries.length = 0;
  started = 0;
}

/** Render the trace as text, with times relative to the first entry. */
export function formatPasskeyLog(): string {
  if (!entries.length) return 'No passkey activity recorded yet.';
  const t0 = entries[0].t;
  const lines = entries.map((e) => {
    const dt = `+${((e.t - t0) / 1000).toFixed(2)}s`.padStart(9);
    const body =
      e.data === undefined
        ? ''
        : ` ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}`;
    return `${dt}  ${e.event}${body}`;
  });
  return [
    `user agent: ${navigator.userAgent}`,
    `origin: ${window.location.origin}  secureContext: ${window.isSecureContext}`,
    '',
    ...lines,
  ].join('\n');
}

/** Snapshot of what the browser says it can do, recorded once per session. */
export async function logPasskeyCapabilities(): Promise<void> {
  const out: Record<string, unknown> = {};
  try {
    out.capabilities = await (
      PublicKeyCredential as unknown as {
        getClientCapabilities?: () => Promise<Record<string, boolean>>;
      }
    ).getClientCapabilities?.();
  } catch (e) {
    out.capabilitiesError = String(e);
  }
  try {
    out.uvpaa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    out.uvpaaError = String(e);
  }
  logPasskey('capabilities', out);
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__passkeyLog = {
    get: getPasskeyLog,
    text: formatPasskeyLog,
    clear: clearPasskeyLog,
  };
}
