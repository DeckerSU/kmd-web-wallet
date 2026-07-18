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

/** client_id defaults to 0 = the KDF wasm SharedWorker client. */
export function streamBalanceEnable(coin: string): Promise<{ streamer_id: string }> {
  return kdf.rpc2<{ streamer_id: string }>('stream::balance::enable', { coin });
}

export function streamTxHistoryEnable(coin: string): Promise<{ streamer_id: string }> {
  return kdf.rpc2<{ streamer_id: string }>('stream::tx_history::enable', { coin });
}
