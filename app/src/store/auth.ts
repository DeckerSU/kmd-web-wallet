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
  /** WASM download progress during boot (null once loaded/unknown). */
  bootProgress: { loaded: number; total: number | null } | null;

  /**
   * True right after a brand-new wallet is created (not imported/logged in),
   * so the UI can nudge the user to back up their seed phrase.
   */
  justCreated: boolean;

  boot: () => Promise<void>;
  login: (name: string, password: string) => Promise<boolean>;
  /**
   * Register a wallet. Omit `mnemonic` to have KDF generate a fresh seed
   * phrase itself; pass one to import an existing seed.
   */
  create: (name: string, password: string, mnemonic?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  dismissBackupReminder: () => void;
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
  bootProgress: null,
  justCreated: false,

  boot: () => {
    bootInFlight ??= (async () => {
      set({ phase: 'boot', error: null });
      try {
        const wallets = await startNoAuthSession((loaded, total) =>
          set({ bootProgress: { loaded, total } }),
        );
        set({ phase: 'ready', wallets, bootProgress: null });
      } catch (e) {
        set({ phase: 'boot-error', error: userMessage(e), bootProgress: null });
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
      set({ phase: 'authenticated', walletName: name, justCreated: false });
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
      // Only nudge for backup when KDF generated a fresh seed (new wallet),
      // not when the user imported a seed they already hold.
      set({ phase: 'authenticated', walletName: name, justCreated: !mnemonic });
      return true;
    } catch (e) {
      set({ phase: 'ready', error: userMessage(e) });
      return false;
    }
  },

  logout: async () => {
    const { walletName } = get();
    set({ phase: 'boot', walletName: null, error: null, justCreated: false });
    try {
      const wallets = await logoutWallet();
      set({ phase: 'ready', wallets });
    } catch (e) {
      set({ phase: 'boot-error', walletName, error: userMessage(e) });
    }
  },

  clearError: () => set({ error: null }),
  dismissBackupReminder: () => set({ justCreated: false }),
}));
