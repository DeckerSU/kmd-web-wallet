/** Format a decimal string balance: trim to at most 8 fraction digits, no trailing zeros. */
export function formatAmount(value: string | null | undefined): string {
  if (!value) return '0';
  const [int, frac = ''] = value.split('.');
  const trimmed = frac.slice(0, 8).replace(/0+$/, '');
  return trimmed ? `${int}.${trimmed}` : int;
}

export function shortenAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
