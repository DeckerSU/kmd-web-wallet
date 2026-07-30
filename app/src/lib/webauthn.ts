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
  prfSecret: ArrayBuffer;
}

/**
 * Register a credential for `walletName` and obtain its PRF secret for `salt`.
 *
 * Chrome commonly reports `prf.enabled` at creation but withholds `results`
 * until the first assertion, so when the secret is absent we immediately run a
 * `get()` against the credential we just made. Registration fails rather than
 * falling back to something weaker if no secret can be obtained — a stored
 * record we cannot unwrap later would be worse than no passkey at all.
 */
export async function registerPasskey(
  walletName: string,
  salt: Uint8Array,
): Promise<NewCredential> {
  const userId = randomBytes(32);
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
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
    })) as PublicKeyCredential | null;
  } catch (e) {
    normalize(e);
  }
  if (!cred) throw new PasskeyError('The browser returned no credential');

  const credentialId = toBase64(cred.rawId);
  const ext = cred.getClientExtensionResults() as PrfExtensionResults;
  let prfSecret = ext.prf?.results?.first;

  if (!prfSecret) {
    if (ext.prf?.enabled === false) {
      throw new PasskeyError(
        'This authenticator does not support the PRF extension, which is required to protect the wallet password.',
      );
    }
    prfSecret = await readPrfSecret(credentialId, salt);
  }

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
    assertion = (await navigator.credentials.get({
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
    })) as PublicKeyCredential | null;
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
