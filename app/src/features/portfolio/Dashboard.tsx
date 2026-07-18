import { useEffect, useState } from 'react';
import kmdIcon from '../../assets/coins/kmd.png';
import kmdclIcon from '../../assets/coins/kmdcl.png';
import { Alert, Button, Card, Spinner } from '../../components/ui';
import { coinByTicker } from '../../config/coins';
import { formatAmount, shortenAddress } from '../../lib/format';
import { useAuthStore } from '../../store/auth';
import { usePortfolioStore, type CoinState } from '../../store/portfolio';

const COIN_ICONS: Record<string, string> = { KMD: kmdIcon, KMDCL: kmdclIcon };
const COIN_LABELS: Record<string, string> = { KMD: 'Komodo', KMDCL: 'KomodoClassic' };

export default function Dashboard() {
  const { walletName, logout } = useAuthStore();
  const { coins, activateAll, reset } = usePortfolioStore();

  useEffect(() => {
    void activateAll();
  }, [activateAll]);

  const handleLogout = () => {
    reset();
    void logout();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-lg font-black text-emerald-950">
            K
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">{walletName}</h1>
            <p className="text-xs text-zinc-500">Iguana wallet</p>
          </div>
        </div>
        <Button variant="ghost" onClick={handleLogout}>
          Log out
        </Button>
      </header>

      <div className="space-y-4">
        {Object.values(coins).map((coin) => (
          <CoinCard key={coin.ticker} coin={coin} />
        ))}
      </div>
    </div>
  );
}

function CoinCard({ coin }: { coin: CoinState }) {
  const { activateCoin } = usePortfolioStore();
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (!coin.address) return;
    void navigator.clipboard.writeText(coin.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Card className="!p-5">
      <div className="flex items-center gap-4">
        <img
          src={COIN_ICONS[coin.ticker]}
          alt={coin.ticker}
          className="h-11 w-11 shrink-0 rounded-full"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">{coin.ticker}</span>
            <span className="truncate text-xs text-zinc-500">
              {COIN_LABELS[coin.ticker] ?? coin.ticker}
            </span>
          </div>
          {coin.address && (
            <button
              onClick={copyAddress}
              title={coin.address}
              className="mt-0.5 font-mono text-xs text-zinc-500 transition hover:text-emerald-400"
            >
              {copied ? 'Copied ✓' : shortenAddress(coin.address)}
            </button>
          )}
        </div>
        <div className="text-right">
          {coin.status === 'activating' && <Spinner label="Activating…" />}
          {coin.status === 'active' && (
            <>
              <div className="text-lg font-semibold tabular-nums">
                {formatAmount(coin.balance?.spendable)}{' '}
                <span className="text-sm font-normal text-zinc-500">{coin.ticker}</span>
              </div>
              {coin.balance && Number(coin.balance.unspendable) > 0 && (
                <div className="text-xs text-zinc-500">
                  + {formatAmount(coin.balance.unspendable)} unspendable
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {coin.status === 'error' && (
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1">
            <Alert kind="error">{coin.error}</Alert>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              const wc = coinByTicker(coin.ticker);
              if (wc) void activateCoin(wc);
            }}
          >
            Retry
          </Button>
        </div>
      )}
    </Card>
  );
}
