/**
 * Coin configurations passed to KDF in the startup `coins` array.
 * Source of truth: the `coins` repo (../coins/coins) — keep in sync manually
 * until a dynamic coins provider is added (post-MVP).
 */

/**
 * Raw coin config object as it appears in the `coins` file and is handed to
 * KDF verbatim. Only a few fields are read by the app; the rest is passthrough
 * (ZHTLC coins carry a large `protocol.protocol_data`, no pubtype/wiftype, etc.).
 */
export interface CoinConfig {
  coin: string;
  protocol: { type: string; protocol_data?: unknown };
  required_confirmations?: number;
  [key: string]: unknown;
}

export interface ElectrumServer {
  url: string;
  protocol: 'WSS';
}

/** How the app activates and transacts with a coin. */
export type CoinKind = 'utxo' | 'zhtlc';

export interface WalletCoin {
  kind: CoinKind;
  config: CoinConfig;
  /** Only WSS electrum endpoints work in the browser (WASM). */
  electrums: ElectrumServer[];
  /** ZHTLC only: lightwalletd (gRPC-web over https) servers. */
  lightwalletd?: string[];
  explorerTxUrl: (txid: string) => string;
}

export const KMD: WalletCoin = {
  kind: 'utxo',
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
  kind: 'utxo',
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

/**
 * PIRATE (ARRR) — a shielded ZHTLC coin. The full `protocol.protocol_data`
 * (consensus params + sapling checkpoint tree) is required by KDF and copied
 * verbatim from the coins repo. In WASM, KDF downloads the Zcash sapling
 * parameters itself (~50 MB, cached in IndexedDB), so no zcash_params_path is
 * needed. Activation is slow (block scan) and send uses task::withdraw.
 */
export const ARRR: WalletCoin = {
  kind: 'zhtlc',
  config: {
    coin: 'ARRR',
    asset: 'PIRATE',
    fname: 'Pirate',
    is_privacy_coin: true,
    txversion: 4,
    overwintered: 1,
    mm2: 1,
    avg_blocktime: 60,
    protocol: {
      type: 'ZHTLC',
      protocol_data: {
        consensus_params: {
          overwinter_activation_height: 152855,
          sapling_activation_height: 152855,
          blossom_activation_height: null,
          heartwood_activation_height: null,
          canopy_activation_height: null,
          coin_type: 133,
          hrp_sapling_extended_spending_key: 'secret-extended-key-main',
          hrp_sapling_extended_full_viewing_key: 'zxviews',
          hrp_sapling_payment_address: 'zs',
          b58_pubkey_address_prefix: [28, 184],
          b58_script_address_prefix: [28, 189],
        },
        check_point_block: {
          height: 1900000,
          time: 1652512363,
          hash: '44797f3bb78323a7717007f1e289a3689e0b5b3433385dbd8e6f6a1700000000',
          sapling_tree:
            '01e40c26f4a28071535b95ae637d30a209531e92a33de0a649e51183771025fd0f016cdc51442fcb328d047a709dc0f41e0173953404711045b3ef3036d7fd4151271501d6c94c5ce6787826af809aaee83768c4b7d4f02c8dc2d24cf60ed5f127a5d730018a752ea9d9efb3e1ac0e6e705ac9f7f9863cfa8f612ad43802175338d8d7cc6000000001fc3542434eff03075ea5f0a64f1dfb2f042d281b1a057e9f6c765b533ce51219013ad9484b1e901e62b93e7538f913dcb27695380c3bc579e79f5cc900f28e596e0001431da5f01fe11d58300134caf5ac76e0b1b7486fd02425dd8871bca4afa94d4b01bb39de1c1d10a25ce0cc775bc74b6b0f056c28639e7c5b7651bb8460060085530000000001732ddf661e68c9e335599bb0b18b048d2f1c06b20eabd18239ad2f3cc45fa910014496bab5eedab205b5f2a206bd1db30c5bc8bc0c1914a102f87010f3431be21a0000010b5fd8e7610754075f936463780e85841f3ab8ca2978f9afdf7c2c250f16a75f01db56bc66eb1cd54ec6861e5cf24af2f4a17991556a52ca781007569e95b9842401c03877ecdd98378b321250640a1885604d675aaa50380e49da8cfa6ff7deaf15',
        },
        z_derivation_path: "m/32'/141'",
      },
    },
    derivation_path: "m/44'/141'",
    required_confirmations: 5,
    requires_notarization: false,
  },
  // WSS electrum endpoints (browser-compatible) from coins/electrums/ARRR.
  electrums: [
    { url: 'arrr.electrum1.cipig.net:30008', protocol: 'WSS' },
    { url: 'arrr.electrum2.cipig.net:30008', protocol: 'WSS' },
    { url: 'arrr.electrum3.cipig.net:30008', protocol: 'WSS' },
  ],
  // gRPC-web lightwalletd (https) from coins/light_wallet_d/ARRR_WSS.
  lightwalletd: [
    'https://electrum1.cipig.net:19447',
    'https://electrum2.cipig.net:19447',
    'https://electrum3.cipig.net:19447',
  ],
  explorerTxUrl: (txid) => `https://explorer.pirate.black/tx/${txid}`,
};

export const WALLET_COINS: WalletCoin[] = [KMD, KMDCL, ARRR];

export const coinByTicker = (ticker: string): WalletCoin | undefined =>
  WALLET_COINS.find((c) => c.config.coin === ticker);
