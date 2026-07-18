import {
  KdfRpcError,
  LogLevel,
  MainStatus,
  mm2RpcErrName,
  StartupResultCode,
  type KdfLibModule,
  type KdfLogHandler,
  type KdfStartupConf,
} from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StartOutcome {
  code: StartupResultCode;
  /** Present when mm2_main rejected with a StartupError. */
  message?: string;
}

export type LoadProgress = (loadedBytes: number, totalBytes: number | null) => void;

/** Fetch a URL as bytes, reporting download progress per chunk. */
async function fetchWithProgress(url: string, onProgress: LoadProgress): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const lengthHeader = res.headers.get('Content-Length');
  const total = lengthHeader ? Number(lengthHeader) : null;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Thin singleton wrapper around the KDF wasm-bindgen module.
 * Owns module loading, node lifecycle (start/stop) and the RPC transport;
 * knows nothing about React or app state.
 */
class KdfClient {
  private module: KdfLibModule | null = null;
  private loadPromise: Promise<KdfLibModule> | null = null;
  private rpcPassword: string | null = null;
  /** Serializes start/stop so concurrent callers can't interleave restarts. */
  private opQueue: Promise<unknown> = Promise.resolve();
  private logHandler: KdfLogHandler = (level, line) =>
    console.debug(`[KDF:${level}] ${line}`);

  onLog(handler: KdfLogHandler): void {
    this.logHandler = handler;
  }

  /**
   * Import kdflib.js and instantiate the wasm binary (idempotent).
   * With `onProgress`, the ~36 MB wasm is fetched manually so download
   * progress can be shown; otherwise wasm-bindgen fetches it itself.
   */
  async load(onProgress?: LoadProgress): Promise<KdfLibModule> {
    if (this.module) return this.module;
    this.loadPromise ??= (async () => {
      // Lazy import keeps the ~36 MB wasm out of the initial page load.
      const [mod, wasmUrl] = await Promise.all([
        import('../kdflib/kdflib.js') as unknown as Promise<KdfLibModule>,
        import('../kdflib/kdflib_bg.wasm?url').then((m) => m.default),
      ]);
      if (onProgress) {
        const bytes = await fetchWithProgress(wasmUrl, onProgress);
        await mod.default({ module_or_path: bytes });
      } else {
        await mod.default();
      }
      this.module = mod;
      return mod;
    })().catch((e: unknown) => {
      this.loadPromise = null;
      throw e;
    });
    return this.loadPromise;
  }

  get isLoaded(): boolean {
    return this.module !== null;
  }

  status(): MainStatus {
    if (!this.module) return MainStatus.NotRunning;
    return this.module.mm2_main_status() as MainStatus;
  }

  /**
   * Start the KDF node. Resolves once the RPC layer is up.
   * The conf's rpc_password is remembered and injected into every rpc() call.
   *
   * On failure mm2_main rejects with a StartupError JsValue `{code, message}`
   * (e.g. InitError + "Error generating or decrypting mnemonic" for a wrong
   * wallet password) — normalized here into the returned outcome.
   */
  start(conf: KdfStartupConf, logLevel: LogLevel = LogLevel.Info): Promise<StartOutcome> {
    return this.serialize(() => this.startInner(conf, logLevel));
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opQueue.then(fn, fn);
    this.opQueue = next.catch(() => {});
    return next;
  }

  private async startInner(
    conf: KdfStartupConf,
    logLevel: LogLevel,
  ): Promise<StartOutcome> {
    const mod = await this.load();

    let code: StartupResultCode;
    try {
      code = (await mod.mm2_main({ conf, log_level: logLevel }, (level, line) =>
        this.logHandler(level, line),
      )) as StartupResultCode;
    } catch (e) {
      if (typeof e === 'number') return { code: e as StartupResultCode };
      if (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'number') {
        const err = e as { code: number; message?: unknown };
        return {
          code: err.code as StartupResultCode,
          message: err.message === undefined ? undefined : String(err.message),
        };
      }
      throw e;
    }

    if (code === StartupResultCode.Ok || code === StartupResultCode.AlreadyRunning) {
      // Only the conf that actually started the node owns the RPC password.
      if (code === StartupResultCode.Ok) this.rpcPassword = conf.rpc_password;
      await this.waitForRpc();
    }
    return { code };
  }

  /** Poll mm2_main_status until the RPC server is ready. */
  async waitForRpc(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.status() !== MainStatus.RpcIsUp) {
      if (Date.now() > deadline) {
        throw new Error(`KDF RPC not up within ${timeoutMs} ms (status=${this.status()})`);
      }
      await sleep(200);
    }
  }

  /**
   * Invoke an RPC method. `userpass` is injected automatically.
   * For mmrpc 2.0 responses the `result` field is unwrapped; errors are thrown
   * as KdfRpcError.
   */
  async rpc<T = unknown>(payload: Record<string, unknown>): Promise<T> {
    const mod = this.module;
    if (!mod || !this.rpcPassword) {
      throw new KdfRpcError('KDF is not running', String(payload.method));
    }
    const method = String(payload.method);

    let response: unknown;
    try {
      response = await mod.mm2_rpc({ userpass: this.rpcPassword, ...payload });
    } catch (e) {
      if (typeof e === 'number') {
        throw new KdfRpcError(`mm2_rpc failed: ${mm2RpcErrName(e)}`, method, payload);
      }
      throw e;
    }

    if (payload.mmrpc === '2.0') {
      const res = response as { result?: T; error?: unknown };
      if (res.error !== undefined) {
        throw new KdfRpcError(JSON.stringify(res.error), method, payload);
      }
      if (res.result === undefined) {
        throw new KdfRpcError('Malformed 2.0 response', method, payload);
      }
      return res.result;
    }
    return response as T;
  }

  /** Convenience wrapper for mmrpc 2.0 calls. */
  rpc2<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.rpc<T>({ mmrpc: '2.0', method, params: params ?? {} });
  }

  /** Stop the node and wait until it reports NotRunning. */
  stop(timeoutMs = 10_000): Promise<void> {
    return this.serialize(() => this.stopInner(timeoutMs));
  }

  private async stopInner(timeoutMs: number): Promise<void> {
    const mod = this.module;
    if (!mod || this.status() === MainStatus.NotRunning) return;

    try {
      await mod.mm2_stop();
    } catch (e) {
      if (typeof e !== 'number') throw e; // numeric codes: already stopping/stopped
    }

    const deadline = Date.now() + timeoutMs;
    while (this.status() !== MainStatus.NotRunning) {
      if (Date.now() > deadline) throw new Error('KDF stop timed out');
      await sleep(300);
    }
    this.rpcPassword = null;
  }
}

/**
 * Generate a session-scoped RPC password satisfying KDF's password policy:
 * digit + lowercase + uppercase + special are guaranteed by the template, and
 * candidates with 3 identical characters in a row (which KDF rejects — random
 * hex hits this ~8% of the time) are re-rolled.
 */
export function generateRpcPassword(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const candidate = `Rp!9${hex.slice(0, 8)}A${hex.slice(8, 24)}`;
    if (!/(.)\1\1/.test(candidate)) return candidate;
  }
}

export const kdf = new KdfClient();

// Dev-only escape hatch for debugging RPCs from the browser console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__kdf = kdf;
}
