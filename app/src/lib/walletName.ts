/**
 * Suggested wallet names, so creating a wallet needs no typing at all.
 *
 * A name is permanent: KDF exposes `delete_wallet` but no rename, so whatever is
 * chosen here stays with the wallet for its lifetime. It is also not purely
 * internal — passkey credentials are discoverable, which means the authenticator
 * stores the wallet name and it shows up in the OS passkey manager. Both push the
 * same way: names should be short, readable and easy to tell apart out loud,
 * rather than opaque ids.
 *
 * Hence capitalised adjective-noun pairs with a five-digit suffix, as in
 * `Willow-Lynx-01584`. The words carry the recognisability; the number carries
 * the uniqueness, so two wallets can share a pleasant name without colliding.
 * The lists are deliberately calm and concrete - nothing that reads oddly next
 * to someone's money, and no words that sound alike when spoken.
 */

const ADJECTIVES = [
  'amber', 'arctic', 'autumn', 'brave', 'bright', 'calm', 'clever', 'coral',
  'crimson', 'crystal', 'dawn', 'deep', 'dusty', 'eager', 'early', 'ember',
  'fair', 'fleet', 'gentle', 'golden', 'granite', 'green', 'hidden', 'humble',
  'indigo', 'ivory', 'jade', 'keen', 'lively', 'lunar', 'mellow', 'misty',
  'noble', 'olive', 'patient', 'polar', 'quiet', 'rapid', 'rustic', 'sable',
  'scarlet', 'silent', 'silver', 'solar', 'steady', 'stellar', 'sunny', 'swift',
  'tidal', 'velvet', 'vivid', 'warm', 'willow', 'winter',
];

const NOUNS = [
  'alder', 'anchor', 'aspen', 'badger', 'basin', 'beacon', 'birch', 'canyon',
  'cedar', 'comet', 'cove', 'crane', 'delta', 'dune', 'eagle', 'falcon',
  'fjord', 'forest', 'fox', 'garnet', 'glacier', 'harbor', 'heron', 'island',
  'juniper', 'kestrel', 'lagoon', 'lantern', 'lynx', 'maple', 'marmot',
  'meadow', 'mesa', 'nebula', 'oasis', 'orchid', 'otter', 'peak', 'pine',
  'quartz', 'raven', 'reef', 'ridge', 'river', 'sable', 'sparrow', 'spruce',
  'summit', 'thicket', 'tundra', 'valley', 'willow',
];

const randomBelow = (n: number): number =>
  crypto.getRandomValues(new Uint32Array(1))[0] % n;

const pick = (list: readonly string[]): string => {
  const word = list[randomBelow(list.length)];
  return word.charAt(0).toUpperCase() + word.slice(1);
};

/** Five digits, zero-padded, so every name is the same shape. */
const suffix = (): string => String(randomBelow(100_000)).padStart(5, '0');

/**
 * A name not already in `taken`.
 *
 * The pair space is ~2800 combinations, so for any realistic number of wallets a
 * few random draws suffice. The numeric suffix is a guarantee rather than an
 * expectation — it exists so this can never loop forever or return a duplicate,
 * which would collide with KDF's wallet keys and with the passkey records keyed
 * by the same name.
 */
export function generateWalletName(taken: readonly string[] = []): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));

  // The suffix alone makes a repeat unlikely; the check makes it impossible,
  // which matters because the name keys both KDF's wallet store and the passkey
  // records, and a duplicate would quietly point at the wrong wallet.
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = `${pick(ADJECTIVES)}-${pick(NOUNS)}-${suffix()}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }

  const base = `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
  for (let n = 0; ; n++) {
    const candidate = `${base}-${String(n).padStart(5, '0')}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
