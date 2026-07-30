import { fromBase64, randomBytes, toBase64, unwrapSecret, wrapSecret } from '../lib/keywrap';
import {
  deletePasskey,
  getPasskey,
  loadPreferredAttachment,
  savePasskey,
  savePreferredAttachment,
  type PasskeyRecord,
} from '../lib/passkeyStore';
import { generateWalletPassword } from '../lib/password';
import {
  hasPlatformAuthenticator,
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
  // Always name an authenticator. Leaving `authenticatorAttachment` unset sends
  // Chrome into its generic create dialog, whose route to Google Password
  // Manager hangs indefinitely on Linux; naming 'platform' reaches the very
  // same provider directly and completes in a few seconds. Measured, and the
  // single most consequential line in this file.
  const useAttachment =
    attachment ??
    loadPreferredAttachment() ??
    ((await hasPlatformAuthenticator()) ? 'platform' : 'cross-platform');
  const cred = await registerPasskey(walletName, salt, { attachment: useAttachment });
  // Trust what came back over what was asked for — the browser's dialog lets
  // the user redirect the credential to a phone regardless of our request.
  const actualAttachment = cred.attachment ?? useAttachment;
  if (actualAttachment) savePreferredAttachment(actualAttachment);

  const pending: PendingEnrollment = {
    walletName,
    password: walletPassword,
    salt,
    credentialId: cred.credentialId,
    userId: cred.userId,
    transports: cred.transports,
    attachment: actualAttachment,
  };

  if (!cred.prfSecret) return { done: false, pending };
  await persist(pending, cred.prfSecret);
  return { done: true, password: walletPassword };
}

/** Phase two: re-run the ceremony from a user gesture and store the result. */
export async function completeEnrollment(pending: PendingEnrollment): Promise<string> {
  const secret = await readPrfSecret(pending.credentialId, pending.salt, {
    transports: pending.transports,
    attachment: pending.attachment,
  });
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
    attachment: pending.attachment,
    createdAt: Date.now(),
    lastUsedAt: null,
    version: 1,
  };
  await savePasskey(record);
}

/**
 * Records written before attachment was tracked have no such field. The
 * transports recorded at registration still say where the credential lives, so
 * infer from those rather than making the user re-register.
 */
function inferAttachment(rec: PasskeyRecord): AuthenticatorAttachment | undefined {
  if (rec.attachment) return rec.attachment;
  if (!rec.transports?.length) return undefined;
  const roaming = ['hybrid', 'usb', 'nfc', 'ble', 'cable', 'smart-card'];
  if (rec.transports.some((t) => roaming.includes(t))) return 'cross-platform';
  if (rec.transports.includes('internal')) return 'platform';
  return undefined;
}

/**
 * Recover the wallet password via its passkey. Prompts for user verification,
 * so this doubles as the confirmation gate for revealing secrets in Settings.
 */
export async function unlockPassword(walletName: string): Promise<string> {
  const rec = await getPasskey(walletName);
  if (!rec) throw new PasskeyError(`No passkey is registered for “${walletName}”.`);

  // Route the assertion at the authenticator the credential actually lives on.
  const attachment = inferAttachment(rec);
  const secret = await readPrfSecret(rec.credentialId, fromBase64(rec.prfSalt), {
    transports: rec.transports,
    attachment,
  });
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
  // Persist what we inferred, so the next unlock does not have to guess again.
  await savePasskey({ ...rec, attachment, lastUsedAt: Date.now() });
  return password;
}

export async function removePasskey(walletName: string): Promise<void> {
  await deletePasskey(walletName);
}

export { getPasskey };
