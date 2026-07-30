import type { WrappedSecret } from './keywrap';

/**
 * Per-wallet passkey records, in the app's own IndexedDB database.
 *
 * Kept well away from KDF's databases: KDF owns its own stores and this must
 * never look like one of them. Nothing here is secret on its own — the wrapped
 * password is inert without the authenticator (see keywrap.ts) — but it is also
 * not portable: clearing site data drops these records *and* KDF's encrypted
 * wallets together, so the seed phrase remains the only true backup.
 */

const DB_NAME = 'kmd-wallet-passkeys';
const DB_VERSION = 1;
const STORE = 'credentials';

export interface PasskeyRecord {
  /** Wallet name — the primary key, matching KDF's `get_wallet_names`. */
  walletName: string;
  /** base64 raw credential id, replayed in `allowCredentials`. */
  credentialId: string;
  /** base64 random user handle. Unused for lookup; kept for debugging. */
  userId: string;
  /** base64 per-wallet PRF salt. */
  prfSalt: string;
  /** The KDF wallet password, encrypted under the PRF-derived key. */
  wrapped: WrappedSecret;
  transports: string[];
  createdAt: number;
  lastUsedAt: number | null;
  version: 1;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'walletName' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open passkey database'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Passkey store request failed'));
    });
  } finally {
    db.close();
  }
}

export async function getPasskey(walletName: string): Promise<PasskeyRecord | null> {
  const rec = await tx<PasskeyRecord | undefined>('readonly', (s) => s.get(walletName));
  return rec ?? null;
}

export async function listPasskeys(): Promise<PasskeyRecord[]> {
  return tx<PasskeyRecord[]>('readonly', (s) => s.getAll());
}

export async function savePasskey(record: PasskeyRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(record));
}

export async function deletePasskey(walletName: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(walletName));
}

export async function touchPasskey(walletName: string): Promise<void> {
  const rec = await getPasskey(walletName);
  if (rec) await savePasskey({ ...rec, lastUsedAt: Date.now() });
}

/**
 * Drop records whose wallet no longer exists in KDF, so a deleted-and-recreated
 * wallet cannot inherit a stale credential that unwraps the wrong password.
 * Best-effort: a failure here must never block the login screen.
 */
export async function pruneOrphans(existingWallets: string[]): Promise<void> {
  try {
    const known = new Set(existingWallets);
    for (const rec of await listPasskeys()) {
      if (!known.has(rec.walletName)) await deletePasskey(rec.walletName);
    }
  } catch {
    /* ignore */
  }
}
