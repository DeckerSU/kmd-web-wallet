import {
  finishBootTimings,
  logWasmTiming,
  markBootPhase,
  traceKdfDuringBoot,
  type OnBootStage,
} from '../kdf/bootStage';
import { generateRpcPassword, kdf, type LoadProgress } from '../kdf/client';
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

async function restartWith(
  conf: ReturnType<typeof buildNoAuthConf>,
  onStage?: OnBootStage,
): Promise<void> {
  await kdf.load();
  if (kdf.status() !== MainStatus.NotRunning) {
    await kdf.stop();
  }
  markBootPhase('starting-node');
  onStage?.({ phase: 'starting-node' });
  const outcome = await kdf.start(conf, undefined, onStage);
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
export async function startNoAuthSession(
  onLoadProgress?: LoadProgress,
  onStage?: OnBootStage,
): Promise<string[]> {
  await kdf.load(onLoadProgress, onStage);
  logWasmTiming();
  // The node's own logs are the only view into what happens between start and
  // RPC coming up; P2P seed connections are established in there.
  traceKdfDuringBoot((fn) => kdf.onLog(fn));
  await restartWith(buildNoAuthConf(generateRpcPassword()), onStage);
  markBootPhase('reading-wallets');
  onStage?.({ phase: 'reading-wallets' });
  const res = await kdf.rpc2<GetWalletNamesResult>('get_wallet_names');
  finishBootTimings();
  return res.wallet_names;
}

/** Log into an existing wallet stored in the browser's IndexedDB. */
export async function loginWallet(walletName: string, walletPassword: string): Promise<void> {
  await authWith({ walletName, walletPassword, allowRegistrations: false });
}

/**
 * Register a new wallet. When `mnemonic` is omitted, KDF generates a fresh
 * seed phrase itself (encrypting and storing it under `walletName`); pass a
 * `mnemonic` to import an existing seed phrase instead.
 */
export async function createWallet(
  walletName: string,
  walletPassword: string,
  mnemonic?: string,
): Promise<void> {
  await authWith({
    walletName,
    walletPassword,
    ...(mnemonic ? { passphrase: mnemonic } : {}),
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
