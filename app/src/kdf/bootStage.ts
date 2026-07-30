/**
 * Boot is several distinct steps that used to look like one.
 *
 * The screen reported "Downloading wallet engine…" until the whole sequence
 * finished, so a slow wasm compile or a node that would not come up were both
 * indistinguishable from a slow download — and the download had visibly
 * completed. Naming the steps is what makes a stall diagnosable.
 */
export type BootStage =
  | { phase: 'downloading'; loaded: number; total: number | null }
  | { phase: 'compiling' }
  | { phase: 'starting-node' }
  | { phase: 'waiting-rpc'; elapsedMs: number }
  | { phase: 'reading-wallets' };

export type OnBootStage = (stage: BootStage) => void;

export const BOOT_LABELS: Record<BootStage['phase'], string> = {
  downloading: 'Downloading wallet engine',
  compiling: 'Compiling wallet engine',
  'starting-node': 'Starting Komodo DeFi Framework',
  'waiting-rpc': 'Waiting for the node',
  'reading-wallets': 'Reading wallets',
};

interface Mark {
  phase: BootStage['phase'];
  at: number;
}

const marks: Mark[] = [];

/**
 * Log a phase transition with the time the previous phase took. Timings go to
 * the console because a stall on someone else's machine is otherwise invisible;
 * `window.__bootTimings` exposes the same data for copying.
 */
export function markBootPhase(phase: BootStage['phase']): void {
  const now = performance.now();
  const prev = marks[marks.length - 1];
  if (prev && prev.phase === phase) return;
  if (prev) {
    console.info(
      `[boot] ${prev.phase} took ${Math.round(now - prev.at)} ms → ${phase}`,
    );
  } else {
    console.info(`[boot] ${phase}`);
  }
  marks.push({ phase, at: now });
}

export function finishBootTimings(): void {
  const now = performance.now();
  const prev = marks[marks.length - 1];
  if (prev) console.info(`[boot] ${prev.phase} took ${Math.round(now - prev.at)} ms`);
  if (marks.length) {
    const total = Math.round(now - marks[0].at);
    const breakdown = marks
      .map((m, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].at : now;
        return `${m.phase}=${Math.round(end - m.at)}ms`;
      })
      .join('  ');
    console.info(`[boot] ready in ${total} ms — ${breakdown}`);
  }
  marks.length = 0;
}

/**
 * What the browser actually did to get the wasm.
 *
 * A cold compile and a cold download look identical from the outside, and the
 * gzipped transfer is why the old progress display was nonsense. Resource
 * timing distinguishes all of it: `transferSize === 0` means the cache served
 * it, and encoded vs decoded size shows the compression ratio directly.
 */
export function logWasmTiming(): void {
  try {
    const entry = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('kdflib_bg') && e.name.endsWith('.wasm')) as
      | PerformanceResourceTiming
      | undefined;
    if (!entry) return;
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    console.info(
      `[boot] wasm ${entry.transferSize === 0 ? 'from cache' : 'over network'}: ` +
        `transfer=${mb(entry.transferSize)}MB encoded=${mb(entry.encodedBodySize)}MB ` +
        `decoded=${mb(entry.decodedBodySize)}MB in ${Math.round(entry.duration)}ms`,
    );
  } catch {
    /* resource timing is a nicety, never a reason to fail boot */
  }
}

/**
 * Route KDF's own log lines into the boot narrative, timestamped.
 *
 * Without this the node is a black box between "started" and "RPC up" — and
 * that gap is where P2P brings up its seed connections, the most likely place
 * for a machine-specific stall to hide.
 */
export function traceKdfDuringBoot(onLog: (fn: (level: number, line: string) => void) => void): void {
  const t0 = performance.now();
  onLog((_level, line) => {
    console.info(`[boot:kdf +${Math.round(performance.now() - t0)}ms] ${line}`);
  });
}

export function bootTimings(): Mark[] {
  return [...marks];
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__bootTimings = bootTimings;
}
