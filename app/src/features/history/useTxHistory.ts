import { useCallback, useEffect, useRef, useState } from 'react';
import { coinByTicker } from '../../config/coins';
import { evmTxHistory } from '../../kdf/evmHistory';
import { myTxHistory, zCoinTxHistory, type TransactionDetails } from '../../kdf/methods';
import { subscribeKdfEvents } from '../../kdf/streaming';
import { usePortfolioStore } from '../../store/portfolio';

const PAGE_SIZE = 20;
const SYNC_POLL_MS = 3000;
/**
 * EVM history has no stream to ride: KDF exposes no tx-history streamer for
 * ETH coins, and the balance streamer only fires when the balance changes — so
 * confirmation counts would freeze. Re-read the head on a timer instead.
 */
const EVM_REFRESH_MS = 30_000;

const txKey = (tx: TransactionDetails) => tx.internal_id ?? tx.tx_hash;

/**
 * Merge `incoming` into `list`, replacing entries with the same id in place.
 * Unseen transactions are prepended (`head` — fresh txs from the stream) or
 * appended (`tail` — older txs from pagination).
 */
function mergeTxs(
  list: TransactionDetails[],
  incoming: TransactionDetails[],
  mode: 'head' | 'tail',
): TransactionDetails[] {
  const byKey = new Map(list.map((tx) => [txKey(tx), tx]));
  const newOnes: TransactionDetails[] = [];
  for (const tx of incoming) {
    if (byKey.has(txKey(tx))) {
      byKey.set(txKey(tx), tx);
    } else {
      newOnes.push(tx);
    }
  }
  const updated = list.map((tx) => byKey.get(txKey(tx))!);
  if (mode === 'tail') return [...updated, ...newOnes];
  return [...newOnes.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)), ...updated];
}

export interface TxHistoryState {
  txs: TransactionDetails[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Paged tx history for one coin with live updates:
 * - TX_HISTORY:<coin> stream events prepend fresh transactions;
 * - BALANCE:<coin> events (and sync-in-progress) trigger a page-1 refetch so
 *   confirmation counts stay reasonably fresh.
 */
export function useTxHistory(ticker: string): TxHistoryState {
  const [txs, setTxs] = useState<TransactionDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);

  const coin = coinByTicker(ticker);
  // ZHTLC coins reject my_tx_history (NotSupportedFor) — they use
  // z_coin_tx_history. EVM coins have no KDF history at all under WASM and are
  // served from the chain explorer, which needs the wallet address.
  const isZhtlc = coin?.kind === 'zhtlc';
  const isEvm = coin?.kind === 'evm';
  const address = usePortfolioStore((s) => s.coins[ticker]?.address ?? null);

  const fetchPage = useCallback(
    (page: number) => {
      if (isEvm) {
        if (!coin || !address) {
          return Promise.reject(new Error(`${ticker} is not activated yet`));
        }
        return evmTxHistory(coin, address, page, PAGE_SIZE);
      }
      return isZhtlc
        ? zCoinTxHistory(ticker, page, PAGE_SIZE)
        : myTxHistory(ticker, page, PAGE_SIZE);
    },
    [ticker, coin, isZhtlc, isEvm, address],
  );

  const refetchHead = useCallback(async () => {
    const res = await fetchPage(1);
    setSyncing(res.sync_status.state === 'InProgress' || res.sync_status.state === 'NotStarted');
    setTxs((prev) => mergeTxs(prev, res.transactions, 'head'));
    // The explorer reports no total count, so an EVM page-1 result can only say
    // "there is at least a page 2" — it must not retract a `hasMore` that
    // paging past page 1 already established.
    setHasMore((prev) =>
      isEvm && pageRef.current > 1 ? prev : res.total_pages > pageRef.current,
    );
    return res;
  }, [fetchPage, isEvm]);

  // Initial load + poll while KDF is still syncing history in the background.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    pageRef.current = 1;
    setTxs([]);
    setLoading(true);
    setError(null);

    const tick = async () => {
      try {
        const res = await refetchHead();
        if (cancelled) return;
        setLoading(false);
        const stillSyncing =
          res.sync_status.state === 'InProgress' || res.sync_status.state === 'NotStarted';
        if (stillSyncing) timer = setTimeout(() => void tick(), SYNC_POLL_MS);
      } catch (e) {
        if (cancelled) return;
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refetchHead]);

  // EVM: keep confirmations moving with a periodic head re-read.
  useEffect(() => {
    if (!isEvm) return;
    const timer = setInterval(() => void refetchHead().catch(() => {}), EVM_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isEvm, refetchHead]);

  // Live updates from the event stream.
  useEffect(() => {
    // Exact-match guard: with prefix matching alone, TX_HISTORY:KMD would also
    // receive TX_HISTORY:KMDCL events.
    const unsubTx = subscribeKdfEvents(`TX_HISTORY:${ticker}`, (event) => {
      if (event.type !== `TX_HISTORY:${ticker}`) return;
      // ZHTLC stream payloads differ from z_coin_tx_history — refetch the head
      // rather than prepend a mismatched shape. UTXO can prepend directly.
      if (isZhtlc) {
        void refetchHead().catch(() => {});
        return;
      }
      const tx = event.message as TransactionDetails;
      if (tx?.tx_hash) setTxs((prev) => mergeTxs(prev, [tx], 'head'));
    });
    const unsubBalance = subscribeKdfEvents(`BALANCE:${ticker}`, (event) => {
      if (event.type !== `BALANCE:${ticker}`) return;
      void refetchHead().catch(() => {});
    });
    return () => {
      unsubTx();
      unsubBalance();
    };
  }, [ticker, isZhtlc, refetchHead]);

  const loadMore = useCallback(() => {
    const nextPage = pageRef.current + 1;
    void fetchPage(nextPage)
      .then((res) => {
        pageRef.current = nextPage;
        setTxs((prev) => mergeTxs(prev, res.transactions, 'tail'));
        setHasMore(res.total_pages > nextPage);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [fetchPage]);

  return { txs, loading, syncing, error, hasMore, loadMore };
}
