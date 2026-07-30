import type { WalletCoin } from '../config/coins';
import type { TransactionDetails, TxHistoryResult } from './methods';

/**
 * Transaction history for EVM coins, read from a Blockscout explorer.
 *
 * KDF cannot supply this in the browser: its ETH history loop is compiled out
 * under wasm32 ("Transaction history is not supported for ETH/ERC20 coins"),
 * EthCoin implements neither CoinWithTxHistoryV2 (so `my_tx_history` rejects
 * it) nor a tx-history streamer (`stream::tx_history::enable` answers
 * CoinNotSupported). The reference Flutter wallet solves this the same way,
 * with an explorer-backed history strategy.
 *
 * Blockscout exposes an Etherscan-compatible endpoint with `page`/`offset`
 * paging and `Access-Control-Allow-Origin: *`, so the page can call it
 * directly, and the result is normalized into KDF's TransactionDetails shape
 * so the rest of the app stays protocol-agnostic.
 */

/** One `action=txlist` row. Every numeric field arrives as a decimal string. */
interface EtherscanTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasUsed: string;
  gasPrice: string;
  blockNumber: string;
  timeStamp: string;
  confirmations: string;
  isError: string;
  txreceipt_status?: string;
  nonce: string;
}

interface EtherscanTxListResponse {
  status: string;
  message: string;
  result: EtherscanTx[] | string;
}

/**
 * Render a base-unit integer as a decimal string with `decimals` places.
 * Uses BigInt throughout — wei values overflow double precision.
 */
function fromBaseUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(decimals + 1, '0');
  const int = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

const toBigInt = (value: string | undefined): bigint => {
  try {
    return BigInt(value ?? '0');
  } catch {
    return 0n;
  }
};

/**
 * Map an explorer row onto TransactionDetails from `myAddress`'s point of view.
 *
 * A failed transaction (`isError === '1'`) still burns gas but moves no value,
 * so only the fee is counted against the balance. `tx_hex` stays empty: the
 * explorer does not return raw transactions and nothing in the app rebroadcasts
 * a historical one.
 */
function normalizeTx(
  tx: EtherscanTx,
  ticker: string,
  decimals: number,
  myAddress: string,
): TransactionDetails {
  const me = myAddress.toLowerCase();
  const from = tx.from?.toLowerCase() ?? '';
  const to = tx.to?.toLowerCase() ?? '';
  const failed = tx.isError === '1';

  const value = failed ? 0n : toBigInt(tx.value);
  // Fees are always paid in the platform coin, which always has 18 decimals.
  const fee = toBigInt(tx.gasUsed) * toBigInt(tx.gasPrice);

  const sentByMe = from === me;
  const receivedByMe = to === me;

  // A self-send nets out to just the fee; the sender always pays gas.
  const spent = sentByMe ? value + fee : 0n;
  const received = receivedByMe ? value : 0n;

  return {
    tx_hex: '',
    tx_hash: tx.hash,
    from: [tx.from],
    to: [tx.to],
    total_amount: fromBaseUnits(value, decimals),
    spent_by_me: fromBaseUnits(spent, decimals),
    received_by_me: fromBaseUnits(received, decimals),
    my_balance_change: fromBaseUnits(received - spent, decimals),
    fee_details: {
      type: 'Eth',
      coin: ticker,
      gas: Number(tx.gas ?? 0),
      gas_price: fromBaseUnits(toBigInt(tx.gasPrice), 18),
      total_fee: fromBaseUnits(fee, 18),
    },
    coin: ticker,
    internal_id: tx.hash,
    block_height: Number(tx.blockNumber),
    timestamp: Number(tx.timeStamp),
    confirmations: Number(tx.confirmations),
    transaction_type: failed ? 'Failed' : undefined,
  };
}

/**
 * Fetch one page of EVM history. Mirrors `myTxHistory`'s contract so the
 * history hook can treat both identically.
 *
 * The endpoint reports no total count, so `total_pages` is inferred: a full
 * page implies at least one more. An exhausted page answers `status: '0'` with
 * an empty `result`, which reads as "no more" rather than an error.
 */
export async function evmTxHistory(
  coin: WalletCoin,
  address: string,
  pageNumber = 1,
  limit = 20,
): Promise<TxHistoryResult> {
  const ticker = coin.config.coin;
  if (!coin.historyApiBase) {
    throw new Error(`${ticker}: no explorer configured for transaction history`);
  }

  const url = new URL('/api', coin.historyApiBase);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('page', String(pageNumber));
  url.searchParams.set('offset', String(limit));

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Explorer request failed (${res.status})`);
  }
  const body = (await res.json()) as EtherscanTxListResponse;

  // `result` is a string carrying the error message when status is not '1',
  // except for the benign "no transactions found" case (an empty array).
  const rows = Array.isArray(body.result) ? body.result : [];
  if (body.status !== '1' && !Array.isArray(body.result)) {
    throw new Error(body.message || 'Explorer returned an error');
  }

  const transactions = rows.map((tx) => normalizeTx(tx, ticker, coin.decimals, address));
  const skipped = (pageNumber - 1) * limit;

  return {
    coin: ticker,
    // Chain tip, derived from the newest transaction's own confirmation count.
    current_block: rows.length
      ? Number(rows[0].blockNumber) + Number(rows[0].confirmations)
      : 0,
    transactions,
    sync_status: { state: 'Finished' },
    limit,
    skipped,
    total: skipped + transactions.length,
    total_pages: transactions.length === limit ? pageNumber + 1 : pageNumber,
  };
}
