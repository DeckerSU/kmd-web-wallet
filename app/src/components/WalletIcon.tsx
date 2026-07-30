import { identiconFor } from '../lib/identicon';

/**
 * Visual identity for a wallet: an identicon when its public key is known,
 * otherwise the first letter of its name.
 *
 * The fallback is not a defect — the key is only learned on first login, so a
 * wallet restored on a fresh browser shows a letter until it is opened once.
 */
export function WalletIcon(props: {
  name: string;
  publicKey?: string | null;
  size?: number;
  className?: string;
}) {
  const size = props.size ?? 36;
  const radius = Math.round(size * 0.28);

  if (!props.publicKey) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.4 }}
        className={`flex shrink-0 items-center justify-center bg-zinc-800 font-bold text-emerald-400 ${props.className ?? ''}`}
      >
        {props.name.charAt(0).toUpperCase()}
      </span>
    );
  }

  const { background, cells, grid } = identiconFor(props.publicKey);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      role="img"
      aria-label={`Identicon for ${props.name}`}
      className={`shrink-0 ${props.className ?? ''}`}
      style={{ borderRadius: radius }}
    >
      <rect width={grid} height={grid} fill={background} />
      {cells.map((c) => (
        // Rendered edge-to-edge with a hair of overlap; sub-pixel gaps between
        // adjacent squares are very visible at 36px.
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x}
          y={c.y}
          width={1.02}
          height={1.02}
          fill={c.color}
        />
      ))}
    </svg>
  );
}
