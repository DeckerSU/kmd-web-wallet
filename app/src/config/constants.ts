/** Global app / KDF network constants. */

export const APP_NAME = 'KMD Wallet';
export const KDF_GUI_ID = 'kmd-web-wallet';

/**
 * App version, `major.minor.build`. Injected by Vite from package.json, which
 * is the single source of truth — bump it there, never here.
 */
export const APP_VERSION = __APP_VERSION__;

/**
 * Whether to join the KDF P2P network.
 *
 * Nothing this wallet does needs it: coin activation, balances, history and
 * withdrawals all talk to Electrum servers or JSON-RPC nodes directly. P2P
 * exists for swaps, the orderbook and peer health checks — none of which are
 * built yet. Leaving it on costs a permanent WSS connection per seed node and
 * makes an unreachable seed node part of the startup path.
 *
 * Turn this back on when DEX features arrive. Note that KDF rejects a config
 * with `disable_p2p` *and* `seednodes` set ("Cannot disable P2P while seed
 * nodes are configured"), so the two move together — see kdf/conf.ts.
 */
export const KDF_ENABLE_P2P = false;

/** Komodo DeFi Framework P2P network id (per current seed node deployment). */
export const KDF_NETID = 6133;

/** Seed nodes serving netid 6133 (p2p 32326 / wss 32336). */
export const KDF_SEED_NODES = [
  'seed01.kmdefi.net',
  'seed03.kmdefi.net',
  'kdfseed1.decker.im',
  'staking1.gleec.com',
  'staking2.gleec.com',
];

/** SharedWorker used by KDF to broadcast streamed events to the app. */
export const KDF_EVENT_WORKER_PATH = 'kdf/event_streaming_worker.js';
