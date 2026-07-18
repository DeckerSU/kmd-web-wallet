/**
 * Client-side mirror of KDF's password policy
 * (komodo-defi-framework/mm2src/common/password_policy.rs) so users get
 * instant feedback instead of a startup failure.
 */

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
