/**
 * When a person rules an uploader's TITLE wrong — the rules, in one place.
 *
 * WHY THIS EXISTS (2026-10-14). The e2e check `fromTitle ⊆ characters` went red
 * on 2026-09-24 and stayed red for three weeks over five sides. All five were
 * CORRECT human reads of WRONG titles: dE1pzpogWsU's title hands NITRO's Black
 * Panther to K7, BhAlz4yHmcM's whole title was copied from a sibling upload, and
 * so on. Each was saved through /dev/bench-review's "drop them and save", which
 * bypassed the title check but recorded nothing — so the stale title claim stayed
 * in `fromTitle` and every check that reads it failed forever, with no way to tell
 * a person's verdict from a misread.
 *
 * The verdict is now RECORDED on the side (types/index.ts CharProvenance):
 *
 *   fromTitle        the title ids the reading CONFIRMS
 *   titleRefuted     the title ids a person ruled wrong
 *   titleRefutedWhy  the evidence, in a sentence a stranger can check
 *   titleRefutedAt   YYYY-MM-DD (UTC)
 *
 * That is the shape the maintainer already chose by hand in 165de8d for
 * Rt6A0-Kq79Q ("Odysseus keeps fromTitle [] because the title states nothing true
 * about that side"), with the claim kept on record instead of deleted.
 *
 * A MODULE OF ITS OWN because four places must apply the SAME rules and none of
 * them can import the others: parse.ts runs main() at import, e2e.ts and
 * verify-gates.ts are scripts, and the /dev writer is Nitro. A rule copied into
 * each drifts — this repo has met that before (the `>=` vs `===` note in e2e.ts).
 * Pure: no I/O, no side effects, safe to import from anywhere.
 */

/** The fields these rules read. Structural, so a videos.json side, an
 *  overrides.json side and a hand-built fixture all fit. */
export interface TitleSide {
  characters: string[];
  provenance: {
    tier?: string;
    fromTitle?: string[];
    fromHuman?: string[];
    conflict?: boolean;
    titleRefuted?: string[];
    titleRefutedWhy?: string;
    titleRefutedAt?: string;
  };
}

/** `titleRefutedAt` is a calendar day, UTC. */
export const REFUTED_AT_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * THE e2e PREDICATE, PER SIDE (scripts/e2e.ts, "fromTitle ⊆ characters on every
 * non-conflicted side"): the title ids this side's characters do not contain.
 * Empty on a `conflict` side, which never reaches videos.json anyway.
 */
export function unmetTitle(s: TitleSide): string[] {
  if (s.provenance.conflict) return [];
  return (s.provenance.fromTitle ?? []).filter((t) => !s.characters.includes(t));
}

/** Everything the title claims for this side: what a person confirmed plus what
 *  they refuted. On a side nobody has refuted, that is simply `fromTitle`. */
export function titleClaim(p: TitleSide['provenance']): string[] {
  return [...new Set([...(p.fromTitle ?? []), ...(p.titleRefuted ?? [])])];
}

/** A day that exists: `2026-13-40` has the shape and no calendar. (An invalid
 *  Date throws from toISOString, so the time value is checked first.) */
const realDay = (d: string): boolean => {
  if (!REFUTED_AT_RE.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

/**
 * WHY A SIDE'S REFUTATION IS NOT A PERSON'S RECORDED VERDICT — empty when it is,
 * or when the side carries none.
 *
 * A refutation is a strong statement ("the uploader was wrong"), and it is the one
 * field that makes the title check pass without the title being met, so the rules
 * are strict and every one of them is a way to silence the check:
 *  · only on a HUMAN-tier side. A machine tier cannot overrule a title — the
 *    footage reader's own gate requires the title fighter to be present.
 *  · never also in `fromTitle`. One id cannot be both confirmed and refuted.
 *    It MAY be in `characters`: a title slot copied wholesale from another upload
 *    can coincide with a fighter the player really fielded (BhAlz4yHmcM side 1,
 *    where Blade is on both teams), and the slot still says nothing true.
 *  · with its evidence and its date. A bare list is indistinguishable from
 *    somebody making the suite green.
 */
export function refutationProblems(s: TitleSide): string[] {
  const p = s.provenance;
  const out: string[] = [];
  if (p.titleRefuted === undefined) {
    if (p.titleRefutedWhy !== undefined || p.titleRefutedAt !== undefined) {
      out.push('titleRefutedWhy/titleRefutedAt with no titleRefuted');
    }
    return out;
  }
  if (!Array.isArray(p.titleRefuted) || p.titleRefuted.length === 0) {
    out.push('titleRefuted is empty');
  }
  if (p.tier !== 'human' || !p.fromHuman?.length) {
    out.push(`on a ${p.tier ?? 'tier-less'} side — only a person's read can refute a title`);
  }
  const both = (p.titleRefuted ?? []).filter((t) => (p.fromTitle ?? []).includes(t));
  if (both.length) out.push(`${both.join(', ')} is both confirmed (fromTitle) and refuted`);
  if (typeof p.titleRefutedWhy !== 'string' || !p.titleRefutedWhy.trim()) {
    out.push('no titleRefutedWhy (the evidence)');
  }
  if (typeof p.titleRefutedAt !== 'string' || !realDay(p.titleRefutedAt)) {
    out.push(`titleRefutedAt ${JSON.stringify(p.titleRefutedAt ?? null)} is not a YYYY-MM-DD day`);
  }
  return out;
}

/**
 * Title ids TODAY'S title names for a human side that its verdict neither
 * confirms nor refutes — and refuted ids today's title no longer names.
 *
 * `freshTitle` is what the parser reads from the title as it stands now, before
 * any override. The e2e predicate cannot see either case: it reads the override's
 * own `fromTitle`, so a hand-trimmed `fromTitle` (the 165de8d edit, before this
 * existed) or an uploader editing the title AFTER the verdict both stay green
 * there. Only parse holds the fresh title, so only parse can report it.
 */
export function unaccountedTitle(
  freshTitle: string[],
  s: TitleSide,
): { unaccounted: string[]; stale: string[] } {
  if (s.provenance.tier !== 'human') return { unaccounted: [], stale: [] };
  const claim = titleClaim(s.provenance);
  return {
    unaccounted: freshTitle.filter((t) => !claim.includes(t)),
    stale: (s.provenance.titleRefuted ?? []).filter((t) => !freshTitle.includes(t)),
  };
}

/** The `fromTitle`/`titleRefuted` pair that would record "the title is wrong" for
 *  the ids a reading omits — what /dev/bench-review writes without `wholeSlot`. */
export function refutationEdit(
  claim: string[],
  characters: string[],
): { fromTitle: string[]; titleRefuted: string[] } {
  return {
    fromTitle: claim.filter((t) => characters.includes(t)),
    titleRefuted: claim.filter((t) => !characters.includes(t)),
  };
}
