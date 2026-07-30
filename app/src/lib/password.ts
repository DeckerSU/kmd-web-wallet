/**
 * Client-side mirror of KDF's password policy
 * (komodo-defi-framework/mm2src/common/password_policy.rs) so users get
 * instant feedback instead of a startup failure.
 */

/**
 * Generate a wallet password the user never has to type or invent.
 *
 * Built to satisfy `validateWalletPassword` by construction — one character
 * drawn from each required class, the rest from the full alphabet — and
 * re-rolled if it happens to contain three identical characters in a row, which
 * KDF rejects. The result is shown to the user at creation and in Settings,
 * because with a passkey it is the only credential they could otherwise lose.
 */
export function generateWalletPassword(length = 32): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const special = '!@#$%^&*()-_=+[]{}?';
  const all = lower + upper + digits + special;

  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];

  for (;;) {
    const chars = [pick(lower), pick(upper), pick(digits), pick(special)];
    while (chars.length < length) chars.push(pick(all));

    // Fisher-Yates with CSPRNG indices, so the required classes aren't pinned
    // to the first four positions.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    const candidate = chars.join('');
    if (!validateWalletPassword(candidate)) return candidate;
  }
}

export function validateWalletPassword(password: string): string | null {
  if (password.toLowerCase().includes('password')) {
    return "Password can't contain the word “password”";
  }
  if (password.length < 8) return 'At least 8 characters required';
  if (!/[0-9]/.test(password)) return 'Add at least one digit';
  if (!/[a-z]/.test(password)) return 'Add at least one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Add at least one uppercase letter';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Add at least one special character';
  if (/(.)\1\1/.test(password)) return "Can't repeat the same character 3+ times in a row";
  return null;
}
