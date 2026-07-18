import { useState } from 'react';
import { Alert, Button, Modal, Spinner } from '../../components/ui';
import { coinByTicker } from '../../config/coins';
import type { TransactionDetails } from '../../kdf/methods';
import { formatAmount, shortenAddress } from '../../lib/format';
import { useTxHistory } from './useTxHistory';

export default function TxHistoryList({ ticker }: { ticker: string }) {
  const { txs, loading, syncing, error, hasMore, loadMore } = useTxHistory(ticker);
  const [selected, setSelected] = useState<TransactionDetails | null>(null);
  const requiredConf = coinByTicker(ticker)?.config.required_confirmations ?? 1;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-400">Transactions</h2>
        {syncing && <span className="text-xs text-amber-400">Syncing history…</span>}
      </div>

      {loading && <Spinner label="Loading history…" />}
      {error && <Alert kind="error">{error}</Alert>}
      {!loading && !error && txs.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500">No transactions yet.</p>
      )}

      <ul className="divide-y divide-zinc-800/70">
        {txs.map((tx) => (
          <TxRow
            key={tx.internal_id ?? tx.tx_hash}
            tx={tx}
            requiredConf={requiredConf}
            onClick={() => setSelected(tx)}
          />
        ))}
      </ul>

      {hasMore && (
        <div className="mt-4 text-center">
          <Button variant="ghost" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}

      {selected && (
        <TxDetailsModal
          tx={selected}
          ticker={ticker}
          requiredConf={requiredConf}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function txMeta(tx: TransactionDetails) {
  const change = Number(tx.my_balance_change);
  const incoming = change >= 0;
  return {
    incoming,
    label: incoming ? 'Received' : 'Sent',
    sign: incoming ? '+' : '',
    color: incoming ? 'text-emerald-400' : 'text-zinc-200',
  };
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Pending';
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function TxRow(props: {
  tx: TransactionDetails;
  requiredConf: number;
  onClick: () => void;
}) {
  const { tx, requiredConf } = props;
  const meta = txMeta(tx);
  const conf = tx.confirmations ?? 0;
  const pending = conf < requiredConf;

  return (
    <li>
      <button
        onClick={props.onClick}
        className="flex w-full items-center gap-3 px-1 py-3 text-left transition hover:bg-zinc-800/40"
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${
            meta.incoming ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          {meta.incoming ? '↓' : '↑'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {meta.label}
            {pending && (
              <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                {conf === 0 ? 'PENDING' : `${conf}/${requiredConf} CONF`}
              </span>
            )}
          </span>
          <span className="block text-xs text-zinc-500">{formatDate(tx.timestamp)}</span>
        </span>
        <span className={`text-sm font-semibold tabular-nums ${meta.color}`}>
          {meta.sign}
          {formatAmount(tx.my_balance_change)} {tx.coin}
        </span>
      </button>
    </li>
  );
}

function TxDetailsModal(props: {
  tx: TransactionDetails;
  ticker: string;
  requiredConf: number;
  onClose: () => void;
}) {
  const { tx, ticker } = props;
  const meta = txMeta(tx);
  const conf = tx.confirmations ?? 0;
  const explorerTxUrl = coinByTicker(ticker)?.explorerTxUrl;
  const counterparties = meta.incoming
    ? tx.from
    : tx.to.filter((a) => !tx.from.includes(a));

  return (
    <Modal title={`${meta.label} ${ticker}`} onClose={props.onClose}>
      <div className="space-y-3">
        <p className={`text-center text-2xl font-semibold tabular-nums ${meta.color}`}>
          {meta.sign}
          {formatAmount(tx.my_balance_change)} {tx.coin}
        </p>
        <p className="text-center text-xs text-zinc-500">{formatDate(tx.timestamp)}</p>

        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <DetailRow
            label="Status"
            value={
              conf >= props.requiredConf
                ? `Confirmed (${conf})`
                : conf > 0
                  ? `Confirming ${conf}/${props.requiredConf}`
                  : 'Pending'
            }
          />
          <DetailRow
            label={meta.incoming ? 'From' : 'To'}
            value={(counterparties.length ? counterparties : tx.to).map(shortenAddress).join(', ')}
            mono
          />
          <DetailRow
            label="Fee"
            value={`${formatAmount(tx.fee_details.amount)} ${tx.fee_details.coin ?? ticker}`}
          />
          {tx.block_height ? <DetailRow label="Block" value={String(tx.block_height)} /> : null}
          <DetailRow label="Txid" value={shortenAddress(tx.tx_hash, 10)} mono />
        </div>

        {explorerTxUrl && (
          <a
            href={explorerTxUrl(tx.tx_hash)}
            target="_blank"
            rel="noreferrer"
            className="block text-center text-sm text-emerald-400 transition hover:text-emerald-300"
          >
            View in explorer ↗
          </a>
        )}
      </div>
    </Modal>
  );
}

function DetailRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-xs text-zinc-500">{props.label}</span>
      <span
        className={`break-all text-right text-xs text-zinc-300 ${props.mono ? 'font-mono' : ''}`}
      >
        {props.value}
      </span>
    </div>
  );
}
