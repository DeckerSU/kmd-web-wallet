import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Minimal in-house UI kit (Phase 1). May be replaced by shadcn/ui later. */

export function Button(props: {
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const variants = {
    primary:
      'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500',
    ghost:
      'bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700/60 disabled:text-zinc-600',
    danger: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:text-zinc-600',
  };
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${variants[props.variant ?? 'primary']} ${props.className ?? ''}`}
    >
      {props.children}
    </button>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  error?: string | null;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-300">{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className={`w-full rounded-xl border bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-500 ${props.error ? 'border-red-500/70' : 'border-zinc-700'}`}
      />
      {props.error ? (
        <span className="mt-1 block text-xs text-red-400">{props.error}</span>
      ) : props.hint ? (
        <span className="mt-1 block text-xs text-zinc-500">{props.hint}</span>
      ) : null}
    </label>
  );
}

export function Card(props: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-xl shadow-black/30 backdrop-blur ${props.className ?? ''}`}
    >
      {props.children}
    </div>
  );
}

export function Alert(props: { kind: 'error' | 'warning' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-500/40 bg-red-500/10 text-red-300',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    info: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${styles[props.kind]}`}>
      {props.children}
    </div>
  );
}

export function Spinner(props: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 text-zinc-400">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-400" />
      {props.label && <span className="text-sm">{props.label}</span>}
    </div>
  );
}

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Portal to <body>: ancestors with backdrop-filter/transform create stacking
  // contexts that would otherwise paint sibling cards above this overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={props.onClose}
    >
      <div
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{props.title}</h2>
          <button
            onClick={props.onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>,
    document.body,
  );
}

export function BackLink(props: { onClick: () => void; children?: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className="mb-4 text-sm text-zinc-400 transition hover:text-zinc-200"
    >
      ← {props.children ?? 'Back'}
    </button>
  );
}
