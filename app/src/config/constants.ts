/** Global app / KDF network constants. */

export const APP_NAME = 'KMD Wallet';
export const KDF_GUI_ID = 'kmd-web-wallet';

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
