# KMD Web Wallet

A modern, non-custodial web wallet for **Komodo (KMD)**, **KomodoClassic (KMDCL)**,
**Pirate (ARRR)** and **Gleec (GLEEC)**,
built with React and powered by the
[Komodo DeFi Framework](https://github.com/KomodoPlatform/komodo-defi-framework) (KDF)
running entirely in the browser as a WebAssembly module.

Everything happens client-side: the KDF node runs in the page, connects to Electrum
servers over WSS (and to EVM JSON-RPC nodes over HTTPS), and stores encrypted wallets
in the browser's IndexedDB. No backend service is involved; a production deployment is
just static files.

## Features

- **Wallet management** — create a new wallet (24-word BIP39 seed with a guided backup
  step), import an existing seed phrase, unlock by password, log out. Wallets are stored
  encrypted in IndexedDB by KDF itself.
- **Single-address (iguana) mode** — one address per coin (`enable_hd: false`).
- **Coins** — three protocol families, each with balances, send, receive (QR) and
  transaction history:
  | Coin | Protocol | Activation | Transaction history |
  |---|---|---|---|
  | KMD, KMDCL | UTXO (Electrum over WSS) | `task::enable_utxo`, instant | `my_tx_history` (v2) |
  | ARRR | ZHTLC / shielded (lightwalletd) | `task::enable_z_coin`, on demand — sapling params + chain scan | `z_coin_tx_history` |
  | GLEEC | EVM / ETH (JSON-RPC over HTTPS) | `enable_eth_with_tokens`, instant | Blockscout explorer (see below) |
- **Live balances** over KDF's event streaming (`stream::balance::enable`), with a 30 s
  poll as a fallback.

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 19, TypeScript, Tailwind CSS v4 |
| State | zustand (+ TanStack Query planned for RPC caching) |
| Build | Vite (SPA, no SSR — the app is fully client-side) |
| Wallet engine | KDF `mm2_bin_lib` WASM (wasm-bindgen ES module) |
| Seed generation | KDF (generated & encrypted natively on wallet creation) |

## Repository layout

```
app/
  public/kdf/
    event_streaming_worker.js   # SharedWorker used by KDF to broadcast stream events
  src/
    kdflib/                     # KDF WASM bundle (kdflib.js, kdflib_bg.wasm, typings)
    kdf/                        # framework integration layer (no React)
      client.ts                 #   KdfClient: load/start/stop lifecycle + RPC transport
      conf.ts                   #   mm2_main startup config builders (auth / no-auth)
      methods.ts                #   typed wrappers over the KDF RPC methods used
      evmHistory.ts             #   EVM tx history from a Blockscout explorer (not KDF)
      streaming.ts              #   SharedWorker client for KDF stream events
      types.ts                  #   types over the wasm-bindgen module
    services/session.ts         # wallet session orchestration (login = node restart)
    store/                      # zustand stores
    features/                   # UI: auth screens, debug console, (more to come)
    components/ui.tsx           # small in-house UI kit
    config/                     # coins, electrum servers, netid, seed nodes
```

## Prerequisites

- **Node.js ≥ 22.12** (Vite 8 requirement). With nvm: `nvm install 22 && nvm use 22`.
- A modern browser. The wallet uses WebAssembly, IndexedDB and SharedWorker.

## Build & run

```bash
cd app
npm install

# Development server (http://localhost:5173)
npm run dev

# Type-check + production build (output in app/dist/)
npm run build

# Serve the production build locally
npm run preview
```

The production `dist/` is fully static — host it on any web server or CDN. The KDF
wasm binary (~36 MB, ~12 MB gzipped) is emitted as a content-hashed asset, so make
sure your hosting serves it compressed and with long-lived cache headers.

### Versioning

The app version is `major.minor.build`, and **`app/package.json` is the single source
of truth**. Vite injects it as `__APP_VERSION__` (see `vite.config.ts`), re-exported as
`APP_VERSION` from `src/config/constants.ts` — read it from there, never hard-code it.
It is shown on the login screen and in Settings under the KDF version.

Bumping rules:

| Part | When |
|---|---|
| `build` | each released build |
| `minor` | each pull request |
| `major` | on request only |

### Developer console

Open the app with `?debug` appended to the URL (e.g. `http://localhost:5173/?debug`)
to get a raw KDF control panel: load WASM, start/stop the node with a test wallet,
call the `version` RPC, and watch live KDF logs.

## Network configuration

Defined in `app/src/config/`:

- **netid:** `6133`; P2P seed nodes (`seed01/seed03.kmdefi.net`, `kdfseed1.decker.im`,
  `staking1/staking2.gleec.com`) are dialed over WSS on port 32336.
- **Electrum servers** (WSS only — plain TCP/SSL sockets are not available to browser
  code): `kmd.electrum{1,2,3}.cipig.net:30001` for KMD,
  `electrum.kmdclassic.com:50004` for KMDCL,
  `arrr.electrum{1,2,3}.cipig.net:30008` plus lightwalletd on
  `electrum{1,2,3}.cipig.net:19447` for ARRR.
- **EVM JSON-RPC:** `https://evm-rpc.gleec.com` for GLEEC (chain_id `11169`). KDF also
  supports `wss://evm-ws.gleec.com`, but HTTPS needs no connection loop.

### EVM transaction history

GLEEC history does **not** come from KDF — it cannot, in a browser:

- `EthCoin::process_history_loop` is compiled out under `wasm32` and only logs
  *"Transaction history is not supported for ETH/ERC20 coins"*;
- `EthCoin` has no `CoinWithTxHistoryV2` impl, so `my_tx_history` (v2) rejects it;
- `stream::tx_history::enable` answers `CoinNotSupported` for it.

So `src/kdf/evmHistory.ts` reads the Etherscan-compatible endpoint of the chain's
Blockscout instance (`https://evm-explorer.gleec.com/api?module=account&action=txlist`),
which sends `Access-Control-Allow-Origin: *`, and normalizes rows into KDF's
`TransactionDetails` shape so the rest of the app stays protocol-agnostic. This is the
same approach the reference Flutter wallet takes for EVM assets. Note that only "normal"
transactions are listed — GLEEC moved by a contract call (an internal transfer) does not
appear. Because the endpoint reports no total count, "load more" is inferred from a full
page, and confirmations are refreshed on a 30 s timer instead of a stream.

## Updating the KDF WASM bundle

The bundle in `app/src/kdflib/` comes from a `mm2_bin_lib` wasm release archive.
To install a new one:

```bash
cd app
rm -rf src/kdflib && mkdir -p src/kdflib
unzip -o <path-to-kdf-wasm.zip> -d src/kdflib
rm -f src/kdflib/.gitignore src/kdflib/package.json
# kdflib_bg.wasm.d.ts is unused and contains identifiers that are invalid in
# TypeScript (wasm-bindgen test exports like `__wbgt__foo::tests::bar`):
rm -f src/kdflib/kdflib_bg.wasm.d.ts
# The same invalid names appear in kdflib.d.ts (InitOutput interface) — quote them:
sed -i -E 's/readonly (__wbgt__[a-zA-Z0-9_]+(::[a-zA-Z0-9_]+)+): /readonly "\1": /' src/kdflib/kdflib.d.ts
# Verify: must pass with no TS1110 ("Type expected") errors
npm run build
```

## Security notes

- The seed phrase and wallet password are passed only to the KDF startup config in
  memory; the app never persists them. KDF stores the seed encrypted (with the wallet
  password) in IndexedDB.
- The wallet password policy (min 8 chars, mixed case, digit, special character…)
  mirrors KDF's `password_policy.rs`, so failures are caught before node startup.
- This is early-stage software under active development — do not use it with
  significant funds yet.

## Roadmap

- [x] Phase 0 — project skeleton, KDF WASM bootstrap, smoke test
- [x] Phase 1 — auth: create / import / unlock / logout
- [x] Phase 2 — coin activation, balances, live event streaming
- [x] Phase 3 — send & receive (QR)
- [x] Phase 4 — transaction history
- [x] Phase 5 — polish: settings, seed viewer, mobile layout (i18n deferred to post-MVP)
- [x] Post-MVP — PIRATE (ARRR) shielded coin; GLEEC (EVM) with instant activation,
      send/receive and explorer-backed history
- [ ] Next — HD wallets, ERC20-style tokens on GLEEC, fiat prices, DEX features, Trezor
