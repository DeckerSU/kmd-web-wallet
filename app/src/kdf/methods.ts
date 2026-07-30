import { kdf } from './client';
import { coinByTicker, type ElectrumServer, type EvmNode } from '../config/coins';

/** Typed wrappers for the KDF RPC methods the app uses. */

export interface BalanceInfo {
  spendable: string;
  unspendable: string;
}

export interface IguanaWalletBalance {
  wallet_type: 'Iguana';
  address: string;
  /** CoinBalanceMap — keyed by ticker. */
  balance: Record<string, BalanceInfo>;
}

export interface UtxoActivationResult {
  ticker: string;
  current_block: number;
  wallet_balance: IguanaWalletBalance;
}

export type TaskStatus<TOk> =
  | { status: 'Ok'; details: TOk }
  | { status: 'InProgress'; details: unknown }
  | { status: 'UserActionRequired'; details: unknown }
  | { status: 'Error'; details: { error: string; error_type?: string } };

export async function enableUtxoInit(
  ticker: string,
  servers: ElectrumServer[],
): Promise<number> {
  const res = await kdf.rpc2<{ task_id: number }>('task::enable_utxo::init', {
    ticker,
    activation_params: {
      mode: { rpc: 'Electrum', rpc_data: { servers } },
      tx_history: true,
      priv_key_policy: 'ContextPrivKey',
    },
  });
  return res.task_id;
}

export function enableUtxoStatus(
  taskId: number,
): Promise<TaskStatus<UtxoActivationResult>> {
  return kdf.rpc2<TaskStatus<UtxoActivationResult>>('task::enable_utxo::status', {
    task_id: taskId,
    forget_if_finished: false,
  });
}

// --- ZHTLC (PIRATE/ARRR) activation -----------------------------------------

export interface FirstSyncBlock {
  /** Height the client asked to start syncing from. */
  requested: number;
  /** Whether the requested start is before sapling activation. */
  is_pre_sapling: boolean;
  /** Height sync actually started from (clamped to a checkpoint). */
  actual: number;
}

/**
 * ZHTLC activation returns the balance directly (CoinBalanceReport<CoinBalance>),
 * unlike UTXO which keys it by ticker (CoinBalanceMap).
 */
export interface ZIguanaWalletBalance {
  wallet_type: 'Iguana';
  address: string;
  balance: BalanceInfo;
}

export interface ZCoinActivationResult {
  ticker: string;
  current_block: number;
  wallet_balance: ZIguanaWalletBalance;
  first_sync_block?: FirstSyncBlock;
}

/** Where a ZHTLC wallet should start scanning the chain. */
export type SyncStartPoint =
  | 'earliest'
  | { height: number }
  | { date: number };

/**
 * In-progress detail of task::enable_z_coin::status. KDF serializes bare
 * variants as strings ("ActivatingCoin") and data variants as single-key
 * objects ({ UpdatingBlocksCache: { current_scanned_block, latest_block } }).
 */
export type ZCoinProgressDetails =
  | 'ActivatingCoin'
  | 'RequestingWalletBalance'
  | 'Finishing'
  | 'WaitingForTrezorToConnect'
  | 'WaitingForUserToConfirmPubkey'
  | { UpdatingBlocksCache: { current_scanned_block: number; latest_block: number } }
  | { BuildingWalletDb: { current_scanned_block: number; latest_block: number } }
  | { TemporaryError: string };

export async function enableZCoinInit(
  ticker: string,
  electrumServers: ElectrumServer[],
  lightWalletdServers: string[],
  syncParams?: SyncStartPoint,
): Promise<number> {
  const res = await kdf.rpc2<{ task_id: number }>('task::enable_z_coin::init', {
    ticker,
    activation_params: {
      mode: {
        rpc: 'Light',
        rpc_data: {
          electrum_servers: electrumServers,
          light_wallet_d_servers: lightWalletdServers,
          ...(syncParams ? { sync_params: syncParams } : {}),
        },
      },
      // zcash_params_path is unnecessary in WASM — KDF fetches sapling params
      // and caches them in IndexedDB.
      scan_blocks_per_iteration: 1000,
      scan_interval_ms: 0,
    },
  });
  return res.task_id;
}

export function enableZCoinStatus(
  taskId: number,
): Promise<TaskStatus<ZCoinActivationResult>> {
  return kdf.rpc2<TaskStatus<ZCoinActivationResult>>('task::enable_z_coin::status', {
    task_id: taskId,
    forget_if_finished: false,
  });
}

// --- EVM (ETH protocol) activation ------------------------------------------

/**
 * Per-address entry of the iguana `enable_eth_with_tokens` result. KDF's
 * IguanaEthWithTokensActivationResult keys these by address string.
 */
interface EthAddressInfo {
  derivation_method?: { type: string };
  pubkey?: string;
  balances?: BalanceInfo;
}

/**
 * Raw `enable_eth_with_tokens` result. Iguana mode returns the legacy
 * `eth_addresses_infos` map; HD mode returns a `wallet_balance` report. Only
 * iguana is used here, but both are tolerated so a KDF upgrade that switches
 * shapes does not break activation.
 */
interface EthWithTokensActivationResult {
  current_block: number;
  eth_addresses_infos?: Record<string, EthAddressInfo>;
  erc20_addresses_infos?: Record<string, unknown>;
  wallet_balance?: {
    wallet_type: string;
    accounts?: {
      addresses?: { address: string; balance: Record<string, BalanceInfo> }[];
    }[];
  };
}

/** What the store needs out of an EVM activation. */
export interface EvmActivationResult {
  currentBlock: number;
  address: string;
  balance: BalanceInfo;
}

const ZERO_BALANCE: BalanceInfo = { spendable: '0', unspendable: '0' };

function firstEvmAddress(
  ticker: string,
  res: EthWithTokensActivationResult,
): { address: string; balance: BalanceInfo } {
  const iguana = Object.entries(res.eth_addresses_infos ?? {})[0];
  if (iguana) {
    return { address: iguana[0], balance: iguana[1].balances ?? ZERO_BALANCE };
  }
  const hd = res.wallet_balance?.accounts?.[0]?.addresses?.[0];
  if (hd) {
    return { address: hd.address, balance: hd.balance[ticker] ?? ZERO_BALANCE };
  }
  throw new Error(`${ticker}: activation returned no address`);
}

/**
 * Activate an EVM platform coin. Unlike UTXO and ZHTLC this is a single
 * synchronous RPC — there is no task to poll, so activation is instant.
 *
 * `tx_history` is not requested: KDF's ETH history loop is a no-op under WASM,
 * so it would only burn RPC calls. History is fetched from the chain explorer.
 */
export async function enableEthWithTokens(
  ticker: string,
  nodes: EvmNode[],
  swapContractAddress?: string,
  fallbackSwapContract?: string,
): Promise<EvmActivationResult> {
  const res = await kdf.rpc2<EthWithTokensActivationResult>('enable_eth_with_tokens', {
    ticker,
    nodes,
    ...(swapContractAddress ? { swap_contract_address: swapContractAddress } : {}),
    ...(fallbackSwapContract ? { fallback_swap_contract: fallbackSwapContract } : {}),
    erc20_tokens_requests: [],
    tx_history: false,
    get_balances: true,
    // ETH uses its own EthPrivKeyActivationPolicy, an *adjacently* tagged enum
    // (`#[serde(tag = "type", content = "params")]`) — unlike the plain string
    // the UTXO/ZHTLC activations take, and unlike what the API docs show.
    priv_key_policy: { type: 'ContextPrivKey' },
  });
  const { address, balance } = firstEvmAddress(ticker, res);
  return { currentBlock: res.current_block, address, balance };
}

export interface MyBalanceResult {
  coin: string;
  address: string;
  balance: string;
  unspendable_balance: string;
}

/** Legacy my_balance — used as the polling fallback for streamed balances. */
export function myBalance(coin: string): Promise<MyBalanceResult> {
  return kdf.rpc<MyBalanceResult>({ method: 'my_balance', coin });
}

export function getEnabledCoins(): Promise<{ coins: { ticker: string }[] }> {
  return kdf.rpc2<{ coins: { ticker: string }[] }>('get_enabled_coins');
}

/** Deactivate a coin (legacy disable_coin). Needed to re-activate/rescan. */
export function disableCoin(coin: string): Promise<unknown> {
  return kdf.rpc({ method: 'disable_coin', coin });
}

/**
 * KDF's TxFeeDetails is a `type`-tagged union whose payload differs per
 * protocol: UTXO/ZHTLC carry a flat `amount`, while EVM (EthTxFeeDetails)
 * carries gas fields and reports the paid fee as `total_fee`.
 */
export interface UtxoFeeDetails {
  type: 'Utxo' | string;
  coin?: string;
  amount: string;
}

export interface EthFeeDetails {
  type: 'Eth';
  coin: string;
  gas: number;
  gas_price: string;
  max_fee_per_gas?: string;
  max_priority_fee_per_gas?: string;
  total_fee: string;
}

export type FeeDetails = UtxoFeeDetails | EthFeeDetails;

/** The fee actually paid, whichever protocol shape `fee` uses. */
export function feeAmount(fee: FeeDetails | undefined): string {
  if (!fee) return '0';
  if ('total_fee' in fee) return fee.total_fee;
  return fee.amount ?? '0';
}

/** Subset of KDF TransactionDetails the app uses. */
export interface TransactionDetails {
  tx_hex: string;
  tx_hash: string;
  from: string[];
  to: string[];
  total_amount: string;
  spent_by_me: string;
  received_by_me: string;
  my_balance_change: string;
  fee_details: FeeDetails;
  coin: string;
  kmd_rewards?: { amount: string; claimed_by_me: boolean };
  /** Present in my_tx_history / TX_HISTORY stream payloads. */
  internal_id?: string;
  block_height?: number;
  timestamp?: number;
  confirmations?: number;
  transaction_type?: string;
  memo?: string | null;
}

export type WithdrawAmount = { amount: string } | { max: true };

/** Build a signed transaction (not broadcast) moving funds to `to`. */
export function withdraw(
  coin: string,
  to: string,
  amount: WithdrawAmount,
): Promise<TransactionDetails> {
  return kdf.rpc2<TransactionDetails>('withdraw', { coin, to, ...amount });
}

// --- Task-based withdraw (ZHTLC and any coin) -------------------------------

/**
 * ZHTLC coins (ARRR) reject the direct `withdraw` — they must use
 * task::withdraw::init → poll task::withdraw::status. Returns the same
 * TransactionDetails as the direct withdraw once status is Ok. `memo` is
 * optional and shielded-transaction specific.
 */
export async function taskWithdrawInit(
  coin: string,
  to: string,
  amount: WithdrawAmount,
  memo?: string,
): Promise<number> {
  const res = await kdf.rpc2<{ task_id: number }>('task::withdraw::init', {
    coin,
    to,
    ...amount,
    ...(memo ? { memo } : {}),
  });
  return res.task_id;
}

export function taskWithdrawStatus(
  taskId: number,
): Promise<TaskStatus<TransactionDetails>> {
  return kdf.rpc2<TaskStatus<TransactionDetails>>('task::withdraw::status', {
    task_id: taskId,
    forget_if_finished: false,
  });
}

/**
 * Broadcast a signed transaction; returns the txid.
 *
 * EVM hashes come back bare here, without the `0x` — KDF's `send_raw_tx` does
 * `format!("{res:02x}")` and carries a standing TODO about it, while the same
 * hash in `TransactionDetails.tx_hash` (and from the explorer) *is* prefixed.
 * Normalizing at this boundary keeps the txid the app shows and links to
 * identical to the one history will report. UTXO txids are left untouched.
 */
export async function sendRawTransaction(coin: string, txHex: string): Promise<string> {
  const res = await kdf.rpc<{ tx_hash: string }>({
    method: 'send_raw_transaction',
    coin,
    tx_hex: txHex,
  });
  const isEvm = coinByTicker(coin)?.kind === 'evm';
  return isEvm && !res.tx_hash.startsWith('0x') ? `0x${res.tx_hash}` : res.tx_hash;
}

export async function validateAddress(coin: string, address: string): Promise<{
  is_valid: boolean;
  reason?: string;
}> {
  const res = await kdf.rpc<{ result: { is_valid: boolean; reason?: string } }>({
    method: 'validateaddress',
    coin,
    address,
  });
  return res.result;
}

/**
 * Re-case an EVM address to its EIP-55 mixed-case checksum form.
 *
 * KDF validates EVM addresses strictly: both `validateaddress` and `withdraw`
 * run the input through `valid_addr_from_str`/`address_from_str`, which reject
 * anything whose casing doesn't match its checksum — so an all-lowercase
 * address (what many explorers and tools emit, and perfectly legal under
 * EIP-55, which makes the checksum optional) would be refused.
 *
 * `convertaddress` is the escape hatch: its ETH branch parses with
 * `addr_from_str`, which does *not* verify the checksum, then re-emits the
 * address via `checksum_address`. So this canonicalizes any casing.
 */
export async function toChecksumAddress(coin: string, address: string): Promise<string> {
  // `addr_from_str` matches the prefix literally, so a `0X…` paste would fail
  // with a confusing "must be prefixed with 0x".
  const from = address.replace(/^0X/, '0x');
  const res = await kdf.rpc<{ result: { address: string } }>({
    method: 'convertaddress',
    coin,
    from,
    to_address_format: { format: 'mixedcase' },
  });
  return res.result.address;
}

export interface TxHistoryResult {
  coin: string;
  current_block: number;
  transactions: TransactionDetails[];
  sync_status: { state: 'NotEnabled' | 'NotStarted' | 'InProgress' | 'Error' | 'Finished' };
  limit: number;
  skipped: number;
  total: number;
  total_pages: number;
}

/** Paged tx history (requires tx_history: true at activation). */
export function myTxHistory(
  coin: string,
  pageNumber = 1,
  limit = 20,
): Promise<TxHistoryResult> {
  return kdf.rpc2<TxHistoryResult>('my_tx_history', {
    coin,
    limit,
    paging_options: { PageNumber: pageNumber },
  });
}

/**
 * A ZHTLC history item. Differs from TransactionDetails: numeric internal_id,
 * a flat `transaction_fee` (no fee_details), and no tx_hex.
 */
interface ZCoinTxHistoryItem {
  tx_hash: string;
  from: string[];
  to: string[];
  spent_by_me: string;
  received_by_me: string;
  my_balance_change: string;
  block_height: number;
  confirmations: number;
  timestamp: number;
  transaction_fee: string;
  coin: string;
  internal_id: number;
}

interface ZCoinTxHistoryResult {
  coin: string;
  current_block: number;
  transactions: ZCoinTxHistoryItem[];
  sync_status: TxHistoryResult['sync_status'];
  limit: number;
  skipped: number;
  total: number;
  total_pages: number;
}

function normalizeZTx(t: ZCoinTxHistoryItem): TransactionDetails {
  return {
    tx_hex: '',
    tx_hash: t.tx_hash,
    from: t.from,
    to: t.to,
    total_amount: t.received_by_me,
    spent_by_me: t.spent_by_me,
    received_by_me: t.received_by_me,
    my_balance_change: t.my_balance_change,
    fee_details: { type: 'Utxo', coin: t.coin, amount: t.transaction_fee },
    coin: t.coin,
    internal_id: String(t.internal_id),
    block_height: t.block_height,
    timestamp: t.timestamp,
    confirmations: t.confirmations,
  };
}

/**
 * ZHTLC tx history — the standard my_tx_history rejects z-coins with
 * NotSupportedFor, so shielded coins use this dedicated method. The result is
 * normalized to the common TxHistoryResult shape.
 */
export async function zCoinTxHistory(
  coin: string,
  pageNumber = 1,
  limit = 20,
): Promise<TxHistoryResult> {
  const res = await kdf.rpc2<ZCoinTxHistoryResult>('z_coin_tx_history', {
    coin,
    limit,
    paging_options: { PageNumber: pageNumber },
  });
  return { ...res, transactions: res.transactions.map(normalizeZTx) };
}

/** Reveal the wallet's seed phrase; requires the wallet password. */
export async function getMnemonic(walletPassword: string): Promise<string> {
  const res = await kdf.rpc2<{ format: string; mnemonic: string }>('get_mnemonic', {
    format: 'plaintext',
    password: walletPassword,
  });
  return res.mnemonic;
}

/**
 * The wallet's internal secp256k1 public key — one per wallet, independent of
 * any coin, available as soon as a session is open. Used as the identicon seed.
 */
export async function getPublicKey(): Promise<string> {
  const res = await kdf.rpc2<{ public_key: string }>('get_public_key');
  return res.public_key;
}

export async function kdfVersion(): Promise<string> {
  const res = await kdf.rpc<{ result: string }>({ method: 'version' });
  return res.result;
}

/** client_id defaults to 0 = the KDF wasm SharedWorker client. */
export function streamBalanceEnable(coin: string): Promise<{ streamer_id: string }> {
  return kdf.rpc2<{ streamer_id: string }>('stream::balance::enable', { coin });
}

export function streamTxHistoryEnable(coin: string): Promise<{ streamer_id: string }> {
  return kdf.rpc2<{ streamer_id: string }>('stream::tx_history::enable', { coin });
}
