import { useEffect, useState } from 'react';
import kmdIcon from '../../assets/coins/kmd.png';
import kmdclIcon from '../../assets/coins/kmdcl.png';
import { Alert, Button, Card, Spinner } from '../../components/ui';
import { coinByTicker } from '../../config/coins';
import { formatAmount, shortenAddress } from '../../lib/format';
import { useAuthStore } from '../../store/auth';
import { usePortfolioStore, type CoinState } from '../../store/portfolio';
import AboutModal from '../about/AboutModal';
import SettingsModal from '../settings/SettingsModal';
import CoinDetail from './CoinDetail';

const COIN_ICONS: Record<string, string> = { KMD: kmdIcon, KMDCL: kmdclIcon };
const COIN_LABELS: Record<string, string> = { KMD: 'Komodo', KMDCL: 'KomodoClassic' };

export default function Dashboard() {
  const { walletName, logout, justCreated, dismissBackupReminder } = useAuthStore();
  const { coins, activateAll, reset } = usePortfolioStore();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    void activateAll();
  }, [activateAll]);

  const handleLogout = () => {
    reset();
    void logout();
  };

  const selected = selectedTicker ? coins[selectedTicker] : null;

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
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setAboutOpen(true)} ariaLabel="About">
            ?
          </Button>
          <Button variant="ghost" onClick={() => setSettingsOpen(true)} ariaLabel="Settings">
            ⚙
          </Button>
          <Button variant="ghost" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {justCreated && (
        <BackupReminder
          onBackup={() => {
            dismissBackupReminder();
            setSettingsOpen(true);
          }}
          onDismiss={dismissBackupReminder}
        />
      )}

      {selected ? (
        <CoinDetail coin={selected} onBack={() => setSelectedTicker(null)} />
      ) : (
        <div className="space-y-4">
          {Object.values(coins).map((coin) => (
            <CoinCard
              key={coin.ticker}
              coin={coin}
              onOpen={() => coin.status === 'active' && setSelectedTicker(coin.ticker)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BackupReminder({
  onBackup,
  onDismiss,
}: {
  onBackup: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-base leading-none">⚠</span>
        <div className="flex-1">
          <p className="font-medium">Back up your wallet</p>
          <p className="mt-0.5 text-amber-300/80">
            Your seed phrase is the only way to recover this wallet. Write it down and store it
            offline — you can view it any time from Settings.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={onBackup}>
              Back up now
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoinCard({ coin, onOpen }: { coin: CoinState; onOpen: () => void }) {
  const { activateCoin } = usePortfolioStore();
  const [copied, setCopied] = useState(false);

  const copyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!coin.address) return;
    void navigator.clipboard.writeText(coin.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const clickable = coin.status === 'active';

  return (
    <Card
      className={`!p-5 transition ${clickable ? 'cursor-pointer hover:border-emerald-500/40' : ''}`}
    >
      <div
        className="flex items-center gap-4"
        onClick={onOpen}
        role={clickable ? 'button' : undefined}
        aria-label={clickable ? `Open ${coin.ticker}` : undefined}
      >
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
              className="mt-0.5 whitespace-nowrap font-mono text-xs text-zinc-500 transition hover:text-emerald-400"
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
          {clickable && <span className="ml-2 align-middle text-zinc-600">›</span>}
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
