import { useState } from 'react';
import { BackLink, Button, Card } from '../../components/ui';
import { formatAmount } from '../../lib/format';
import type { CoinState } from '../../store/portfolio';
import TxHistoryList from '../history/TxHistoryList';
import ReceiveModal from '../receive/ReceiveModal';
import SendModal from '../send/SendModal';
import { COIN_ICONS, COIN_LABELS } from './coinVisuals';
import SyncPanel from './SyncPanel';

export default function CoinDetail(props: { coin: CoinState; onBack: () => void }) {
  const { coin } = props;
  const [modal, setModal] = useState<'send' | 'receive' | null>(null);
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (!coin.address) return;
    void navigator.clipboard.writeText(coin.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div>
      <BackLink onClick={props.onBack}>Portfolio</BackLink>

      <Card className="mb-6">
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <img src={COIN_ICONS[coin.ticker]} alt={coin.ticker} className="h-14 w-14 rounded-full" />
          <p className="text-sm text-zinc-500">{COIN_LABELS[coin.ticker] ?? coin.ticker}</p>
          <p className="text-3xl font-semibold tabular-nums">
            {formatAmount(coin.balance?.spendable)}{' '}
            <span className="text-lg font-normal text-zinc-500">{coin.ticker}</span>
          </p>
          {coin.balance && Number(coin.balance.unspendable) > 0 && (
            <p className="text-xs text-zinc-500">
              + {formatAmount(coin.balance.unspendable)} unspendable
            </p>
          )}
          {coin.address && (
            <button
              onClick={copyAddress}
              title={coin.address}
              className="break-all font-mono text-xs text-zinc-500 transition hover:text-emerald-400"
            >
              {copied ? 'Copied ✓' : coin.address}
            </button>
          )}
          <div className="mt-3 flex w-full max-w-xs gap-2">
            <Button className="flex-1" onClick={() => setModal('send')}>
              Send
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setModal('receive')}>
              Receive
            </Button>
          </div>
        </div>
      </Card>

      {coin.sync && <SyncPanel coin={coin} />}

      <TxHistoryList ticker={coin.ticker} />

      {modal === 'receive' && coin.address && (
        <ReceiveModal ticker={coin.ticker} address={coin.address} onClose={() => setModal(null)} />
      )}
      {modal === 'send' && (
        <SendModal
          ticker={coin.ticker}
          spendable={coin.balance?.spendable ?? '0'}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
