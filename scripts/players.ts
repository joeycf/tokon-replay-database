/**
 * PLAYER IDENTITY — which spellings are one person, and what that person is called.
 *
 * `idKey` (scripts/roster.ts) collapses the common case: the same handle written
 * with different spacing or punctuation. This file carries the two things
 * normalisation cannot decide on its own.
 *
 *   HANDLE_ALIASES   two spellings whose ALPHANUMERICS differ — a typo, a
 *                    suffix, a spelling only another game knows. No amount of
 *                    normalising joins "Crome" to "Chrome".
 *   DISTINCT_KEYS    one normalised key that is genuinely TWO people. Without
 *                    this the gate's only options are "merge everything that
 *                    collides" or "never check", and the first one silently
 *                    rewrites a real player's page.
 *
 * CURATED, NEVER INFERRED. The same discipline scripts/characters.ts applies to
 * fighter aliases, and for a harder reason: a wrong fighter alias shortens a
 * side and shows up in the residue report, while a wrong player merge produces a
 * page that looks completely normal and is wrong about who played the matches.
 * Every entry cites the evidence that earned it.
 *
 * The detector that finds candidates is scripts/player-dupes.ts. It proposes;
 * this file is where a person answers.
 */

import { idKey, playerId } from './roster';
import type { MatchVideo, PlayerRecord } from '../types/index';

/**
 * Variant `idKey` → the canonical DISPLAY HANDLE (not an id — the id is derived
 * from the handle, so fixing the spelling fixes the URL too).
 */
export const HANDLE_ALIASES = new Map<string, string>([
  // A letter, not a separator: the uploader dropped the 'h'. Both titles are on
  // the same channel, two days apart, same EVO 2026 exhibition set.
  //   apC2Q13nIH0  "Crome Alchemist VS Cloud805"
  //   KbA1UgtZFO0  "Chrome Alchemist VS Marvel Games"
  ['cromealchemist', 'Chrome Alchemist'],

  // Tōkon writes this player ALL-CAPS both ways it writes him — "NYCHRISG"
  // (fgcReplaysHub) and "NYCHRIS G" (replaysHub) — so the local corpus can pick
  // the id but has no evidence for the casing. sf6-replay-database carries him
  // as "NYChrisG" across 8 records, which is the spelling the FGC uses.
  //
  // Note this does NOT merge him with `chrisg`, who is the same human. Both SF6
  // and 2XKO deliberately carry ChrisG and NYChrisG as separate ids (2XKO's
  // `chrisg` alone has 160 records), and quietly diverging from the siblings on
  // one game would be worse than the split it fixes.
  ['nychrisg', 'NYChrisG'],
]);

/**
 * Normalised keys that legitimately hold more than one player.
 *
 * Empty here — every collision in this corpus is one person. It exists because
 * the gate demands that every collision be either RESOLVED or DECLARED, and
 * "declared" has to be sayable. Tekken has the live cases ("T-Ara" 8 records
 * against "Tara" 7; "Ken" against "K e n").
 */
export const DISTINCT_KEYS = new Set<string>([]);

export interface MergeReport {
  /** canonical id → the ids it absorbed, for the redirect emitter. */
  merged: Map<string, string[]>;
  /** Collisions neither resolved nor declared. Should always be empty; if it
   *  is not, report.md says so and a person decides. */
  undeclared: { key: string; handles: string[] }[];
}

/**
 * Pick the spelling that represents an identity, and rewrite every side to it.
 *
 * THE TIEBREAK, in order, and each rung exists because the one above it ties:
 *
 *   1. mixed case beats ALL-CAPS, by a factor no frequency can overcome.
 *      Titles shout; descriptions and the better channels do not. "SonicFox"
 *      appears on 4 records against "SONICFOX" on 8, and "SonicFox" is right.
 *   2. frequency, among spellings of equal case-quality.
 *   3. fewer separators — the compact form. Reached only when two ALL-CAPS
 *      spellings tie on count, which is exactly the "BALDER BERG" / "BALDERBERG"
 *      shape, and the compact one has always been the real handle here.
 *   4. lexicographic, so a run is reproducible rather than Map-insertion-ordered.
 *
 * Rung 4 is load-bearing despite looking like a formality: without it two
 * equally-weighted spellings resolve by whichever the parser saw first, which
 * changes with upload order, which makes the emitted id — and therefore a live
 * URL — depend on the day the pipeline ran.
 */
export function resolvePlayers(records: MatchVideo[]): MergeReport {
  // key → spelling → weight
  const casing = new Map<string, Map<string, number>>();
  const seenIds = new Map<string, Set<string>>(); // key → ids observed before the merge

  const keyOf = (handle: string): string => {
    const aliased = HANDLE_ALIASES.get(idKey(handle));
    return aliased ? idKey(aliased) : idKey(handle);
  };

  for (const r of records) {
    for (const s of r.sides) {
      const key = keyOf(s.handle);
      if (!key) continue; // an all-CJK handle keys to nothing; guarded at parse
      const variants = casing.get(key) ?? new Map<string, number>();
      // The alias's canonical spelling enters the ballot too, and wins it —
      // it is a human verdict, not another observation.
      const alias = HANDLE_ALIASES.get(idKey(s.handle));
      if (alias) variants.set(alias, (variants.get(alias) ?? 0) + 1_000_000);
      variants.set(s.handle, (variants.get(s.handle) ?? 0) + 1);
      casing.set(key, variants);
      const ids = seenIds.get(key) ?? new Set<string>();
      ids.add(playerId(s.handle));
      seenIds.set(key, ids);
    }
  }

  const isMixed = (h: string): boolean => /[a-z]/.test(h) && /[A-Z]/.test(h);
  const separators = (h: string): number => (h.match(/[^\p{L}\p{N}]/gu) ?? []).length;

  const best = new Map<string, string>();
  for (const [key, variants] of casing) {
    const chosen = [...variants.entries()].sort((a, b) => {
      const [ha, wa] = a;
      const [hb, wb] = b;
      if (isMixed(ha) !== isMixed(hb)) return isMixed(ha) ? -1 : 1; // 1
      if (wa !== wb) return wb - wa; // 2
      const sa = separators(ha);
      const sb = separators(hb);
      if (sa !== sb) return sa - sb; // 3
      return ha.localeCompare(hb); // 4
    })[0]![0];
    best.set(key, chosen);
  }

  for (const r of records) {
    for (const s of r.sides) {
      const key = keyOf(s.handle);
      const handle = best.get(key);
      if (!handle) continue;
      s.handle = handle;
      s.player = playerId(handle);
    }
  }

  const merged = new Map<string, string[]>();
  for (const [key, ids] of seenIds) {
    const canonical = playerId(best.get(key) ?? '');
    const absorbed = [...ids].filter((i) => i && i !== canonical).sort();
    if (absorbed.length) merged.set(canonical, absorbed);
  }
  return { merged, undeclared: [] };
}

/**
 * Collisions the resolution did NOT fix: two players still sharing a normalised
 * key after everything above. Only reachable when HANDLE_ALIASES maps one of
 * them somewhere else, so it is a check on this file rather than on the corpus.
 */
export function undeclaredCollisions(
  players: PlayerRecord[],
): { key: string; handles: string[] }[] {
  const by = new Map<string, string[]>();
  for (const p of players) {
    const k = idKey(p.handle);
    by.set(k, [...(by.get(k) ?? []), p.handle]);
  }
  return [...by.entries()]
    .filter(([k, hs]) => hs.length > 1 && !DISTINCT_KEYS.has(k))
    .map(([key, handles]) => ({ key, handles: handles.sort() }));
}
