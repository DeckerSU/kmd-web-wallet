import { kdf } from './client';
import type { ElectrumServer } from '../config/coins';

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

export interface ZCoinActivationResult {
  ticker: string;
  current_block: number;
  wallet_balance: IguanaWalletBalance;
}

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

export interface ZCoinSyncParams {
  height?: number;
  date?: number;
}

export async function enableZCoinInit(
  ticker: string,
  electrumServers: ElectrumServer[],
  lightWalletdServers: string[],
  syncParams?: ZCoinSyncParams | 'earliest',
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

export interface FeeDetails {
  type: string;
  coin?: string;
  amount: string;
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

/** Broadcast a signed transaction; returns the txid. */
export async function sendRawTransaction(coin: string, txHex: string): Promise<string> {
  const res = await kdf.rpc<{ tx_hash: string }>({
    method: 'send_raw_transaction',
    coin,
    tx_hex: txHex,
  });
  return res.tx_hash;
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

/** Reveal the wallet's seed phrase; requires the wallet password. */
export async function getMnemonic(walletPassword: string): Promise<string> {
  const res = await kdf.rpc2<{ format: string; mnemonic: string }>('get_mnemonic', {
    format: 'plaintext',
    password: walletPassword,
  });
  return res.mnemonic;
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
