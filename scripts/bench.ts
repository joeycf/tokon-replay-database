/**
 * The DESCRIPTION BENCH tier — the middle of the three character sources.
 *
 * WHY THIS EXISTS. The new-game checklist knows two ways to learn what a side
 * played: the title states it, or you read it off the footage. Tōkon sits
 * between them. Its titles carry 1–2 of 4 fighters, and roughly 30% of the
 * corpus states the FULL four-per-side bench in prose in the description:
 *
 *   proReplays        🕹️ AOTOBI (Magik, Doctor Doom, Blade, Black Panther) vs
 *                        FENRITTI (Ghost Rider, Magneto, Magik, Black Panther) 🕹️
 *   highLevelReplays  high level match: Wawa (Magik, Storm, Spider-Man and Blade)
 *                        versus TryKeazer (Danger, Magik, Magneto and Hulk)!
 *   replaysHub        Player 1: HANDLE (Char)     ← ONE per side. Not a bench.
 *
 * A tier readable from text is cheaper, more accurate and far more auditable
 * than one read from pixels, so it is worth finding before building an
 * extractor. (Reported upstream as a checklist gap.)
 *
 * SEPARATORS ARE NEVER PARSED. Every shape here resolves through the same
 * span extraction the title parser uses, so "Magik, Doctor Doom" and
 * "Ghost Rider- Storm- Magik" and "Storm and Blade" are all handled by one code
 * path — and "Spider-Man" survives, which a split on [/-] would not.
 */

import type { AliasMatcher } from './roster';
import type { DescAlign, DescriptionBench } from '../types/index';

/** One side's bench as the description states it. */
export interface BenchSide {
  handle: string;
  characters: string[];
  /** Text the spans did not cover — surfaced, never dropped. */
  residue: string;
}

export interface BenchRead {
  sides: [BenchSide, BenchSide];
}

/**
 * The common outer shape: "<handle> (<names>) <vs|versus|and> <handle> (<names>)".
 *
 * The paren budget is 160 characters, not SF6's 90: four names plus separators
 * ("Ghost Rider, Doctor Doom, Captain America and Black Panther") runs long.
 * Handles are bounded to 50 and forbidden from containing parens, colons or
 * newlines so the match cannot run backwards across a sentence boundary.
 */
const DESC_SIDE_RE =
  /([^():\n!]{1,50}?)\s*\(([^()\n]{1,160})\)\s*(?:versus|vs\.?)\s*([^():\n!]{1,50}?)\s*\(([^()\n]{1,160})\)/iu;

/** replaysHub's shape — one character per side, so it is read for the HANDLE's
 *  nicer casing only. Titles on that channel are ALL CAPS; the description is
 *  where the human spelling lives. */
const PLAYER_LINE_RE = /player\s*([12])\s*:\s*([^\n(]{1,50}?)\s*\(([^()\n]{1,80})\)/giu;

/**
 * fgcReplaysHub's shape — a bare list after "with", no parentheses at all.
 *
 *   "This replay features EDUARDO HOOK with Blade, Storm, Spider Man, Iron Man
 *    vs SUPERNOON with Magik, Spider Man, Green Goblin, Blade."
 *
 * DEFERRED AT ADD-TIME, AND CORRECTLY. The channel had ONE Tokon upload when it
 * was added (channels.ts), and a bench grammar authored against one sample does
 * not fail loudly — it "completes" a 4-slot side with fabricated fighters. It is
 * authored now because the channel has published SIX, all in one grammar, and
 * all 48 names resolve against the roster.
 *
 * THE HANDLE CLASS IS UPPERCASE-ONLY, AND THAT IS THE WHOLE SAFETY ARGUMENT.
 * The obvious class — DESC_SIDE_RE's `[^():\n!]{1,50}?` — is catastrophic here,
 * because this shape has no parenthesis to anchor on and the sentence runs
 * backwards into boilerplate. On the sample above it captures the handle as
 * "This replay features EDUARDO HOOK": 31 characters, under the 40-char guard in
 * parse.ts, so it would OUTRANK the title handle and ship as the player's
 * display name. Requiring `[A-Z0-9]` from the first character cannot start
 * inside "This replay features" — the lowercase 'h' of "This" fails one
 * character in — so the match can only begin at the real handle.
 *
 * There is no `i` flag for exactly that reason: `[A-Z]` under `i` matches
 * lowercase and the guard silently evaporates. The connectors spell both cases
 * out instead.
 *
 * A lowercase handle therefore returns null and the record simply stays
 * incomplete. That is the correct direction to fail: a refused bench costs a
 * partially-known side, a wrong one ships a confidently mislabelled record.
 */
const DESC_WITH_RE =
  /([A-Z0-9][A-Z0-9 '._-]{0,49}?)\s+[Ww]ith\s+([^()\n]{1,160}?)\s+(?:[Vv]ersus|[Vv][Ss]\.?)\s+([A-Z0-9][A-Z0-9 '._-]{0,49}?)\s+[Ww]ith\s+([^()\n]{1,160}?)\s*(?=[.\n]|$)/u;

/**
 * Read a description's bench, if its channel states one.
 *
 * Returns null when the shape does not appear — which is the common case and
 * not an error. A boilerplate description is simply not a source.
 */
export function readBench(
  description: string,
  shape: DescriptionBench | undefined,
  matcher: AliasMatcher,
): BenchRead | null {
  if (!shape) return null;
  // Bound the search: uploader descriptions end in hashtag soup and link farms
  // that can contain fighter names belonging to no side at all.
  const text = description.normalize('NFC').slice(0, 900);

  if (shape === 'player-lines') {
    const found: Record<string, { handle: string; chars: string }> = {};
    for (const m of text.matchAll(PLAYER_LINE_RE))
      found[m[1]!] = { handle: m[2]!.trim(), chars: m[3]! };
    if (!found['1'] || !found['2']) return null;
    return {
      sides: (['1', '2'] as const).map((k) => ({
        handle: found[k]!.handle,
        characters: matcher.ids(found[k]!.chars),
        residue: matcher.residue(found[k]!.chars),
      })) as [BenchSide, BenchSide],
    };
  }

  if (shape === 'prose-with') {
    const w = DESC_WITH_RE.exec(text);
    if (!w) return null;
    return {
      sides: [
        { handle: w[1]!.trim(), characters: matcher.ids(w[2]!), residue: matcher.residue(w[2]!) },
        { handle: w[3]!.trim(), characters: matcher.ids(w[4]!), residue: matcher.residue(w[4]!) },
      ],
    };
  }

  // 'prose-comma' and 'prose-and' share one outer shape; the separators between
  // names differ and are precisely what span extraction ignores.
  const m = DESC_SIDE_RE.exec(text);
  if (!m) return null;
  return {
    sides: [
      { handle: m[1]!.trim(), characters: matcher.ids(m[2]!), residue: matcher.residue(m[2]!) },
      { handle: m[3]!.trim(), characters: matcher.ids(m[4]!), residue: matcher.residue(m[4]!) },
    ],
  };
}

/** Normalised comparison key for a handle. */
const idKey = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * Align the description's two sides to the TITLE's two sides.
 *
 * Returns the bench in TITLE order, or null with a reason.
 *
 * NEVER POSITIONAL. One channel reverses its second title slot on 27 of 34
 * uploads, so "the description follows the title's order" is an assumption that
 * would compound one order error with another and produce a record that looks
 * complete and attributes four fighters to the wrong player. The two signals
 * used instead, strongest first:
 *
 *   1. HANDLE CORRESPONDENCE. Both prose shapes state handles, so this resolves
 *      almost everything and is essentially unfalsifiable when it matches.
 *   2. CHARACTER CONTAINMENT. The title's ids for a side must be a subset of
 *      exactly ONE description side's bench. Ambiguous on mirror-ish teams,
 *      which is common on a 21-fighter roster where Magik is everywhere.
 *   3. Otherwise REFUSE. The bench is discarded for that record and counted.
 *      A refused alignment costs a partially-known side; a wrong one ships a
 *      confidently mislabelled record.
 */
export function alignBench(
  bench: BenchRead,
  titleHandles: [string, string],
  titleChars: [string[], string[]],
): { sides: [BenchSide, BenchSide]; how: DescAlign } | { sides: null; how: DescAlign } {
  const [b0, b1] = bench.sides;
  const [t0, t1] = titleHandles.map(idKey) as [string, string];
  const [d0, d1] = [idKey(b0.handle), idKey(b1.handle)];

  // 1 — handle correspondence, in both orientations
  if (d0 && d1) {
    if (d0 === t0 && d1 === t1) return { sides: [b0, b1], how: 'handle' };
    if (d0 === t1 && d1 === t0) return { sides: [b1, b0], how: 'handle' };
  }

  // 2 — character containment, and only when exactly one orientation works
  const subset = (a: string[], b: string[]) => a.length > 0 && a.every((x) => b.includes(x));
  const straight = subset(titleChars[0], b0.characters) && subset(titleChars[1], b1.characters);
  const swapped = subset(titleChars[0], b1.characters) && subset(titleChars[1], b0.characters);
  if (straight && !swapped) return { sides: [b0, b1], how: 'character-subset' };
  if (swapped && !straight) return { sides: [b1, b0], how: 'character-subset' };

  // 3 — refuse
  return { sides: null, how: 'ambiguous' };
}
