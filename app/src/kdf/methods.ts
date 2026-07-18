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

/** client_id defaults to 0 = the KDF wasm SharedWorker client. */
export function streamBalanceEnable(coin: string): Promise<{ streamer_id: string }> {
  return kdf.rpc2<{ streamer_id: string }>('stream::balance::enable', { coin });
}

export function streamTxHistoryEnable(coin: string): Promise<{ streamer_id: string }> {
  return kdf.rpc2<{ streamer_id: string }>('stream::tx_history::enable', { coin });
}
