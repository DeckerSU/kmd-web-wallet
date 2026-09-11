/* eslint-disable */
/**
 * Public KDF wasm-bindgen surface consumed by this app.
 *
 * wasm-pack emits declarations for test-only Rust exports whose names contain
 * `::`; TypeScript cannot parse those property names. The runtime JavaScript
 * and WASM are copied verbatim from KDF. Application-facing boundary types
 * live in ../kdf/types.ts.
 */
export function mm2_version(): { result: string; datetime: string };
export function mm2_rpc(payload: unknown): Promise<unknown>;
export function mm2_main(
  params: unknown,
  log_cb: (level: number, line: string) => void,
): Promise<number>;
export function mm2_main_status(): number;
export function mm2_stop(): Promise<void>;

export enum LogLevel {
  Off = 0,
  Error = 1,
  Warn = 2,
  Info = 3,
  Debug = 4,
  Trace = 5,
}

export enum MainStatus {
  NotRunning = 0,
  NoContext = 1,
  NoRpc = 2,
  RpcIsUp = 3,
}

export enum StartupResultCode {
  Ok = 0,
  InvalidParams = 1,
  ConfigError = 2,
  AlreadyRunning = 3,
  InitError = 4,
  SpawnError = 5,
}

export enum Mm2RpcErr {
  NotRunning = 1,
  InvalidPayload = 2,
  InternalError = 3,
}

export default function init(module_or_path?: unknown): Promise<unknown>;
