import {
  KDF_EVENT_WORKER_PATH,
  KDF_GUI_ID,
  KDF_NETID,
  KDF_SEED_NODES,
} from '../config/constants';
import { WALLET_COINS } from '../config/coins';
import type { KdfStartupConf } from './types';

export interface WalletCredentials {
  walletName: string;
  walletPassword: string;
  /** Seed phrase — only on registration/import; omit to log into an existing wallet. */
  passphrase?: string;
  /** Allow creating a new wallet with these credentials (false = login only). */
  allowRegistrations?: boolean;
}

function baseConf(rpcPassword: string): KdfStartupConf {
  return {
    mm2: 1,
    gui: KDF_GUI_ID,
    netid: KDF_NETID,
    rpc_password: rpcPassword,
    seednodes: KDF_SEED_NODES,
    coins: WALLET_COINS.map((c) => c.config),
    enable_hd: false,
    allow_weak_password: false,
    event_streaming_configuration: {
      access_control_allow_origin: '*',
      worker_path: KDF_EVENT_WORKER_PATH,
    },
  };
}

/** Build the mm2_main conf for an iguana (single-address) wallet session. */
export function buildStartupConf(
  creds: WalletCredentials,
  rpcPassword: string,
): KdfStartupConf {
  return {
    ...baseConf(rpcPassword),
    wallet_name: creds.walletName,
    wallet_password: creds.walletPassword,
    ...(creds.passphrase ? { passphrase: creds.passphrase } : {}),
    allow_registrations: creds.allowRegistrations ?? false,
  };
}

/**
 * Conf for a no-login session: KDF runs without an active wallet so utility
 * RPCs (get_wallet_names, …) are available before authentication.
 */
export function buildNoAuthConf(rpcPassword: string): KdfStartupConf {
  return {
    ...baseConf(rpcPassword),
    allow_registrations: false,
  };
}
