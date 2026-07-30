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
 * Hence adjective-noun pairs. The lists are deliberately calm and concrete —
 * nothing that reads oddly next to someone's money, and no words that sound
 * alike when spoken.
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

const pick = <T,>(list: readonly T[]): T =>
  list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];

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

  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
    if (!used.has(candidate)) return candidate;
  }

  const base = `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
