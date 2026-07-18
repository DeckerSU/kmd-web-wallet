import { create } from 'zustand';
import {
  createWallet,
  loginWallet,
  logoutWallet,
  SessionError,
  startNoAuthSession,
} from '../services/session';

export type AuthPhase =
  | 'boot' // loading wasm + starting no-auth session
  | 'ready' // wallet list available, user not logged in
  | 'authenticating'
  | 'authenticated'
  | 'boot-error';

interface AuthState {
  phase: AuthPhase;
  wallets: string[];
  walletName: string | null;
  /** Last auth error (user-facing), cleared on the next attempt. */
  error: string | null;

  boot: () => Promise<void>;
  login: (name: string, password: string) => Promise<boolean>;
  create: (name: string, password: string, mnemonic: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

/** Dedupes concurrent boots (React StrictMode mounts effects twice in dev). */
let bootInFlight: Promise<void> | null = null;

function userMessage(e: unknown): string {
  if (e instanceof SessionError && e.kind === 'wrong-password') {
    return 'Wrong password. Please try again.';
  }
  return e instanceof Error ? e.message : String(e);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  phase: 'boot',
  wallets: [],
  walletName: null,
  error: null,

  boot: () => {
    bootInFlight ??= (async () => {
      set({ phase: 'boot', error: null });
      try {
        const wallets = await startNoAuthSession();
        set({ phase: 'ready', wallets });
      } catch (e) {
        set({ phase: 'boot-error', error: userMessage(e) });
      } finally {
        bootInFlight = null;
      }
    })();
    return bootInFlight;
  },

  login: async (name, password) => {
    set({ phase: 'authenticating', error: null });
    try {
      await loginWallet(name, password);
      set({ phase: 'authenticated', walletName: name });
      return true;
    } catch (e) {
      set({ phase: 'ready', error: userMessage(e) });
      return false;
    }
  },

  create: async (name, password, mnemonic) => {
    set({ phase: 'authenticating', error: null });
    try {
      await createWallet(name, password, mnemonic);
      set({ phase: 'authenticated', walletName: name });
      return true;
    } catch (e) {
      set({ phase: 'ready', error: userMessage(e) });
      return false;
    }
  },

  logout: async () => {
    const { walletName } = get();
    set({ phase: 'boot', walletName: null, error: null });
    try {
      const wallets = await logoutWallet();
      set({ phase: 'ready', wallets });
    } catch (e) {
      set({ phase: 'boot-error', walletName, error: userMessage(e) });
    }
  },

  clearError: () => set({ error: null }),
}));
