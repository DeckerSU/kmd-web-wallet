/**
 * Format a decimal string balance: trim to at most `maxFrac` fraction digits,
 * no trailing zeros. The 8-digit default keeps 18-decimal EVM amounts readable
 * in lists; pass a coin's own `decimals` where full precision matters.
 */
export function formatAmount(value: string | null | undefined, maxFrac = 8): string {
  if (!value) return '0';
  const [int, frac = ''] = value.split('.');
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, '');
  return trimmed ? `${int}.${trimmed}` : int;
}

/** Scale a decimal string to an integer number of base units. */
function toBaseUnits(value: string, decimals: number): bigint {
  const negative = value.startsWith('-');
  const [int, frac = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = BigInt(`${int || '0'}${frac.padEnd(decimals, '0').slice(0, decimals)}`);
  return negative ? -scaled : scaled;
}

/**
 * Subtract two decimal strings exactly, at `decimals` precision. Needed because
 * 18-decimal EVM amounts do not survive a round-trip through a JS number.
 */
export function subtractAmounts(a: string, b: string, decimals: number): string {
  const diff = toBaseUnits(a, decimals) - toBaseUnits(b, decimals);
  const negative = diff < 0n;
  const digits = (negative ? -diff : diff).toString().padStart(decimals + 1, '0');
  const int = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

export function shortenAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
