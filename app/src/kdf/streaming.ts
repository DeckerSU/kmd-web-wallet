import { KDF_EVENT_WORKER_PATH } from '../config/constants';

/**
 * Client side of KDF event streaming on web.
 *
 * The KDF wasm node opens a SharedWorker (same script, same resolved URL) and
 * posts every stream event to it as a JSON string:
 *   '{"_type": "BALANCE:KMD", "message": {...}}'
 * The worker simply broadcasts messages to all connected ports, so the app
 * connects to the same worker and listens.
 */

export interface KdfEvent {
  type: string;
  message: unknown;
}

export type EventListener = (event: KdfEvent) => void;
export type Unsubscribe = () => void;

const listeners = new Set<{ prefix: string; fn: EventListener }>();
let port: MessagePort | null = null;

function ensureConnected(): void {
  if (port) return;
  const worker = new SharedWorker(`/${KDF_EVENT_WORKER_PATH}`);
  port = worker.port;
  port.onmessage = (e: MessageEvent) => {
    let parsed: unknown = e.data;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return;
      }
    }
    const data = parsed as { _type?: string; message?: unknown };
    if (typeof data?._type !== 'string') return;
    const event: KdfEvent = { type: data._type, message: data.message };
    for (const l of listeners) {
      if (event.type.startsWith(l.prefix)) l.fn(event);
    }
  };
  port.start();
}

/**
 * Subscribe to KDF events whose `_type` starts with `prefix`
 * (e.g. 'BALANCE:' for all coins or 'BALANCE:KMD' for one).
 */
export function subscribeKdfEvents(prefix: string, fn: EventListener): Unsubscribe {
  ensureConnected();
  const entry = { prefix, fn };
  listeners.add(entry);
  return () => listeners.delete(entry);
}
