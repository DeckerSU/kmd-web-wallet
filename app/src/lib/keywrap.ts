/**
 * Wrapping the KDF wallet password under a key that only the authenticator can
 * reproduce.
 *
 * The WebAuthn PRF extension hands back a stable 32-byte secret for a given
 * (credential, salt) pair. That secret never leaves the authenticator's control
 * in any reusable form — it is recomputed on every assertion — so the ciphertext
 * stored in IndexedDB is inert without the authenticator present.
 *
 * The PRF output is used as HKDF input keying material rather than as an AES key
 * directly: HKDF gives domain separation, so a future second use of the same
 * credential (a different `info`) cannot collide with this one.
 */

const HKDF_INFO_PREFIX = 'kmd-wallet:passkey:v1:';

export interface WrappedSecret {
  /** base64 AES-GCM nonce, 12 bytes. */
  iv: string;
  /** base64 ciphertext with the appended GCM tag. */
  ct: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * Derive the AES-GCM key from the PRF secret. `walletName` is bound into the
 * HKDF info so a record copied onto another wallet's row cannot be unwrapped.
 */
async function deriveKey(
  prfSecret: ArrayBuffer,
  salt: Uint8Array,
  walletName: string,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', prfSecret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: enc.encode(HKDF_INFO_PREFIX + walletName),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapSecret(
  prfSecret: ArrayBuffer,
  salt: Uint8Array,
  walletName: string,
  plaintext: string,
): Promise<WrappedSecret> {
  const key = await deriveKey(prfSecret, salt, walletName);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(plaintext),
  );
  return { iv: toBase64(iv), ct: toBase64(ct) };
}

/**
 * Reverse of {@link wrapSecret}. Throws when the PRF secret is not the one used
 * to wrap — AES-GCM authenticates, so a wrong key fails loudly rather than
 * yielding garbage.
 */
export async function unwrapSecret(
  prfSecret: ArrayBuffer,
  salt: Uint8Array,
  walletName: string,
  wrapped: WrappedSecret,
): Promise<string> {
  const key = await deriveKey(prfSecret, salt, walletName);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrapped.iv) as BufferSource },
    key,
    fromBase64(wrapped.ct) as BufferSource,
  );
  return dec.decode(plain);
}
