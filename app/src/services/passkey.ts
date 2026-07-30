import { fromBase64, randomBytes, toBase64, unwrapSecret, wrapSecret } from '../lib/keywrap';
import {
  deletePasskey,
  getPasskey,
  loadPreferredAttachment,
  savePasskey,
  savePreferredAttachment,
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
 * A credential that exists but whose PRF secret still has to be fetched by a
 * second, user-initiated ceremony. Carries everything needed to finish.
 */
export interface PendingEnrollment {
  walletName: string;
  password: string;
  salt: Uint8Array;
  credentialId: string;
  userId: string;
  transports: string[];
  attachment?: AuthenticatorAttachment;
}

export type EnrollmentStep =
  | { done: true; password: string }
  | { done: false; pending: PendingEnrollment };

/**
 * Phase one: create the credential and, if the provider hands the PRF secret
 * over immediately, finish there and then.
 *
 * When it doesn't, this returns `done: false` instead of quietly running the
 * assertion itself. Google Password Manager on Linux takes the PIN, dismisses
 * its dialog and then leaves a chained `get()` pending forever — so the second
 * ceremony has to come from a fresh user action, which only the UI can arrange.
 *
 * Pass an existing password to attach a passkey to a wallet that already has
 * one; omit it to have a fresh password generated.
 */
export async function beginEnrollment(
  walletName: string,
  password?: string,
  attachment?: AuthenticatorAttachment,
): Promise<EnrollmentStep> {
  const walletPassword = password ?? generateWalletPassword();
  const salt = randomBytes(32);
  // An explicit choice wins; otherwise reuse whatever worked here before, and
  // fall back to letting the browser decide on a first run.
  const useAttachment = attachment ?? loadPreferredAttachment() ?? undefined;
  const cred = await registerPasskey(walletName, salt, { attachment: useAttachment });
  if (useAttachment) savePreferredAttachment(useAttachment);

  const pending: PendingEnrollment = {
    walletName,
    password: walletPassword,
    salt,
    credentialId: cred.credentialId,
    userId: cred.userId,
    transports: cred.transports,
    attachment: useAttachment,
  };

  if (!cred.prfSecret) return { done: false, pending };
  await persist(pending, cred.prfSecret);
  return { done: true, password: walletPassword };
}

/** Phase two: re-run the ceremony from a user gesture and store the result. */
export async function completeEnrollment(pending: PendingEnrollment): Promise<string> {
  const secret = await readPrfSecret(pending.credentialId, pending.salt);
  await persist(pending, secret);
  return pending.password;
}

/**
 * Wrap and store, but only after proving the ciphertext round-trips with the
 * secret this authenticator produces — a record that cannot be opened later
 * would strand the wallet.
 */
async function persist(pending: PendingEnrollment, prfSecret: ArrayBuffer): Promise<void> {
  const { walletName, salt, password } = pending;
  const wrapped = await wrapSecret(prfSecret, salt, walletName, password);
  const check = await unwrapSecret(prfSecret, salt, walletName, wrapped);
  if (check !== password) {
    throw new PasskeyError('Passkey verification failed — the wallet password was not stored.');
  }

  const record: PasskeyRecord = {
    walletName,
    credentialId: pending.credentialId,
    userId: pending.userId,
    prfSalt: toBase64(salt),
    wrapped,
    transports: pending.transports,
    createdAt: Date.now(),
    lastUsedAt: null,
    version: 1,
  };
  await savePasskey(record);
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
