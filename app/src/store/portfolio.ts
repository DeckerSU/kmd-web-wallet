import { create } from 'zustand';
import { WALLET_COINS, type WalletCoin } from '../config/coins';
import {
  enableUtxoInit,
  enableUtxoStatus,
  enableZCoinInit,
  enableZCoinStatus,
  myBalance,
  streamBalanceEnable,
  streamTxHistoryEnable,
  type BalanceInfo,
  type IguanaWalletBalance,
  type ZCoinProgressDetails,
} from '../kdf/methods';
import { subscribeKdfEvents, type Unsubscribe } from '../kdf/streaming';

const UTXO_ACTIVATION_TIMEOUT_MS = 120_000;
// ZHTLC first activation downloads ~50 MB params and scans the chain; allow long.
const ZHTLC_ACTIVATION_TIMEOUT_MS = 30 * 60_000;
const ACTIVATION_POLL_MS = 500;
const BALANCE_POLL_MS = 30_000;

export type CoinStatus = 'idle' | 'activating' | 'active' | 'error';

export interface ActivationProgress {
  label: string;
  /** 0–100, or null when the stage has no measurable progress. */
  percent: number | null;
}

export interface CoinState {
  ticker: string;
  status: CoinStatus;
  address: string | null;
  balance: BalanceInfo | null;
  error: string | null;
  /** ZHTLC activation is slow — surfaced to the UI. Null for instant coins. */
  progress: ActivationProgress | null;
}

interface PortfolioState {
  coins: Record<string, CoinState>;
  activateAll: () => Promise<void>;
  activateCoin: (coin: WalletCoin) => Promise<void>;
  refreshBalances: () => Promise<void>;
  reset: () => void;
}

const initialCoins = (): Record<string, CoinState> =>
  Object.fromEntries(
    WALLET_COINS.map((c) => [
      c.config.coin,
      {
        ticker: c.config.coin,
        status: 'idle' as CoinStatus,
        address: null,
        balance: null,
        error: null,
        progress: null,
      },
    ]),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map a ZHTLC status detail to a user-facing progress line. */
function zProgress(details: ZCoinProgressDetails): ActivationProgress {
  const pct = (cur: number, latest: number) =>
    latest > 0 ? Math.min(100, Math.round((cur / latest) * 100)) : null;

  if (typeof details === 'string') {
    switch (details) {
      case 'ActivatingCoin':
        return { label: 'Activating…', percent: null };
      case 'RequestingWalletBalance':
        return { label: 'Reading balance…', percent: null };
      case 'Finishing':
        return { label: 'Finishing…', percent: null };
      default:
        return { label: details, percent: null };
    }
  }
  if ('UpdatingBlocksCache' in details) {
    const { current_scanned_block, latest_block } = details.UpdatingBlocksCache;
    return { label: 'Downloading blocks', percent: pct(current_scanned_block, latest_block) };
  }
  if ('BuildingWalletDb' in details) {
    const { current_scanned_block, latest_block } = details.BuildingWalletDb;
    return { label: 'Scanning blocks', percent: pct(current_scanned_block, latest_block) };
  }
  if ('TemporaryError' in details) {
    return { label: `Retrying: ${details.TemporaryError}`, percent: null };
  }
  return { label: 'Activating…', percent: null };
}

/** Session-scoped subscriptions/timers, torn down in reset(). */
let unsubscribeEvents: Unsubscribe | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export const usePortfolioStore = create<PortfolioState>((set, get) => {
  const patchCoin = (ticker: string, patch: Partial<CoinState>) =>
    set((s) => ({ coins: { ...s.coins, [ticker]: { ...s.coins[ticker], ...patch } } }));

  const finishActivation = (ticker: string, wallet: IguanaWalletBalance) => {
    patchCoin(ticker, {
      status: 'active',
      address: wallet.address,
      balance: wallet.balance[ticker] ?? null,
      progress: null,
    });
  };

  const activateUtxo = async (coin: WalletCoin) => {
    const ticker = coin.config.coin;
    const taskId = await enableUtxoInit(ticker, coin.electrums);
    const deadline = Date.now() + UTXO_ACTIVATION_TIMEOUT_MS;
    for (;;) {
      const res = await enableUtxoStatus(taskId);
      if (res.status === 'Ok') return finishActivation(ticker, res.details.wallet_balance);
      if (res.status === 'Error') throw new Error(res.details.error);
      if (Date.now() > deadline) throw new Error('Activation timed out');
      await sleep(ACTIVATION_POLL_MS);
    }
  };

  const activateZhtlc = async (coin: WalletCoin) => {
    const ticker = coin.config.coin;
    const taskId = await enableZCoinInit(ticker, coin.electrums, coin.lightwalletd ?? []);
    const deadline = Date.now() + ZHTLC_ACTIVATION_TIMEOUT_MS;
    for (;;) {
      const res = await enableZCoinStatus(taskId);
      if (res.status === 'Ok') return finishActivation(ticker, res.details.wallet_balance);
      if (res.status === 'Error') throw new Error(res.details.error);
      if (res.status === 'InProgress') {
        patchCoin(ticker, { progress: zProgress(res.details as ZCoinProgressDetails) });
      }
      if (Date.now() > deadline) throw new Error('Activation timed out');
      await sleep(ACTIVATION_POLL_MS);
    }
  };

  return {
    coins: initialCoins(),

    activateAll: async () => {
      // Live balance updates over the KDF event stream; poll as a fallback.
      unsubscribeEvents ??= subscribeKdfEvents('BALANCE:', (event) => {
        const msg = event.message as {
          ticker?: string;
          address?: string;
          balance?: BalanceInfo;
        };
        if (msg?.ticker && msg.balance) {
          patchCoin(msg.ticker, { balance: msg.balance });
        }
      });
      pollTimer ??= setInterval(() => void get().refreshBalances(), BALANCE_POLL_MS);

      await Promise.all(WALLET_COINS.map((coin) => get().activateCoin(coin)));
    },

    activateCoin: async (coin: WalletCoin) => {
      const ticker = coin.config.coin;
      const state = get().coins[ticker];
      if (state.status === 'activating' || state.status === 'active') return;
      patchCoin(ticker, { status: 'activating', error: null, progress: null });

      try {
        if (coin.kind === 'zhtlc') {
          await activateZhtlc(coin);
        } else {
          await activateUtxo(coin);
        }

        // Failing to enable streamers is not fatal — polling still works.
        await Promise.allSettled([
          streamBalanceEnable(ticker),
          streamTxHistoryEnable(ticker),
        ]);
      } catch (e) {
        patchCoin(ticker, {
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
          progress: null,
        });
      }
    },

    refreshBalances: async () => {
      const active = Object.values(get().coins).filter((c) => c.status === 'active');
      await Promise.allSettled(
        active.map(async (c) => {
          const res = await myBalance(c.ticker);
          patchCoin(c.ticker, {
            address: res.address,
            balance: { spendable: res.balance, unspendable: res.unspendable_balance },
          });
        }),
      );
    },

    reset: () => {
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      set({ coins: initialCoins() });
    },
  };
});
