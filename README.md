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
  step), import an existing seed phrase, unlock by password or passkey, log out. Wallets
  are stored encrypted in IndexedDB by KDF itself. The wallet name is suggested as
  `Adjective-Noun-NNNNN` (e.g. `Willow-Lynx-01584`) so creation needs no typing — the
  words carry recognisability, the five-digit suffix carries uniqueness — and stays
  editable, since KDF has no rename and the name chosen at creation is permanent.
- **Single-address (iguana) mode** — one address per coin (`enable_hd: false`).
- **Wallet identicons** — each wallet is drawn as a deterministic pattern derived from
  its own public key (`get_public_key`), shown in the wallet list and the dashboard
  header. A name can be mistyped or shared between two wallets that start with the same
  letter; keys cannot. Only the key is stored (`kmd-wallet-meta` in IndexedDB) and the
  image recomputed, so it can never go stale. A wallet never yet opened in this browser
  falls back to a letter, since KDF only reveals the key to an open session.
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

### Testing over HTTPS from the real world

Two of the wallet's features cannot be exercised on `localhost` alone: passkeys
need a secure context and bind to the hostname they were created under, and a
browser only offers to install a PWA over HTTPS. Neither works from `npm run dev`
either — the service worker registers only in a production build. So the loop is:
build, serve the build, expose it over a public HTTPS URL.

```bash
# 1. Production build
cd app
npm run build

# 2. Serve dist/ — see "Not npm run preview" below for why not the obvious one
docker run --rm --network host \
  -v "$PWD/dist:/usr/share/caddy:ro" \
  caddy:2-alpine caddy file-server --root /usr/share/caddy --listen :5000 --access-log

# 3. In another terminal: public HTTPS URL
docker run --rm -it --network host \
  cloudflare/cloudflared:latest tunnel --url http://localhost:5000
```

`cloudflared` prints a `https://<random-words>.trycloudflare.com` address; open
that on the device under test.

Rebuilding while the server runs is fine — `vite build` empties `dist/` but keeps
the directory itself, so the bind mount stays valid and the next request already
serves the new build.

**Check the port is free first.** With `--network host`, a container whose port is
already taken fails to bind, and requests then reach whatever *is* listening —
which answers 404 for paths it has never heard of, from a server that looks like
yours. `ss -ltn | grep :5000` before starting saves a confusing hour.

**Readable access logs.** `--access-log` emits one large JSON object per request.
With `jq` on hand, this collapses it to a line each — worth it, because the
`[gzip]` marker and byte count confirm the wasm went out compressed, and the
client IP shows whether a request came from the phone or from the machine
running the tunnel:

```bash
docker run --rm --network host \
  -v "$PWD/dist:/usr/share/caddy:ro" \
  caddy:2-alpine caddy file-server --root /usr/share/caddy --listen :5000 --access-log \
  2>&1 | jq -rR 'fromjson? | select(.logger? == "http.log.access")
    | (if .request.headers."Cf-Connecting-Ip" then .request.headers."Cf-Connecting-Ip"[0]
       elif .request.headers."X-Forwarded-For" then (.request.headers."X-Forwarded-For"[0] | split(",")[0] | ltrimstr(" "))
       else .request.remote_ip end) as $ip
    | "\($ip)\t\(.status)  \(.request.method) \(.request.uri)  \(.size/1024|floor)KB  \((.duration*1000)|round)ms\(if .resp_headers."Content-Encoding" then "  [\(.resp_headers."Content-Encoding"[0])]" else "" end)"'
```

```
203.0.113.42   200  GET /assets/kdflib_bg-B7JMfk74.wasm  11822KB  347ms  [gzip]
203.0.113.42   200  GET /sw.js                               4KB    0ms
203.0.113.42   404  GET /nope-404                            0KB    0ms
```

Caddy's own `remote_ip` is always `127.0.0.1` here — the connection comes from
the local `cloudflared`, not the browser — so the real address has to be read
from the forwarded header, which is what the `if/elif` above does. (`if` rather
than jq's `//` operator: an empty string is truthy in jq, so `//` would pick a
blank `X-Forwarded-For` over the fallback.)

**Not `npm run preview`.** The obvious choice fails here for two measured
reasons. It answers `403 Blocked request` to any `Host` it does not recognise,
which is every request arriving through a tunnel, so nothing loads at all. And
while it compresses JS, it serves the wasm uncompressed — 34 MB instead of
11 MB, which is both slow over a tunnel and unrepresentative of production, where
GitHub Pages gzips it. Caddy compresses by default and does not care about the
`Host`.

**A new hostname is a new world.** `trycloudflare` mints a fresh random hostname
on every run, and browser storage is scoped to the origin. Passkeys are bound to
the hostname as their relying-party ID, so one created under yesterday's tunnel
will not unlock anything today; and the wallets themselves live in IndexedDB,
which means **every new tunnel URL starts with no wallets and the seed has to be
imported again**. Fine for checking installability once; for repeated passkey
testing use a stable hostname — a reserved ngrok domain, or a named Cloudflare
tunnel.

**`--network host` is Linux-only.** Docker Desktop on macOS and Windows does not
support it. There, publish the port and point the tunnel at the host gateway:

```bash
docker run --rm -p 5000:5000 -v "$PWD/dist:/usr/share/caddy:ro" \
  caddy:2-alpine caddy file-server --root /usr/share/caddy --listen :5000 --access-log

docker run --rm -it cloudflare/cloudflared:latest \
  tunnel --url http://host.docker.internal:5000
```

### Passkey login

A wallet can be unlocked with a passkey instead of a typed password. KDF still
requires a password, so one is generated at creation, shown to the user once, and
kept encrypted in IndexedDB under a key only the authenticator can reproduce.

The key comes from the **WebAuthn PRF extension**: for a given (credential, salt)
pair the authenticator returns a stable 32-byte secret, which is run through
HKDF-SHA256 into an AES-GCM key (`src/lib/keywrap.ts`). Nothing weaker is
accepted — an authenticator that will not do PRF fails registration rather than
leaving a password anything could read.

Getting this working across platforms took considerably more than the spec
suggests. The configuration below is the one that survived; everything after it
is why the obvious alternatives did not.

#### The configuration that works

```ts
// registration — src/lib/webauthn.ts
{
  authenticatorSelection: {
    authenticatorAttachment: 'platform',   // or 'cross-platform'; never omitted
    residentKey: 'required',               // discoverable
    requireResidentKey: true,
    userVerification: 'required',
  },
  pubKeyCredParams: [{ alg: -7 }, { alg: -257 }],
  attestation: 'none',
  extensions: { prf: { eval: { first: salt } } },
}

// login — the credential id alone is not enough to find it again
{
  allowCredentials: [{ type: 'public-key', id, transports }],  // transports from registration
  hints,                                  // from the recorded attachment
  userVerification: 'required',
  extensions: { prf: { eval: { first: salt } } },
}
```

`authenticatorAttachment` is chosen as `'platform'` when a user-verifying local
authenticator exists and `'cross-platform'` otherwise; a failed attempt offers
the other route and whichever works is remembered per browser.

**What this gives up.** Discoverable credentials mean the authenticator stores
the wallet name, so it appears in the OS passkey manager — non-discoverable was
the original choice precisely to avoid that. They also sync through the passkey
provider while the KDF wallet does not, so a passkey can surface on a device with
no matching wallet. The second is inert (login replays a credential id from the
local record and never enumerates); the first is a real trade, accepted because a
passkey that cannot produce a key is worth less than a private one.

#### Problems hit, and what each turned out to be

**1. `create()` hangs forever with no error.** On Linux the PIN dialog spins
after the user answers and the promise never settles. The cause was the *absence*
of `authenticatorAttachment`: unset, Chrome opens a generic create dialog whose
route to Google Password Manager never resolves. Naming `'platform'` reaches the
identical provider in ~4s. The manual tell is stark — accepting the default
dialog hangs, while "Save another way" → Google Password Manager succeeds with a
byte-identical request. `hints: ['client-device']` is *not* a substitute.

**2. Android creates a credential with no PRF at all.** Not `enabled: false` —
the `prf` key is simply absent, and a follow-up assertion is empty too, so the
result is a passkey that can never unlock anything. Google Password Manager binds
hmac-secret to discoverable credentials, so `residentKey: 'required'` is
mandatory there. Linux tolerates either, which is why this only appeared once
Android was tested.

**3. A passkey created on a phone could not be used to log in.** Registration
succeeded, then unlocking prompted the *local* password manager, which does not
hold the credential. `allowCredentials` was being sent with the credential id and
nothing else, so the browser had no idea where to look. Transports were recorded
at registration and never used. Both they and a `hints` value are now sent — and
crucially the attachment is read from `authenticatorAttachment` on the creation
*response*, not from what was requested, because the browser's own dialog lets a
user redirect the credential to their phone regardless of the request.

**4. The PRF secret is not always returned by `create()`.** Some providers
release it only on a later assertion. Chaining that assertion automatically
leaves it pending forever on some providers, so enrolment is two-phase: when the
secret is withheld, the UI asks the user to confirm once more and the assertion
runs behind a real click.

**5. `prf.enabled` has three states, not two.** `false` means unsupported, but
`undefined` — no `prf` key at all — means unknown, and treating it as success
walked straight into the hang in (4). Unknown now means "ask again".

**6. WebAuthn's `timeout` is a hint the platform may ignore.** Ceremonies get a
hard ceiling (60s local, 150s roaming, where scanning a QR legitimately takes
time). Rejecting our own promise is not enough on its own: the provider's dialog
keeps spinning because the ceremony is still running, so the timeout also aborts
via `AbortController`.

**7. Capability detection hid the feature from a browser that supports it.**
Safari answers `getClientCapabilities()` with a short list carrying no
`extension:*` keys at all, yet performs PRF perfectly. Reading a missing key as
"unsupported" meant the passkey option never appeared there — the same
three-state mistake as (5), made twice in different places. Only an explicit
`false` counts as a refusal now; unknown is optimistic, which is safe because
registration refuses to persist anything unless a secret actually came back.

**8. The virtual authenticator hid half of this.** Chrome's CDP virtual
authenticator always returns the PRF secret from `create()`, so the entire
second-ceremony path was never exercised by the test suite despite everything
passing. Provider behaviour now has to be emulated deliberately — stripped `prf`
results, gesture-less assertions that never settle — to cover it.

**Diagnoses that looked right and were not:** that the chained assertion was to
blame (it hangs, but was not the reported failure); that
`userVerification: 'required'` was the trigger (a variant with verification
discouraged hung too); and that Google Password Manager on Linux is simply broken
(it works fine when addressed directly). Each was disproved by the next
measurement — which is what the bisect panel in the dev console (`?debug`) exists
for. It walks one option at a time and prints a copyable trace; `src/lib/passkeyLog.ts`
records no secrets, only what was asked and what came back.

#### Measurements

Chrome 150, Google Password Manager, `userVerification: 'required'`, PRF requested:

| Platform | attachment | residentKey | Result |
|---|---|---|---|
| Linux/X11 | *unset* | discouraged | hangs indefinitely |
| Linux/X11 | *unset* + `hints: ['client-device']` | discouraged | hangs |
| Linux/X11 | `platform` | discouraged | created 4.4s, PRF returned |
| Linux/X11 | `platform` | **required** | created 4.4s, PRF returned |
| Linux/X11 | `cross-platform` | discouraged | created 16.4s, PRF returned |
| Android | `platform` | discouraged | created 1.1s, **no PRF** |
| Android | *unset* + `hints` | discouraged | created 2.7s, **no PRF** |
| Android | `platform` | **required** | created 2.3s, PRF returned |
| macOS/Safari 26.5 | `platform` | **required** | created 5.1s, PRF returned |
| macOS/Safari 26.5 | `platform` | discouraged | created 5.2s, PRF returned |
| macOS/Safari 26.5 | *unset* + `hints` | discouraged | created 4.4s, PRF returned |

The intersection — attachment named, `residentKey: 'required'` — is what ships.
Safari is the easy case: every variant works there, including the ones that hang
on Chrome/Linux, so it says nothing about which to pick and everything about
Chrome's dialog being the outlier.

#### Security properties

The relying party is the page itself. There is no server to verify an assertion
against, so this is **not** protection against a forged login. What it gives is
protection at rest: a copy of the browser profile yields only ciphertext, useless
without the authenticator. A compromised page (XSS, a tampered build) is not
defended against by any client-side scheme, this one included.

**Recovery.** The generated password is not a convenience, it is the second key.
Lose the authenticator and the ciphertext can never be opened again, so creation
makes the user acknowledge having saved it and Settings can show it again behind
the same passkey prompt. Failing both, the seed phrase still restores the wallet
from scratch. Password login therefore always remains available, and enrolment
verifies the wrap round-trips before persisting, so a record that cannot be
opened later is never written.

### Installable app (PWA)

The wallet can be installed to a home screen or desktop. A manifest
(`public/manifest.webmanifest`) plus a service worker (`public/sw.js`) satisfy the
browser's installability criteria, and `beforeinstallprompt` is captured so the
offer appears as a dismissible bar in the app's own UI rather than the browser's
infobar. A declined offer is remembered - a wallet that nags every visit is worse
than one that never asks.

**The worker is generated at build time**, not written by hand. `sw/sw.template.js`
carries the logic; the `swBuildManifest` plugin in `vite.config.ts` fills in the
list of content-hashed filenames actually emitted and a build id derived from
them, and writes `dist/sw.js`.

That is not a convenience. A browser reinstalls a service worker only when the
script's **bytes** change — nothing else triggers it, not a new `index.html`, not
new assets. A hand-written worker is byte-identical on every deploy, so `install`
never runs again and its cache stays frozen at whatever the first install
captured. An installed app then keeps asking for assets that the next deploy
deleted, and GitHub Pages answers 404. That is a real failure that was observed
on Android, not a hypothetical. Embedding the filenames makes the script change
exactly when the build does, which drives the whole update cycle: new bytes →
reinstall → fresh precache under a new cache name → `activate` deletes the old
one.

The list is read from `dist/` on disk rather than parsed out of `index.html`,
which matters because dynamic chunks (`kdflib-*.js`) are not referenced there and
would otherwise be missed — and a missing dynamic chunk 404s at boot just as
loudly as a missing entry chunk.

Three further decisions in it are load-bearing:

- **The 36 MB wasm is never precached.** It would take most of a typical origin's
  storage quota, and a stale copy would pin users to an old wallet engine. It goes
  to the network and is left to the browser's HTTP cache, which the content hash
  in its filename makes safe.
- **The precache is atomic.** `addAll` rejects if any single entry fails, failing
  the install and leaving the previous worker in charge. Caching whatever
  succeeded can store a shell whose script is missing — a shell that cannot boot
  and, after the next deploy, cannot be repaired from the server either.
- **Navigations are served from the precache, not the network.** Network-first
  looks fresher but is what broke installed apps: HTML is cacheable
  (`max-age=600` on Pages), so a navigation could be answered with a shell whose
  assets the latest deploy had already deleted. A precached shell is always
  consistent with precached assets, because the two are installed together or not
  at all.
- **Cache lookups pass `ignoreVary`.** Static hosts commonly answer `Vary: Origin`,
  and Vite marks its module script `crossorigin`, so the page requests an asset
  with an `Origin` header while the worker's precache fetch has none. Matching
  then compares the varied header, misses on an identical URL, and the offline
  page renders blank with `ERR_FAILED`.

"Works offline" here means the app's own screen appears and explains itself: the
shell and its build assets are cached, the wasm is not, so an offline visit
reaches the "Failed to start" screen with a Retry button. That is the honest
state — the wallet needs Electrum servers and JSON-RPC nodes to do anything at
all, so a genuinely offline wallet is not on offer.

### Boot diagnostics

Startup is several steps, and they used to be indistinguishable: the screen read
"Downloading wallet engine…" until the whole sequence finished, so a slow wasm
compile or a node that would not come up both looked like a stuck download that
had visibly reached 100%.

The console now prints a phase breakdown, KDF's own log lines timestamped
relative to node start, and how the wasm was actually obtained:

```
[boot] downloading took 73 ms → compiling
[boot] wasm over network: transfer=34.2MB encoded=34.1MB decoded=34.1MB in 56ms
[boot] compiling took 44 ms → starting-node
[boot:kdf +38ms] … INFO Dialed /dns/seed01.kmdefi.net/tcp/32336/wss
[boot] starting-node took 62 ms → waiting-rpc
[boot] RPC up after 1 ms
[boot] ready in 207 ms — downloading=73ms compiling=44ms starting-node=62ms …
```

The `[boot:kdf …]` lines matter most: between "node started" and "RPC up" the
node brings up its P2P seed connections, which is the likeliest place for a
machine-specific stall and is otherwise a black box.

**The progress percentage was also wrong.** `Content-Length` counts bytes on the
wire while the reader yields decoded bytes, so for the gzipped wasm the display
read `34.1 / 11.2 MB (100%)` — a ratio of ~300%, clamped. The total is now
dropped when the response is encoded, or as soon as decoded bytes overtake it,
and progress shows bytes without a percentage rather than a confident wrong one.

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

- **P2P is off** (`disable_p2p: true`, `KDF_ENABLE_P2P` in `src/config/constants.ts`).
  Nothing the wallet does needs it — activation, balances, history and withdrawals
  all talk to Electrum servers or JSON-RPC nodes directly. P2P serves swaps, the
  orderbook and peer health checks, none of which exist yet, and leaving it on
  costs a permanent WSS connection per seed node and puts an unreachable seed node
  on the startup path. Turning it back on also restores `seednodes`: KDF's precheck
  rejects a config carrying both (*"Cannot disable P2P while seed nodes are
  configured"*), so the two move together.
- **netid:** `6133`; the seed nodes used when P2P is enabled (`seed01/seed03.kmdefi.net`,
  `kdfseed1.decker.im`, `staking1/staking2.gleec.com`) are dialed over WSS on port 32336.
- **Electrum servers** (WSS only — plain TCP/SSL sockets are not available to browser
  code): `kmd.electrum{1,2}.cipig.net:30001` for KMD,
  `electrum.kmdclassic.com:50004` for KMDCL,
  `arrr.electrum{1,2}.cipig.net:30008` plus lightwalletd on
  `electrum{1,2}.cipig.net:19447` for ARRR.
  (`electrum3.cipig.net` is omitted — the host answers on neither port.)
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
