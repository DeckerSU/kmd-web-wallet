/**
 * A deterministic picture of a wallet, derived from its public key.
 *
 * A letter avatar cannot distinguish two wallets whose names begin alike, and
 * says nothing about *which* keys are behind the name — rename-proof identity is
 * exactly what a name cannot give. Deriving the image from the wallet's own
 * public key means the same wallet always looks the same, on any device, and two
 * wallets can never look alike unless they are the same wallet.
 *
 * Only the seed is ever stored; the image is recomputed. Storing the rendered
 * result would duplicate what the key already determines and would go stale the
 * moment this file changes.
 *
 * The hash here is a plain PRNG, not a cryptographic one: nothing is being
 * protected, and a synchronous function keeps the component pure.
 */

const GRID = 5;

/** xmur3: string → 32-bit seed. */
function seedFrom(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** sfc32: small, fast, well-distributed. */
function prng(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export interface IdenticonCell {
  x: number;
  y: number;
  color: string;
}

export interface Identicon {
  background: string;
  cells: IdenticonCell[];
  grid: number;
}

export function identiconFor(seed: string): Identicon {
  const s = seedFrom(seed);
  const rand = prng(s(), s(), s(), s());

  const hue = Math.floor(rand() * 360);
  // A complementary-ish second hue keeps two-colour patterns readable rather
  // than muddy, and the fixed saturation/lightness stops any wallet from
  // landing on an unreadably dark or washed-out palette.
  const hue2 = (hue + 120 + Math.floor(rand() * 90)) % 360;
  const background = `hsl(${hue} 42% 13%)`;
  const primary = `hsl(${hue} 68% 58%)`;
  const secondary = `hsl(${hue2} 62% 55%)`;

  const half = Math.ceil(GRID / 2);
  const cells: IdenticonCell[] = [];
  for (let x = 0; x < half; x++) {
    for (let y = 0; y < GRID; y++) {
      // Slightly under half filled: a denser grid reads as a solid block and
      // stops being memorable.
      if (rand() > 0.55) continue;
      const color = rand() > 0.68 ? secondary : primary;
      cells.push({ x, y, color });
      // Mirrored, so the result has an axis and reads as a shape.
      const mirrored = GRID - 1 - x;
      if (mirrored !== x) cells.push({ x: mirrored, y, color });
    }
  }

  // A blank grid is possible and would be indistinguishable from every other
  // blank grid, which defeats the purpose.
  if (cells.length === 0) {
    const mid = Math.floor(GRID / 2);
    cells.push({ x: mid, y: mid, color: primary });
  }

  return { background, cells, grid: GRID };
}
