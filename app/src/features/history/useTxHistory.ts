import { useCallback, useEffect, useRef, useState } from 'react';
import { myTxHistory, type TransactionDetails } from '../../kdf/methods';
import { subscribeKdfEvents } from '../../kdf/streaming';

const PAGE_SIZE = 20;
const SYNC_POLL_MS = 3000;

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

  const refetchHead = useCallback(async () => {
    const res = await myTxHistory(ticker, 1, PAGE_SIZE);
    setSyncing(res.sync_status.state === 'InProgress' || res.sync_status.state === 'NotStarted');
    setTxs((prev) => mergeTxs(prev, res.transactions, 'head'));
    setHasMore(res.total_pages > pageRef.current);
    return res;
  }, [ticker]);

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

  // Live updates from the event stream.
  useEffect(() => {
    // Exact-match guard: with prefix matching alone, TX_HISTORY:KMD would also
    // receive TX_HISTORY:KMDCL events.
    const unsubTx = subscribeKdfEvents(`TX_HISTORY:${ticker}`, (event) => {
      if (event.type !== `TX_HISTORY:${ticker}`) return;
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
  }, [ticker, refetchHead]);

  const loadMore = useCallback(() => {
    const nextPage = pageRef.current + 1;
    void myTxHistory(ticker, nextPage, PAGE_SIZE)
      .then((res) => {
        pageRef.current = nextPage;
        setTxs((prev) => mergeTxs(prev, res.transactions, 'tail'));
        setHasMore(res.total_pages > nextPage);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [ticker]);

  return { txs, loading, syncing, error, hasMore, loadMore };
}
