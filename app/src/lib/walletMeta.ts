/**
 * Per-wallet facts the app learns while a wallet is open and needs again while
 * it is closed.
 *
 * Right now that is the public key, which the login screen needs to draw a
 * wallet's identicon before anyone has logged in. KDF only hands it over to an
 * open session, so it has to be remembered from the previous one.
 *
 * Nothing secret lives here. A public key is public, and it is already visible
 * on-chain in every transaction the wallet has ever signed.
 */

const DB_NAME = 'kmd-wallet-meta';
const DB_VERSION = 1;
const STORE = 'wallets';

export interface WalletMeta {
  walletName: string;
  publicKey: string;
  updatedAt: number;
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
    req.onerror = () => reject(req.error ?? new Error('Failed to open wallet meta database'));
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Wallet meta request failed'));
    });
  } finally {
    db.close();
  }
}

/** Public keys by wallet name. Failure is never worth blocking the UI for. */
export async function loadWalletKeys(): Promise<Record<string, string>> {
  try {
    const all = await tx<WalletMeta[]>('readonly', (s) => s.getAll());
    return Object.fromEntries(all.map((m) => [m.walletName, m.publicKey]));
  } catch {
    return {};
  }
}

export async function saveWalletKey(walletName: string, publicKey: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put({ walletName, publicKey, updatedAt: Date.now() }));
  } catch {
    /* an identicon is a nicety; losing it must not fail a login */
  }
}

/**
 * Forget wallets KDF no longer knows about, so a name reused for a different
 * wallet cannot inherit the previous one's picture — which would be worse than
 * having no picture, since the whole point is that the image identifies keys.
 */
export async function pruneWalletKeys(existing: string[]): Promise<void> {
  try {
    const known = new Set(existing);
    const all = await tx<WalletMeta[]>('readonly', (s) => s.getAll());
    for (const m of all) {
      if (!known.has(m.walletName)) await tx('readwrite', (s) => s.delete(m.walletName));
    }
  } catch {
    /* ignore */
  }
}
