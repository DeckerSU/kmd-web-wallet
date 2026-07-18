import { create } from 'zustand';
import { WALLET_COINS, type WalletCoin } from '../config/coins';
import {
  enableUtxoInit,
  enableUtxoStatus,
  myBalance,
  streamBalanceEnable,
  streamTxHistoryEnable,
  type BalanceInfo,
} from '../kdf/methods';
import { subscribeKdfEvents, type Unsubscribe } from '../kdf/streaming';

const ACTIVATION_TIMEOUT_MS = 120_000;
const ACTIVATION_POLL_MS = 500;
const BALANCE_POLL_MS = 30_000;

export type CoinStatus = 'idle' | 'activating' | 'active' | 'error';

export interface CoinState {
  ticker: string;
  status: CoinStatus;
  address: string | null;
  balance: BalanceInfo | null;
  error: string | null;
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
      { ticker: c.config.coin, status: 'idle', address: null, balance: null, error: null },
    ]),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Session-scoped subscriptions/timers, torn down in reset(). */
let unsubscribeEvents: Unsubscribe | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export const usePortfolioStore = create<PortfolioState>((set, get) => {
  const patchCoin = (ticker: string, patch: Partial<CoinState>) =>
    set((s) => ({ coins: { ...s.coins, [ticker]: { ...s.coins[ticker], ...patch } } }));

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
      patchCoin(ticker, { status: 'activating', error: null });

      try {
        const taskId = await enableUtxoInit(ticker, coin.electrums);
        const deadline = Date.now() + ACTIVATION_TIMEOUT_MS;

        for (;;) {
          const res = await enableUtxoStatus(taskId);
          if (res.status === 'Ok') {
            const wallet = res.details.wallet_balance;
            patchCoin(ticker, {
              status: 'active',
              address: wallet.address,
              balance: wallet.balance[ticker] ?? null,
            });
            break;
          }
          if (res.status === 'Error') {
            throw new Error(res.details.error);
          }
          if (Date.now() > deadline) {
            throw new Error(`Activation timed out (${ACTIVATION_TIMEOUT_MS / 1000}s)`);
          }
          await sleep(ACTIVATION_POLL_MS);
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
