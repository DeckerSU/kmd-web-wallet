import { useState } from 'react';
import { Alert, Button, TextField } from '../../components/ui';
import type { SyncStartPoint } from '../../kdf/methods';
import type { CoinState } from '../../store/portfolio';
import { usePortfolioStore } from '../../store/portfolio';

type Mode = 'default' | 'earliest' | 'date' | 'height';

function describeStart(point: SyncStartPoint | undefined): string {
  if (point === undefined) return 'Default (resume, ~last day if new)';
  if (point === 'earliest') return 'Earliest (sapling activation — full history)';
  if ('height' in point) return `From block ${point.height}`;
  return `From ${new Date(point.date * 1000).toLocaleDateString()}`;
}

/**
 * ZHTLC sync controls: shows the wallet's chain-sync start point and current
 * synced height, and lets the user rewind & re-scan from a chosen point.
 * The visible transaction history is bounded by this start point, so a full
 * rescan ("Earliest") is what surfaces older transactions.
 */
export default function SyncPanel({ coin }: { coin: CoinState }) {
  const rescanCoin = usePortfolioStore((s) => s.rescanCoin);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('earliest');
  const [date, setDate] = useState('');
  const [height, setHeight] = useState('');
  const [confirming, setConfirming] = useState(false);

  const sync = coin.sync;
  const busy = coin.status === 'activating';

  const startPoint = (): SyncStartPoint | undefined => {
    switch (mode) {
      case 'default':
        return undefined;
      case 'earliest':
        return 'earliest';
      case 'date':
        return { date: Math.floor(new Date(date).getTime() / 1000) };
      case 'height':
        return { height: Number(height) };
    }
  };

  const canRescan =
    !busy &&
    (mode === 'default' ||
      mode === 'earliest' ||
      (mode === 'date' && !!date) ||
      (mode === 'height' && Number(height) > 0));

  const doRescan = () => {
    setConfirming(false);
    setOpen(false);
    void rescanCoin(coin.ticker, startPoint());
  };

  return (
    <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-zinc-300">Chain sync</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-zinc-400 transition hover:text-emerald-400"
        >
          {open ? 'Hide' : 'Rescan…'}
        </button>
      </div>

      <dl className="mt-2 space-y-1 text-xs text-zinc-500">
        <Row label="Start point" value={describeStart(sync?.startOverride)} />
        {sync?.firstSyncBlock && (
          <Row label="Synced from block" value={String(sync.firstSyncBlock.actual)} />
        )}
        {sync?.currentBlock != null && (
          <Row label="Chain tip" value={String(sync.currentBlock)} />
        )}
        {busy && coin.progress && (
          <Row
            label="Status"
            value={`${coin.progress.label}${
              coin.progress.percent != null ? ` ${coin.progress.percent}%` : ''
            }`}
          />
        )}
      </dl>

      {open && (
        <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
          <p className="text-xs text-zinc-500">
            Rewind and re-scan the chain from a new point. Older transactions only appear
            if the wallet scanned their blocks. A full rescan can take a while.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Rescan from</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            >
              <option value="earliest">Earliest (full history)</option>
              <option value="date">From date</option>
              <option value="height">From block height</option>
              <option value="default">Default (resume / last day)</option>
            </select>
          </label>
          {mode === 'date' && (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          )}
          {mode === 'height' && (
            <TextField label="" value={height} onChange={setHeight} placeholder="Block height" />
          )}

          {confirming ? (
            <div className="space-y-2">
              <Alert kind="warning">
                This rewinds the local wallet data and re-scans. It can take several minutes.
              </Alert>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" onClick={doRescan}>
                  Rescan now
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              disabled={!canRescan}
              onClick={() => setConfirming(true)}
            >
              Rescan
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="text-right text-zinc-400">{value}</dd>
    </div>
  );
}
