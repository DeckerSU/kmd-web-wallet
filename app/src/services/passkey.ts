import { fromBase64, randomBytes, toBase64, unwrapSecret, wrapSecret } from '../lib/keywrap';
import {
  deletePasskey,
  getPasskey,
  savePasskey,
  touchPasskey,
  type PasskeyRecord,
} from '../lib/passkeyStore';
import { generateWalletPassword } from '../lib/password';
import {
  PasskeyCancelled,
  PasskeyError,
  readPrfSecret,
  registerPasskey,
} from '../lib/webauthn';

/**
 * Passkey ↔ wallet-password orchestration: the layer that knows a passkey
 * unlocks a KDF password, without knowing anything about React or KDF itself.
 */

export { PasskeyCancelled, PasskeyError };

/**
 * Create a passkey for `walletName` protecting `password`.
 *
 * Pass an existing password to attach a passkey to a wallet that already has
 * one; omit it to have a fresh password generated. Returns the password so the
 * caller can both start KDF with it and show it to the user — with a passkey
 * that display is the user's only chance to record it.
 *
 * Nothing is persisted until the wrap has been verified by unwrapping it again,
 * so a record that cannot be opened later is never written.
 */
export async function enrollPasskey(
  walletName: string,
  password?: string,
): Promise<string> {
  const walletPassword = password ?? generateWalletPassword();
  const salt = randomBytes(32);

  const cred = await registerPasskey(walletName, salt);
  const wrapped = await wrapSecret(cred.prfSecret, salt, walletName, walletPassword);

  // Round-trip check: proves the stored ciphertext is openable with the secret
  // this authenticator produces, before it becomes the only copy.
  const check = await unwrapSecret(cred.prfSecret, salt, walletName, wrapped);
  if (check !== walletPassword) {
    throw new PasskeyError('Passkey verification failed — the wallet password was not stored.');
  }

  const record: PasskeyRecord = {
    walletName,
    credentialId: cred.credentialId,
    userId: cred.userId,
    prfSalt: toBase64(salt),
    wrapped,
    transports: cred.transports,
    createdAt: Date.now(),
    lastUsedAt: null,
    version: 1,
  };
  await savePasskey(record);
  return walletPassword;
}

/**
 * Recover the wallet password via its passkey. Prompts for user verification,
 * so this doubles as the confirmation gate for revealing secrets in Settings.
 */
export async function unlockPassword(walletName: string): Promise<string> {
  const rec = await getPasskey(walletName);
  if (!rec) throw new PasskeyError(`No passkey is registered for “${walletName}”.`);

  const secret = await readPrfSecret(rec.credentialId, fromBase64(rec.prfSalt));
  let password: string;
  try {
    password = await unwrapSecret(secret, fromBase64(rec.prfSalt), walletName, rec.wrapped);
  } catch {
    // AES-GCM is authenticated, so this means the authenticator produced a
    // different secret than at enrolment — a replaced credential, or a record
    // that outlived the passkey it belongs to.
    throw new PasskeyError(
      'The passkey no longer matches this wallet. Unlock with your password instead, then re-register the passkey.',
    );
  }
  await touchPasskey(walletName);
  return password;
}

export async function removePasskey(walletName: string): Promise<void> {
  await deletePasskey(walletName);
}

export { getPasskey };
