/**
 * Types over the KDF wasm-bindgen module (public/kdf/kdflib.d.ts is the full
 * reference; only what the app uses is typed here).
 */

export const MainStatus = {
  NotRunning: 0,
  NoContext: 1,
  NoRpc: 2,
  RpcIsUp: 3,
} as const;
export type MainStatus = (typeof MainStatus)[keyof typeof MainStatus];

/** Result codes returned (or thrown as numbers) by mm2_main. */
export const StartupResultCode = {
  Ok: 0,
  InvalidParams: 1,
  ConfigError: 2,
  AlreadyRunning: 3,
  InitError: 4,
  SpawnError: 5,
} as const;
export type StartupResultCode =
  (typeof StartupResultCode)[keyof typeof StartupResultCode];

export function startupResultName(code: number): string {
  const entry = Object.entries(StartupResultCode).find(([, v]) => v === code);
  return entry ? entry[0] : `Unknown(${code})`;
}

/** Error codes thrown (as numbers) by mm2_rpc / mm2_stop. */
export const Mm2RpcErr = {
  NotRunning: 1,
  InvalidPayload: 2,
  InternalError: 3,
} as const;
export type Mm2RpcErr = (typeof Mm2RpcErr)[keyof typeof Mm2RpcErr];

export function mm2RpcErrName(code: number): string {
  const entry = Object.entries(Mm2RpcErr).find(([, v]) => v === code);
  return entry ? entry[0] : `Unknown(${code})`;
}

export const LogLevel = {
  Off: 0,
  Error: 1,
  Warn: 2,
  Info: 3,
  Debug: 4,
  Trace: 5,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export interface KdfStartupConf {
  mm2: 1;
  gui: string;
  netid: number;
  rpc_password: string;
  coins: unknown[];
  seednodes?: string[];
  wallet_name?: string;
  wallet_password?: string;
  /** Seed phrase — pass only on wallet registration/import. */
  passphrase?: string;
  enable_hd?: boolean;
  allow_registrations?: boolean;
  allow_weak_password?: boolean;
  event_streaming_configuration?: {
    access_control_allow_origin: string;
    worker_path: string;
  };
}

export type KdfLogHandler = (level: number, line: string) => void;

/** Shape of the dynamically imported kdflib.js module. */
export interface KdfLibModule {
  default: (moduleOrPath?: unknown) => Promise<unknown>;
  mm2_main(
    params: { conf: KdfStartupConf; log_level: number },
    log_cb: KdfLogHandler,
  ): Promise<number>;
  mm2_main_status(): number;
  mm2_rpc(payload: Record<string, unknown>): Promise<unknown>;
  mm2_stop(): Promise<void>;
  mm2_version(): { result: string; datetime: string };
}

export class KdfRpcError extends Error {
  readonly method: string;
  readonly payload?: unknown;

  constructor(message: string, method: string, payload?: unknown) {
    super(message);
    this.name = 'KdfRpcError';
    this.method = method;
    this.payload = payload;
  }
}
