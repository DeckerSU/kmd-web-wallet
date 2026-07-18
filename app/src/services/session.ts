import { generateRpcPassword, kdf } from '../kdf/client';
import { buildNoAuthConf, buildStartupConf, type WalletCredentials } from '../kdf/conf';
import { MainStatus, StartupResultCode, startupResultName } from '../kdf/types';

/**
 * Wallet session orchestration on top of KdfClient.
 *
 * KDF can only run one configuration at a time, so every login/logout is a
 * full node restart: stop → mm2_main with the new conf. Before authentication
 * the node runs in "no-login" mode, which is enough for get_wallet_names.
 */

export type SessionErrorKind = 'wrong-password' | 'startup-failed';

export class SessionError extends Error {
  readonly kind: SessionErrorKind;

  constructor(kind: SessionErrorKind, message: string) {
    super(message);
    this.name = 'SessionError';
    this.kind = kind;
  }
}

interface GetWalletNamesResult {
  wallet_names: string[];
  activated_wallet: string | null;
}

async function restartWith(conf: ReturnType<typeof buildNoAuthConf>): Promise<void> {
  await kdf.load();
  if (kdf.status() !== MainStatus.NotRunning) {
    await kdf.stop();
  }
  const outcome = await kdf.start(conf);
  if (outcome.code === StartupResultCode.Ok) return;

  const message = outcome.message ?? startupResultName(outcome.code);
  if (
    outcome.code === StartupResultCode.InitError &&
    /decrypt|mnemonic/i.test(message)
  ) {
    throw new SessionError('wrong-password', message);
  }
  throw new SessionError(
    'startup-failed',
    `KDF start failed: ${startupResultName(outcome.code)} — ${message}`,
  );
}

/** Start (or restart) the pre-auth session and list stored wallets. */
export async function startNoAuthSession(): Promise<string[]> {
  await restartWith(buildNoAuthConf(generateRpcPassword()));
  const res = await kdf.rpc2<GetWalletNamesResult>('get_wallet_names');
  return res.wallet_names;
}

/** Log into an existing wallet stored in the browser's IndexedDB. */
export async function loginWallet(walletName: string, walletPassword: string): Promise<void> {
  await authWith({ walletName, walletPassword, allowRegistrations: false });
}

/** Create a brand-new wallet from a freshly generated mnemonic. */
export async function createWallet(
  walletName: string,
  walletPassword: string,
  mnemonic: string,
): Promise<void> {
  await authWith({
    walletName,
    walletPassword,
    passphrase: mnemonic,
    allowRegistrations: true,
  });
}

/** Import an existing seed phrase as a new named wallet. */
export const importWallet = createWallet;

async function authWith(creds: WalletCredentials): Promise<void> {
  try {
    await restartWith(buildStartupConf(creds, generateRpcPassword()));
  } catch (e) {
    // Keep the pre-auth session alive so the wallet list still works.
    await startNoAuthSession().catch(() => {});
    throw e;
  }
}

/** Log out: stop the authenticated node and return to the pre-auth session. */
export async function logoutWallet(): Promise<string[]> {
  return startNoAuthSession();
}
