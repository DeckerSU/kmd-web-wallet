import { fromBase64, randomBytes, toBase64 } from './keywrap';
import { logPasskey } from './passkeyLog';

/**
 * WebAuthn wrapper, scoped to what this wallet needs: create a credential bound
 * to one wallet name, and later re-derive its PRF secret.
 *
 * The relying party here is the page itself — there is no server to verify an
 * assertion against, so the security value is *not* "proving who logged in".
 * It is that the PRF secret, and therefore the wallet password, cannot be
 * recovered from a copy of the browser profile without the authenticator.
 *
 * Credentials are discoverable (`residentKey: 'required'`), which is not what we
 * would pick on privacy grounds — a discoverable credential means the
 * authenticator stores the wallet name, so it shows up in the OS passkey
 * manager. It is required for correctness: on Android, Google Password Manager
 * returns no PRF secret at all for a non-discoverable credential. It creates one
 * happily and then reports `prf` absent, which would leave a passkey that can
 * never unlock anything. Discoverable works on every platform measured.
 *
 * A side effect is that these credentials sync through the passkey provider,
 * while the KDF wallet stays in this browser's IndexedDB. A passkey surfacing on
 * another device therefore unlocks nothing there — harmless, because login only
 * ever replays a credential id from the local record, never enumerates.
 */

/** Thrown when the user dismissed the OS prompt — not an error worth shouting about. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('Passkey prompt was dismissed');
    this.name = 'PasskeyCancelled';
  }
}

export class PasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyError';
  }
}

/** A user-dismissed prompt and a missing credential both surface as NotAllowedError. */
function normalize(e: unknown): never {
  if (e instanceof DOMException && e.name === 'NotAllowedError') throw new PasskeyCancelled();
  throw new PasskeyError(e instanceof Error ? e.message : String(e));
}

/**
 * WebAuthn's own `timeout` is a hint the platform may ignore, and at least one
 * provider ignores it completely: Google Password Manager on Linux leaves the
 * promise pending indefinitely for any request that asks for user verification
 * or the PRF extension — measured, not guessed. A hard ceiling turns that into
 * a recoverable error instead of a frozen screen.
 *
 * Roaming authenticators get longer: pairing a phone over hybrid means scanning
 * a QR code, which legitimately takes a while.
 */
const CEREMONY_TIMEOUT_MS = 60_000;
const ROAMING_TIMEOUT_MS = 150_000;

/**
 * Run one ceremony with tracing and a real cancellation path.
 *
 * The abort matters as much as the timeout: rejecting our own promise would
 * leave the provider's dialog on screen still spinning, because the ceremony
 * itself keeps running. Aborting the request tears that dialog down too.
 */
async function runCeremony<T>(
  what: string,
  options: CredentialRequestOptions | CredentialCreationOptions,
  invoke: (opts: never) => Promise<T>,
  describe: Record<string, unknown>,
  timeoutMs: number = CEREMONY_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  logPasskey(`${what}: start`, describe);
  const t0 = performance.now();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    logPasskey(`${what}: timeout, aborting`, { afterMs: Math.round(performance.now() - t0) });
    controller.abort();
  }, timeoutMs);

  try {
    const result = await invoke({ ...options, signal: controller.signal } as never);
    logPasskey(`${what}: resolved`, { afterMs: Math.round(performance.now() - t0) });
    return result;
  } catch (e) {
    const took = Math.round(performance.now() - t0);
    const name = e instanceof DOMException ? e.name : (e as Error)?.name;
    logPasskey(`${what}: rejected`, { afterMs: took, name, message: String(e) });
    if (timedOut) {
      throw new PasskeyError(
        `${what} timed out after ${Math.round(timeoutMs / 1000)}s — the passkey prompt never completed.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/**
 * Whether a local authenticator capable of user verification is present. Used
 * to decide which authenticator to aim registration at.
 */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Whether the browser advertises the PRF extension. This is a browser-level
 * capability check; whether the *authenticator* the user picks actually honours
 * PRF is only known after a ceremony, which is why registration verifies the
 * secret really came back before storing anything.
 */
export async function isPrfLikelyAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    const caps = await (
      PublicKeyCredential as unknown as {
        getClientCapabilities?: () => Promise<Record<string, boolean>>;
      }
    ).getClientCapabilities?.();
    // Older browsers have no capability API; assume PRF may work and let the
    // ceremony be the judge.
    if (!caps) return true;
    return caps['extension:prf'] === true;
  } catch {
    return true;
  }
}

interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

const prfExtension = (salt: Uint8Array) => ({
  prf: { eval: { first: salt as BufferSource } },
});

export interface NewCredential {
  credentialId: string;
  userId: string;
  transports: string[];
  /**
   * Null when the provider created the credential but withheld the PRF secret.
   * The caller must then run {@link readPrfSecret} from a *separate, user-
   * initiated* action rather than chaining it automatically — see below.
   */
  prfSecret: ArrayBuffer | null;
  /**
   * What the credential was *actually* created on, which is not necessarily
   * what was asked for: the browser's own dialog lets the user pick "save it
   * another way" and send it to a phone. Recording the answer is what lets
   * login aim at the right authenticator later.
   */
  attachment: AuthenticatorAttachment | null;
}

/**
 * Register a credential for `walletName`, asking for its PRF secret for `salt`.
 *
 * Providers differ on when they hand the secret over: some return it straight
 * from `create()`, others only from a subsequent assertion. This function does
 * **not** chain that assertion itself — returning `prfSecret: null` lets the
 * caller ask the user to confirm again, so the second ceremony runs behind a
 * real user gesture rather than from the same call stack.
 *
 * Callers should always pass an `attachment`. Leaving `authenticatorAttachment`
 * unset makes Chrome open its generic create dialog, and on Linux that route to
 * Google Password Manager never resolves — while naming 'platform' reaches the
 * identical provider in about four seconds. `hints` alone does not substitute;
 * only the attachment does.
 *
 * A provider that answers `prf.enabled === false` is rejected outright: storing
 * a password we could never unwrap would be worse than having no passkey.
 */
export interface RegisterOptions {
  residentKey?: ResidentKeyRequirement;
  userVerification?: UserVerificationRequirement;
  /** Off only for diagnostics — a credential without PRF is useless to us. */
  withPrf?: boolean;
  /** Diagnostics: force a roaming authenticator to bypass the platform one. */
  attachment?: AuthenticatorAttachment;
  /** Diagnostics: shorten the ceiling so a sweep of hanging variants is bearable. */
  timeoutMs?: number;
  /**
   * `hints` steers which chooser the browser opens before any authenticator is
   * involved. Worth varying, because the same provider reached by a different
   * route can behave differently.
   */
  hints?: string[];
}

export async function registerPasskey(
  walletName: string,
  salt: Uint8Array,
  opts: RegisterOptions = {},
): Promise<NewCredential> {
  // Discoverable by necessity, not preference — see the note at the top.
  const residentKey = opts.residentKey ?? 'required';
  const userVerification = opts.userVerification ?? 'required';
  const withPrf = opts.withPrf ?? true;
  const attachment = opts.attachment;

  const userId = randomBytes(32);
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: randomBytes(32) as BufferSource,
    rp: { name: 'KMD Wallet', id: window.location.hostname },
    user: {
      id: userId as BufferSource,
      // Not persisted by the authenticator for non-discoverable credentials,
      // so the wallet name does not leak into the OS passkey manager.
      name: walletName,
      displayName: walletName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      residentKey,
      requireResidentKey: residentKey === 'required',
      userVerification,
      ...(attachment ? { authenticatorAttachment: attachment } : {}),
    },
    timeout: 120_000,
    attestation: 'none',
    ...(withPrf ? { extensions: prfExtension(salt) } : {}),
    ...(opts.hints ? ({ hints: opts.hints } as object) : {}),
  };

  let cred: PublicKeyCredential | null;
  try {
    cred = (await runCeremony(
      'create',
      { publicKey },
      (o) => navigator.credentials.create(o),
      {
        rpId: publicKey.rp.id,
        residentKey,
        userVerification,
        withPrf,
        attachment: attachment ?? null,
        hints: opts.hints ?? null,
      },
      opts.timeoutMs ??
        (attachment === 'cross-platform' ? ROAMING_TIMEOUT_MS : CEREMONY_TIMEOUT_MS),
    )) as PublicKeyCredential | null;
  } catch (e) {
    normalize(e);
  }
  if (!cred) throw new PasskeyError('The browser returned no credential');

  const credentialId = toBase64(cred.rawId);
  const ext = cred.getClientExtensionResults() as PrfExtensionResults;
  logPasskey('create: extension results', {
    credentialIdPrefix: credentialId.slice(0, 10),
    hasPrfKey: 'prf' in (ext as object),
    prfEnabled: ext.prf?.enabled,
    prfSecretReturned: !!ext.prf?.results?.first,
    authenticatorAttachment: cred.authenticatorAttachment,
  });

  if (!ext.prf?.results?.first && ext.prf?.enabled === false) {
    throw new PasskeyError(
      'This passkey provider does not support the PRF extension, which is required to protect the wallet password.',
    );
  }
  // `undefined` here (no prf key at all) means "unknown, ask again" — not a
  // refusal. Resolving it is the caller's job, from a fresh user action.
  const prfSecret = ext.prf?.results?.first ?? null;

  const transports =
    typeof (cred.response as AuthenticatorAttestationResponse).getTransports === 'function'
      ? (cred.response as AuthenticatorAttestationResponse).getTransports()
      : [];

  return {
    credentialId,
    userId: toBase64(userId),
    transports,
    prfSecret,
    // Typed as a plain string by the DOM lib; narrow to the two legal values.
    attachment:
      cred.authenticatorAttachment === 'platform' ||
      cred.authenticatorAttachment === 'cross-platform'
        ? cred.authenticatorAttachment
        : (attachment ?? null),
  };
}

/**
 * Re-derive the PRF secret for an existing credential. Requires user
 * verification, so this is also the "confirm it's really you" gate used before
 * revealing the seed phrase or password.
 */
export interface AssertOptions {
  /**
   * Transports recorded at registration. Without them the browser has no idea
   * where the credential lives and starts with the platform provider — which on
   * some systems simply stalls, even when the credential is really on a phone.
   */
  transports?: string[];
  /** Where the credential was created, used as a routing hint when transports are missing. */
  attachment?: AuthenticatorAttachment;
}

export async function readPrfSecret(
  credentialId: string,
  salt: Uint8Array,
  opts: AssertOptions = {},
): Promise<ArrayBuffer> {
  const transports = opts.transports?.length
    ? (opts.transports as AuthenticatorTransport[])
    : undefined;

  // `hints` is the coarser, newer signal; it covers providers that returned no
  // transports at all, which is common enough to be worth the belt and braces.
  const hints =
    opts.attachment === 'cross-platform'
      ? ['hybrid', 'security-key']
      : opts.attachment === 'platform'
        ? ['client-device']
        : undefined;

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: randomBytes(32) as BufferSource,
    rpId: window.location.hostname,
    allowCredentials: [
      {
        type: 'public-key',
        id: fromBase64(credentialId) as BufferSource,
        ...(transports ? { transports } : {}),
      },
    ],
    userVerification: 'required',
    timeout: 120_000,
    extensions: prfExtension(salt),
    ...(hints ? ({ hints } as object) : {}),
  };

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await runCeremony(
      'get',
      { publicKey },
      (o) => navigator.credentials.get(o),
      {
        rpId: publicKey.rpId,
        credentialIdPrefix: credentialId.slice(0, 10),
        transports: transports ?? null,
        hints: hints ?? null,
        userActivation: navigator.userActivation?.isActive ?? null,
      },
      opts.attachment === 'cross-platform' ? ROAMING_TIMEOUT_MS : CEREMONY_TIMEOUT_MS,
    )) as PublicKeyCredential | null;
  } catch (e) {
    normalize(e);
  }
  if (!assertion) throw new PasskeyError('The browser returned no assertion');

  const ext = assertion.getClientExtensionResults() as PrfExtensionResults;
  logPasskey('get: extension results', {
    hasPrfKey: 'prf' in (ext as object),
    prfSecretReturned: !!ext.prf?.results?.first,
  });
  const secret = ext.prf?.results?.first;
  if (!secret) {
    throw new PasskeyError(
      'The authenticator did not return a PRF secret, so the wallet password cannot be unlocked.',
    );
  }
  return secret;
}
