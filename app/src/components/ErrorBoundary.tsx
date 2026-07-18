import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last-resort crash screen; a reload restarts KDF cleanly. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 font-sans text-zinc-100">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="break-all font-mono text-xs text-red-400">
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
