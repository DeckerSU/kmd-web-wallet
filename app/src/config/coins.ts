/**
 * Coin configurations passed to KDF in the startup `coins` array.
 * Source of truth: the `coins` repo (../coins/coins) — keep in sync manually
 * until a dynamic coins provider is added (post-MVP).
 */

export interface CoinConfig {
  coin: string;
  name: string;
  fname: string;
  rpcport: number;
  pubtype: number;
  p2shtype: number;
  wiftype: number;
  txversion: number;
  overwintered: number;
  txfee: number;
  mm2: number;
  sign_message_prefix: string;
  required_confirmations: number;
  requires_notarization?: boolean;
  avg_blocktime: number;
  protocol: { type: string };
  derivation_path: string;
  version_group_id?: string;
  consensus_branch_id?: string;
}

export interface ElectrumServer {
  url: string;
  protocol: 'WSS';
}

export interface WalletCoin {
  config: CoinConfig;
  /** Only WSS electrum endpoints work in the browser (WASM). */
  electrums: ElectrumServer[];
  explorerTxUrl: (txid: string) => string;
}

export const KMD: WalletCoin = {
  config: {
    coin: 'KMD',
    name: 'komodo',
    fname: 'Komodo',
    rpcport: 7771,
    pubtype: 60,
    p2shtype: 85,
    wiftype: 188,
    txversion: 4,
    overwintered: 1,
    txfee: 1000,
    mm2: 1,
    sign_message_prefix: 'Komodo Signed Message:\n',
    required_confirmations: 4,
    avg_blocktime: 60,
    protocol: { type: 'UTXO' },
    derivation_path: "m/44'/141'",
  },
  electrums: [
    { url: 'kmd.electrum1.cipig.net:30001', protocol: 'WSS' },
    { url: 'kmd.electrum2.cipig.net:30001', protocol: 'WSS' },
    { url: 'kmd.electrum3.cipig.net:30001', protocol: 'WSS' },
  ],
  explorerTxUrl: (txid) => `https://kmdexplorer.io/tx/${txid}`,
};

export const KMDCL: WalletCoin = {
  config: {
    coin: 'KMDCL',
    name: 'KomodoClassic',
    fname: 'KomodoClassic',
    rpcport: 7771,
    pubtype: 60,
    p2shtype: 85,
    wiftype: 188,
    txversion: 4,
    overwintered: 1,
    version_group_id: '0x892f2085',
    consensus_branch_id: '0x64726d6e',
    txfee: 1000,
    mm2: 1,
    sign_message_prefix: 'Komodo Signed Message:\n',
    required_confirmations: 2,
    requires_notarization: true,
    avg_blocktime: 60,
    protocol: { type: 'UTXO' },
    derivation_path: "m/44'/141'",
  },
  electrums: [{ url: 'electrum.kmdclassic.com:50004', protocol: 'WSS' }],
  explorerTxUrl: (txid) => `https://explorer.kmdclassic.com/tx/${txid}`,
};

export const WALLET_COINS: WalletCoin[] = [KMD, KMDCL];

export const coinByTicker = (ticker: string): WalletCoin | undefined =>
  WALLET_COINS.find((c) => c.config.coin === ticker);
