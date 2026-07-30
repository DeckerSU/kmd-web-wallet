import { create } from 'zustand';
import { listPasskeys, pruneOrphans } from '../lib/passkeyStore';
import { isPasskeySupported, isPrfLikelyAvailable } from '../lib/webauthn';
import {
  beginEnrollment,
  completeEnrollment,
  PasskeyCancelled,
  removePasskey,
  unlockPassword,
  type PendingEnrollment,
} from '../services/passkey';
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

  /** Whether this browser can register PRF-capable passkeys at all. */
  passkeySupported: boolean;
  /** Wallet names that have a passkey registered in this browser. */
  passkeyWallets: string[];
  /**
   * Set once after creating a wallet with a passkey: the generated password the
   * user must record, since a passkey means they never chose one. Cleared as
   * soon as the backup step is acknowledged.
   */
  generatedPassword: string | null;
  /**
   * Set when a passkey was created but its provider withheld the PRF secret,
   * so the user has to confirm once more. Drives the confirm button in the UI;
   * the second ceremony must be triggered by that click, never automatically.
   */
  pendingPasskey: { pending: PendingEnrollment; mnemonic?: string } | null;

  boot: () => Promise<void>;
  login: (name: string, password: string) => Promise<boolean>;
  /** Unlock via passkey: derive the stored password, then log in normally. */
  loginWithPasskey: (name: string) => Promise<boolean>;
  /**
   * Register a wallet. Omit `mnemonic` to have KDF generate a fresh seed
   * phrase itself; pass one to import an existing seed.
   */
  create: (name: string, password: string, mnemonic?: string) => Promise<boolean>;
  /**
   * Register a wallet protected by a passkey. The password is generated, never
   * typed, and surfaced through `generatedPassword` for the backup step.
   */
  createWithPasskey: (name: string, mnemonic?: string) => Promise<boolean>;
  /** Finish an enrolment that needed a second, user-initiated confirmation. */
  confirmPendingPasskey: () => Promise<boolean>;
  cancelPendingPasskey: () => void;
  /** Attach a passkey to the wallet in the current session. */
  addPasskey: (name: string, password: string) => Promise<string | null>;
  forgetPasskey: (name: string) => Promise<void>;
  refreshPasskeys: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  clearGeneratedPassword: () => void;
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

type SetAuthState = (partial: Partial<AuthState>) => void;

/**
 * Register the wallet in KDF once a password is finally in hand, rolling the
 * passkey back if KDF refuses — a credential guarding a wallet that was never
 * created would just be litter the user has to clean up by hand.
 */
async function finishCreate(
  set: SetAuthState,
  name: string,
  password: string,
  mnemonic?: string,
): Promise<boolean> {
  try {
    await createWallet(name, password, mnemonic);
  } catch (e) {
    await removePasskey(name).catch(() => {});
    throw e;
  }
  set({
    phase: 'authenticated',
    walletName: name,
    justCreated: !mnemonic,
    generatedPassword: password,
    passkeyWallets: await loadPasskeyWallets(),
  });
  return true;
}

/** Names of wallets with a passkey record, for the login list's key badges. */
async function loadPasskeyWallets(): Promise<string[]> {
  try {
    return (await listPasskeys()).map((r) => r.walletName);
  } catch {
    return [];
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  phase: 'boot',
  wallets: [],
  walletName: null,
  error: null,
  bootProgress: null,
  justCreated: false,
  pendingPasskey: null,
  passkeySupported: false,
  passkeyWallets: [],
  generatedPassword: null,

  boot: () => {
    bootInFlight ??= (async () => {
      set({ phase: 'boot', error: null });
      try {
        const wallets = await startNoAuthSession((loaded, total) =>
          set({ bootProgress: { loaded, total } }),
        );
        // A passkey record for a wallet KDF no longer knows would unwrap a
        // password that opens nothing, so reconcile against the real list.
        await pruneOrphans(wallets);
        set({
          phase: 'ready',
          wallets,
          bootProgress: null,
          passkeySupported: isPasskeySupported() && (await isPrfLikelyAvailable()),
          passkeyWallets: await loadPasskeyWallets(),
        });
      } catch (e) {
        set({ phase: 'boot-error', error: userMessage(e), bootProgress: null });
      } finally {
        bootInFlight = null;
      }
    })();
    return bootInFlight;
  },

  refreshPasskeys: async () => set({ passkeyWallets: await loadPasskeyWallets() }),

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

  loginWithPasskey: async (name) => {
    set({ phase: 'authenticating', error: null });
    try {
      const password = await unlockPassword(name);
      await loginWallet(name, password);
      set({ phase: 'authenticated', walletName: name, justCreated: false });
      return true;
    } catch (e) {
      // Dismissing the OS prompt is a choice, not a failure — say nothing.
      set({ phase: 'ready', error: e instanceof PasskeyCancelled ? null : userMessage(e) });
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

  createWithPasskey: async (name, mnemonic) => {
    set({ phase: 'authenticating', error: null, pendingPasskey: null });
    try {
      // Enrol first: if the passkey ceremony fails we must not be left with a
      // wallet whose generated password nobody has ever seen.
      const step = await beginEnrollment(name);
      if (!step.done) {
        // Provider withheld the PRF secret; park it until the user confirms.
        set({ phase: 'ready', pendingPasskey: { pending: step.pending, mnemonic } });
        return false;
      }
      return await finishCreate(set, name, step.password, mnemonic);
    } catch (e) {
      set({ phase: 'ready', error: e instanceof PasskeyCancelled ? null : userMessage(e) });
      return false;
    }
  },

  confirmPendingPasskey: async () => {
    const parked = get().pendingPasskey;
    if (!parked) return false;
    set({ phase: 'authenticating', error: null });
    try {
      const password = await completeEnrollment(parked.pending);
      set({ pendingPasskey: null });
      return await finishCreate(set, parked.pending.walletName, password, parked.mnemonic);
    } catch (e) {
      set({ phase: 'ready', error: e instanceof PasskeyCancelled ? null : userMessage(e) });
      return false;
    }
  },

  cancelPendingPasskey: () => set({ pendingPasskey: null, error: null }),

  addPasskey: async (name, password) => {
    try {
      const step = await beginEnrollment(name, password);
      const stored = step.done ? step.password : await completeEnrollment(step.pending);
      set({ passkeyWallets: await loadPasskeyWallets() });
      return stored;
    } catch (e) {
      if (e instanceof PasskeyCancelled) return null;
      throw e;
    }
  },

  forgetPasskey: async (name) => {
    await removePasskey(name);
    set({ passkeyWallets: await loadPasskeyWallets() });
  },

  logout: async () => {
    const { walletName } = get();
    set({
      phase: 'boot',
      walletName: null,
      error: null,
      justCreated: false,
      // Never let a generated password outlive its session.
      generatedPassword: null,
    });
    try {
      const wallets = await logoutWallet();
      await pruneOrphans(wallets);
      set({ phase: 'ready', wallets, passkeyWallets: await loadPasskeyWallets() });
    } catch (e) {
      set({ phase: 'boot-error', walletName, error: userMessage(e) });
    }
  },

  clearError: () => set({ error: null }),
  clearGeneratedPassword: () => set({ generatedPassword: null }),
  dismissBackupReminder: () => set({ justCreated: false }),
}));
