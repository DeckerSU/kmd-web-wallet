import { fromBase64, randomBytes, toBase64 } from './keywrap';

/**
 * WebAuthn wrapper, scoped to what this wallet needs: create a credential bound
 * to one wallet name, and later re-derive its PRF secret.
 *
 * The relying party here is the page itself — there is no server to verify an
 * assertion against, so the security value is *not* "proving who logged in".
 * It is that the PRF secret, and therefore the wallet password, cannot be
 * recovered from a copy of the browser profile without the authenticator.
 *
 * Credentials are deliberately non-discoverable (`residentKey: 'discouraged'`):
 * the authenticator stores nothing, so wallet names never surface in the OS
 * passkey manager. Syncing them across devices would be pointless anyway — the
 * KDF wallet lives in this browser's IndexedDB and does not travel, so a synced
 * passkey would unlock nothing on another device.
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
 * WebAuthn's own `timeout` is a hint the platform may ignore: some providers
 * (Google Password Manager on Linux, in particular) can leave the promise
 * pending forever after their dialog closes. A hard ceiling keeps a stuck
 * ceremony from freezing the UI with no way out.
 */
const CEREMONY_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PasskeyError(`${what} timed out — the passkey prompt never completed.`)),
      CEREMONY_TIMEOUT_MS,
    );
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
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
}

/**
 * Register a credential for `walletName`, asking for its PRF secret for `salt`.
 *
 * Providers differ on when they hand the secret over: some return it straight
 * from `create()`, others only from a subsequent assertion. This function does
 * **not** chain that assertion itself. Google Password Manager on Linux accepts
 * the PIN, closes its dialog, and then never resolves a `get()` issued from the
 * same call stack — the promise simply hangs. Returning `prfSecret: null` lets
 * the caller ask the user to confirm again, which starts a fresh ceremony with
 * a real user gesture behind it.
 *
 * A provider that answers `prf.enabled === false` is rejected outright: storing
 * a password we could never unwrap would be worse than having no passkey.
 */
export async function registerPasskey(
  walletName: string,
  salt: Uint8Array,
): Promise<NewCredential> {
  const userId = randomBytes(32);
  let cred: PublicKeyCredential | null;
  try {
    cred = (await withTimeout(
      navigator.credentials.create({
        publicKey: {
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
          residentKey: 'discouraged',
          requireResidentKey: false,
          userVerification: 'required',
        },
          timeout: 120_000,
          attestation: 'none',
          extensions: prfExtension(salt),
        },
      }),
      'Creating the passkey',
    )) as PublicKeyCredential | null;
  } catch (e) {
    normalize(e);
  }
  if (!cred) throw new PasskeyError('The browser returned no credential');

  const credentialId = toBase64(cred.rawId);
  const ext = cred.getClientExtensionResults() as PrfExtensionResults;

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

  return { credentialId, userId: toBase64(userId), transports, prfSecret };
}

/**
 * Re-derive the PRF secret for an existing credential. Requires user
 * verification, so this is also the "confirm it's really you" gate used before
 * revealing the seed phrase or password.
 */
export async function readPrfSecret(
  credentialId: string,
  salt: Uint8Array,
): Promise<ArrayBuffer> {
  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await withTimeout(
      navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32) as BufferSource,
          rpId: window.location.hostname,
          allowCredentials: [
            { type: 'public-key', id: fromBase64(credentialId) as BufferSource },
          ],
          userVerification: 'required',
          timeout: 120_000,
          extensions: prfExtension(salt),
        },
      }),
      'Confirming the passkey',
    )) as PublicKeyCredential | null;
  } catch (e) {
    normalize(e);
  }
  if (!assertion) throw new PasskeyError('The browser returned no assertion');

  const secret = (assertion.getClientExtensionResults() as PrfExtensionResults).prf?.results
    ?.first;
  if (!secret) {
    throw new PasskeyError(
      'The authenticator did not return a PRF secret, so the wallet password cannot be unlocked.',
    );
  }
  return secret;
}
