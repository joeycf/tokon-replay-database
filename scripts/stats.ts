// Shared counting, extracted so parse.ts and the standalone emit.ts derive
// IDENTICAL numbers from the same substrate — the double-emit byte-identity
// gate in scripts/e2e.ts depends on it.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE STAT UNIT, DECLARED: SIDE APPEARANCES.
//
// Every character on a side counts once for that side, so a fighter appearing
// on BOTH sides of a replay adds 2. A saturated 4v4 record therefore
// contributes 8. The same denominator drives characterUsage, byPatchUsage and
// playerCharacters, which is what makes the usage bars, the meta timeline and
// the player tables agree — emit asserts the total against the summed side
// lengths rather than against records × 8.
//
// The engine explicitly offers a choice here (types/stats.ts): a 1v1 game
// counts side appearances, and "a tag game on a shared roster may instead count
// a per-record deduped union". Tōkon takes side appearances anyway, because the
// question this archive answers is *how often was this fighter fielded*, not
// *how many replays feature them*. With 21 fighters in 4 slots, side overlap is
// common — Magik appears on both sides often — and de-duplicating would quietly
// erase half of those real fieldings.
//
// It has a second, practical virtue: side appearances is the only unit that
// makes `Σ characterUsage === Σ side.characters.length` an assertion emit can
// actually make. Sides here are 1..4 long (titles give 1–2 and the bench fills
// in over time), so `records × 8` is NOT the expected total and nobody should
// "fix" it to be.
//
// pairingUsage / playerPairings are deliberately ABSENT at v1. At
// charactersPerSide: 4 a side yields C(4,2) = 6 pairs against a duo's 1, which
// is a genuine synergy feature to design deliberately rather than absorb at
// launch. Every engine duo panel self-hides on an empty pair set, so the app
// renders correctly without them. What unblocks the work: decide how oversize
// sides (mid-set team changes, >4) are excluded and report the excluded count —
// naive C(n,2) over one fabricates pairs that were never played, and
// fabrication poisons a synergy panel silently while under-counting stays
// recoverable.
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchVideo } from '../types/index';

export interface PipelineStats {
  characterUsage: Record<string, number>;
  /** season key ('1' | '2' | …) → characterId → side appearances */
  bySeasonUsage: Record<string, Record<string, number>>;
  playerCharacters: Record<string, Record<string, number>>;
  totals: { videos: number; bySeason: Record<string, number> };
  /** Sides longer than charactersPerSide — mid-set team changes. Legal data,
   *  counted in usage above, and reported here because they are the population
   *  any future pairing surface must exclude. */
  oversizeSides: number;
}

/** Sort a flat object by key — byte-stable output across runs. */
export const sort1 = <T>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** Sort a nested object by key at both levels. */
export const sort2 = (
  o: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> =>
  Object.fromEntries(
    Object.entries(o)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sort1(v)]),
  );

/** The game's format. Not a cap — see types/index.ts MatchSide. */
export const CHARACTERS_PER_SIDE = 4;

export function buildStats(records: MatchVideo[]): PipelineStats {
  const characterUsage: Record<string, number> = {};
  const bySeasonUsage: Record<string, Record<string, number>> = {};
  const playerCharacters: Record<string, Record<string, number>> = {};
  const bySeason: Record<string, number> = {};
  let oversizeSides = 0;

  for (const v of records) {
    const skey = String(v.season);
    bySeason[skey] = (bySeason[skey] ?? 0) + 1;
    bySeasonUsage[skey] ??= {};

    for (const s of v.sides) {
      if (s.characters.length > CHARACTERS_PER_SIDE) oversizeSides += 1;
      playerCharacters[s.player] ??= {};
      for (const c of s.characters) {
        characterUsage[c] = (characterUsage[c] ?? 0) + 1;
        bySeasonUsage[skey]![c] = (bySeasonUsage[skey]![c] ?? 0) + 1;
        playerCharacters[s.player]![c] = (playerCharacters[s.player]![c] ?? 0) + 1;
      }
    }
  }

  return {
    characterUsage: sort1(characterUsage),
    bySeasonUsage: sort2(bySeasonUsage),
    playerCharacters: sort2(playerCharacters),
    totals: { videos: records.length, bySeason: sort1(bySeason) },
    oversizeSides,
  };
}
