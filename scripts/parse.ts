/**
 * Stage 2: raw/<channel>.json → data/videos.json (+ players, queues, report),
 * then emit the engine artifacts.
 *
 * Run: npm run data:parse
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { alignBench, readBench } from './bench';
import { ACTIVE_CHANNELS, CHANNELS, stripTheaterSponsor } from './channels';
import { applyOverrides, emitGeneric } from './emit';
import { crossCheck, formatCrossCheck, type WitnessFile } from './crosscheck';
import { CHARACTERS_PER_SIDE } from './stats';
import { resolveKey, resolvePlayers, undeclaredCollisions } from './players';
import { dueExpiries, expiryBlock } from './expiries';
import { LAUNCH, SEASONS, seasonForDate } from './patches';
import { buildAliasMatcher, loadCharacters, playerId, stripLeaderboard } from './roster';
import type {
  BenchQueueItem,
  CharacterRecord,
  CharProvenance,
  CharTier,
  ChannelConfig,
  ChannelKey,
  MatchSide,
  MatchVideo,
  PlayerRecord,
  RawVideoRecord,
  ReviewQueueItem,
  SlotOrder,
  SourcePins,
  TheaterRawRecord,
  VideoOverride,
} from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const args = process.argv.slice(2);
const allowCollapse = new Set(
  (args.find((a) => a.startsWith('--allow-collapse='))?.split('=')[1] ?? '')
    .split(',')
    .filter(Boolean),
);

// ─────────────────────────────────────────────────────────────────────────────
// THE GAME-MARKER GATE — runs FIRST, before anything structural.
//
// Mandatory here, not defensive. Two channels make it so:
//
//  · proReplays rebranded from "2XKO Pro Replays". Its 1,317 2XKO uploads are
//    unlisted rather than deleted and use an IDENTICAL "▰ HANDLE (Chars) vs
//    HANDLE (Chars) ▰ … Pro level replays" grammar. Re-list them and they parse
//    cleanly as Tōkon — players, characters, durations, all of it.
//  · hadoukenReplays publishes 729 uploads across many fighting games in ONE
//    ▰ grammar; 533 of them are match-shaped and only ~36 are this game.
//
// So the gate is the difference between an archive and a mixture. It runs in
// both directions plus a date floor, because a marker can be absent OR wrong.
//
// NFC first: Ō arrives precomposed (U+014C) from some uploaders and decomposed
// (O + U+0304) from others, and TŌKON / TOKON / Tokon all appear. Titles that
// only matched after decomposition are counted, so a new spelling surfaces as a
// number rather than as silence.
// ─────────────────────────────────────────────────────────────────────────────
const TOKON_RE = /\bT[ŌO]KON\b|マーベル闘魂|\bFIGHTING\s+SOULS\b/iu;
const OTHER_GAME_RE =
  /\b2XKO\b|\bSF6\b|\bSTREET\s*FIGHTER\b|\bTEKKEN\b|\bGUILTY\s*GEAR\b|\bGRANBLUE\b|\bMORTAL\s*KOMBAT\b|\bMK1\b|\bDBFZ\b|\bDRAGON\s*BALL\b|\bUNI\s*2\b|\bKOF\b|\bBLAZBLUE\b|\bMELTY\b|\bRIVALS\b|\bSMASH\b|\bPOKK[ÉE]N\b|\bFATAL\s*FURY\b|\bCOTW\b|\bVIRTUA\s*FIGHTER\b/iu;

/** Content that is not a competitive human-vs-human match. Deliberately does
 *  NOT test /Top \d+/ — that reads "Top 8" out of real tournament matches and
 *  is the filter that cost SF6 real records. */
export const NOT_A_MATCH_RE =
  /\bCPU\b|HARDEST\s*AI|MAX\s*DIFFICULTY|#shorts|COMBO\s*(?:EXHIBITION|VIDEO|GUIDE)|\bTRAILER\b|TIER\s*LIST|STORY\s*MODE|WALKTHROUGH|ALL\s*(?:SUPERS|CHARACTERS|WIN)|COMPILATION|\bINTRO\b|BETA\s*TEST|\bREVIEW\b|GAMEPLAY\s*OVERVIEW|CHARACTER\s*GUIDE|\bRANKING\b|\bTUTORIAL\b|MOD\s*SHOWCASE/iu;

/**
 * The event-brand gate for `eventsOnly` channels (marvelTokonYT).
 *
 * DELIBERATELY TIGHT, and the asymmetry is the reason. On an events-only
 * channel an unrecognised brand drops the record and prints a `not-an-event`
 * count in report.md — visible, countable, fixed by adding one alternative
 * here. An over-broad pattern instead publishes an ordinary ranked replay under
 * the Tournament chip, where nothing looks wrong and nothing is counted. So the
 * pattern requires an event BRAND and never a bare round word: "Top 8",
 * "Pools", "Grand Finals" and "Winners Semis" all appear in online-replay
 * titles across this platform's corpora, and SF6 already paid for reading
 * /Top \d+/ as a signal (see NOT_A_MATCH_RE above).
 *
 * Corpus-derived from marvelTokonYT's 47 uploads (CEO 2026, EVO 2026) plus the
 * majors a Tōkon channel would plausibly cover next. Not aspirational: every
 * brand a run drops shows up in the miss table, so the list grows from evidence.
 */
const EVENT_RE = new RegExp(
  [
    '\\bCEO\\s*\\d{4}\\b',
    '\\bCEOtaku\\b',
    '\\bEVO\\b',
    'evo\\s*japan',
    'evo\\s*france',
    'combo\\s*breaker',
    'frosty\\s*faustings',
    'east\\s*coast\\s*throwdown',
    '\\bECT\\b',
    'the\\s*mix[- ]?up',
    'kumite\\s*in\\s*tennessee',
  ].join('|'),
  'iu',
);

/** The online-branding marker. A title carrying it is this channel's daily
 *  replay output even when an event word also appears, so it vetoes the event
 *  gate rather than tie-breaking against it. Zero of the 47 uploads carry both
 *  today; the veto exists so the day one does, it lands on the safe side. */
const ONLINE_BRAND_RE = /high[\s-]*level\s*(?:match|gameplay|replays?)/iu;

type MissReason =
  | 'not-tokon'
  | 'not-an-event'
  | 'other-game'
  | 'pre-launch'
  | 'live-or-upcoming'
  | 'short-duration'
  | 'not-a-match'
  | 'bench-conflict'
  | 'no-vs-title'
  | 'slot-ambiguous'
  | 'char-unresolved'
  | 'bad-handle';

interface Miss {
  id: string;
  channel: ChannelKey;
  title: string;
  reason: MissReason;
  detail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TITLE PARSING — four observed grammars, one parser.
//
//   a  "Marvel Tokon ▰ HANDLE (Chars) vs HANDLE (Chars) ▰ Pro level replays"
//   b  "TOKON ▰ HANDLE (Chars) vs (Chars) HANDLE 👊【MARVEL TŌKON: Fighting Souls】"
//      — and the SAME tail in ASCII brackets, "👊[MARVEL TŌKON: Fighting Souls]".
//        53 titles use 【】, 17 use []. Modelling only the full-width form is
//        what let the tail ride into a handle; see BRACKET_TAIL_RE below.
//   c  "HANDLE (Chars) vs HANDLE (Chars) ▰ MARVEL TOKON: High Level Gameplay"
//   d  side 2 reversed:  "(Chars) HANDLE"   — 27 of 34 on one channel
//
// The insight that collapses them: in EVERY variant the characters sit inside
// the parentheses and the handle is whatever remains of that side. So the
// parser never chooses a slot order — it finds the paren wherever it is, takes
// the rest as the handle, and RECORDS which order it saw as telemetry. A
// channel changing its grammar then shows up as a shift in the mix instead of
// as a silent drop.
//
//   e  "Marvel Tokon ➤ HANDLE (Chars) vs HANDLE (Chars) ✦ High Level Match"
//      — and the events form, "HANDLE (Chars) vs HANDLE (Chars) ➤ CEO 2026 …".
//        marvelTokonYT's older grammar: the SAME shape as (a) and (c), drawn
//        with different glyphs. It switched to ▰ mid-August and its back
//        catalogue kept ➤/✦.
//
// The affixes are cut RELATIVE TO THE PARENS rather than by counting them:
// everything up to the last affix that precedes the first "(", and everything
// from the first affix that follows the last ")". That is what makes variant
// (c) — where the affix appears only as a suffix — work without a special case,
// and it can never eat into a side segment.
//
// WHY THE AFFIX IS A CLASS AND NOT A CHARACTER. Reading only ▰ does not fail
// loudly on grammar (e); it fails by leaving the affix INSIDE a side segment,
// where the remainder-is-the-handle rule then swallows it. Measured on
// marvelTokonYT's 47 uploads before it was added: 5 CEO titles died at the
// 40-char bad-handle refusal ("Fenritti ➤ CEO 2026 - MARVEL Tokon - Top 192
// Winners"), and its EVO titles produced handles like "Marvel Tokon ➤ Nerdjosh"
// — short enough to pass every check and mint a player page. The first failure
// is loud, the second is not, and the second is the one that matters.
//
// Safe to widen: across the 384 committed records every title uses ▰ and NONE
// contains ➤ or ✦, so no existing core changes. Verified against
// data/videos.json before the class was introduced.
// ─────────────────────────────────────────────────────────────────────────────

/** The affix glyphs channels use to fence the sides off from their branding.
 *  Add to this only with a measurement: a glyph that also appears mid-handle
 *  would cut a side segment in half. */
const AFFIX = ['▰', '➤', '✦'];
const AFFIX_ANY_RE = /[▰➤✦]/u;
const AFFIX_SPLIT_RE = /[▰➤✦]/gu;

/** The last affix at or before `from`, searching backwards. -1 when there is
 *  none — the same contract as String#lastIndexOf, which this replaces. */
const lastAffixBefore = (s: string, from: number): number =>
  Math.max(...AFFIX.map((a) => s.lastIndexOf(a, from)));

/** The first affix at or after `from`, or -1. */
const firstAffixAfter = (s: string, from: number): number => {
  const hits = AFFIX.map((a) => s.indexOf(a, from)).filter((i) => i >= 0);
  return hits.length ? Math.min(...hits) : -1;
};

// BOTH bracket families. hadoukenReplays publishes the same tail two ways — 53
// titles with 【MARVEL TŌKON: Fighting Souls】 and 17 with the ASCII
// [MARVEL TŌKON: Fighting Souls] — and only the full-width form was modelled.
// The ASCII form rode all the way into the handle of whichever side came last:
// these titles carry only a LEADING ▰, so core() has no trailing ▰ to cut
// against; EMOJI_TAIL_RE is anchored at $ and "]" is not in its class (which is
// also why the 👊 survived); and cleanHandle's trim class has no "]" either.
//
// It cost two things. It minted 12 junk players ("DIAPHONE [MARVEL TŌKON:
// Fighting Souls]"), and — worse — it pushed 3 records past the 40-char
// bad-handle refusal at :396 and deleted them outright. The longest surviving
// junk handle was 39 of 40, so the corpus sat on both sides of that edge: short
// names minted junk players, long names were silently discarded.
//
// Safe to widen: across 6,132 raw titles on six channels, no bracket character
// of any kind appears mid-title, and all 70 tails carry the same game name.
// NOT parens — fightingStationX has 36 trailing (…) and the chars-first grammar
// depends on a real trailing paren (slot(), below).
const BRACKET_TAIL_RE = /\s*(?:【[^】]*】|\[[^\]]*\])\s*$/u;
const EMOJI_TAIL_RE = /[\p{Extended_Pictographic}️‍\s|·—–-]+$/u;

interface Slot {
  handle: string;
  chars: string;
  order: SlotOrder;
}

function core(title: string): string | null {
  let s = title.normalize('NFC').replace(/\s+/g, ' ').trim();
  s = s.replace(BRACKET_TAIL_RE, '').replace(EMOJI_TAIL_RE, '').trim();

  // The vs separator is the one thing every variant has; the parens are not.
  // Anchoring on vs (widened to the parens when they exist) means a title that
  // states NO characters still yields a core, which is what lets it reach the
  // review queue as character-completion instead of being dropped as
  // unparseable. Anchoring on the paren alone silently discarded those.
  const vs = /\s+(?:vs\.?|versus)\s+/iu.exec(s);
  if (!vs) return null;
  const firstParen = s.indexOf('(');
  const lastParen = s.lastIndexOf(')');
  const anchorStart = firstParen >= 0 && firstParen < vs.index ? firstParen : vs.index;
  const anchorEnd = lastParen > vs.index ? lastParen : vs.index + vs[0].length;

  // Cut the affixes RELATIVE TO THE ANCHOR rather than by counting them:
  // everything up to the last affix preceding the sides, and everything from
  // the first affix following them. That is what makes the suffix-only variant
  // ("HANDLE (Char) vs HANDLE (Char) ▰ …") work with no special case, and it
  // can never eat into a side segment.
  let start = 0;
  let end = s.length;
  const lead = lastAffixBefore(s, anchorStart);
  if (lead >= 0) start = lead + 1;
  const trail = firstAffixAfter(s, anchorEnd);
  if (trail >= 0) end = trail;

  s = s.slice(start, end).replace(EMOJI_TAIL_RE, '').trim();
  // An affix still inside the core means a mid-title accolade ("▰ Rank 1 NA ▰")
  // we have not modelled. Refuse rather than guess where the sides begin.
  return AFFIX_ANY_RE.test(s) ? null : s;
}

function splitSides(coreText: string): [string, string] | null {
  const parts = coreText.split(/\s+(?:vs\.?|versus)\s+/iu);
  return parts.length === 2 ? [parts[0]!, parts[1]!] : null;
}

/** Extract one side's paren wherever it sits. Returns null when the segment
 *  holds no paren, or 2+ — which is a guess we refuse to make. */
function slot(segment: string): Slot | null | 'ambiguous' {
  const parens = [...segment.matchAll(/\(([^()]*)\)/g)];
  if (parens.length === 0) return null;
  if (parens.length > 1) return 'ambiguous';
  const m = parens[0]!;
  const handle = (segment.slice(0, m.index) + segment.slice(m.index + m[0].length)).trim();
  return { handle, chars: m[1]!, order: m.index === 0 ? 'chars-first' : 'handle-first' };
}

/**
 * The PARALLEL-LISTS grammar — Fighting Station X's, and the fifth variant.
 *
 *   "Star Lord vs Black Panther ▰ High Level Gameplay ▰ Cloud805 vs bleed ▰ Marvel Tokon…"
 *    └─ characters ─┘                                   └─ handles ─┘
 *
 * Characters and players are stated in DIFFERENT ▰ segments, with no
 * parentheses binding them. The paren parser cannot see it: both slots come
 * back empty, and the naive reading queues the record as "characters unknown"
 * while capturing "Star Lord" and "Black Panther" as the PLAYER handles. That
 * is not a miss, it is wrong data — accepting one would mint a player page
 * named after a fighter.
 *
 * Resolution: split on ▰, then classify each `X vs Y` segment by whether its
 * sides resolve to roster ids. Exactly one segment must resolve on both sides
 * (the characters) and exactly one must resolve on neither (the handles).
 * Anything else is ambiguous and refused.
 *
 * ATTRIBUTION IS POSITIONAL HERE, AND THAT IS RECORDED. Every other grammar
 * binds a handle to its characters inside one paren, so no assumption is
 * needed; this one pairs two independent lists by index. The platform has
 * measured title-order attribution wrong 11–38% of the time across three
 * corpora, so these sides carry `slotOrder: 'parallel-lists'` in their
 * provenance — visible in the report, and the population the extractor should
 * verify first.
 */
function parallelLists(
  title: string,
  matcher: { ids(t: string): string[] },
): { handles: [string, string]; chars: [string[], string[]] } | null {
  const segments = title
    .normalize('NFC')
    .replace(BRACKET_TAIL_RE, '')
    .split(AFFIX_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 3) return null;

  const charSegs: [string[], string[]][] = [];
  const handleSegs: [string, string][] = [];
  for (const seg of segments) {
    const parts = seg.split(/\s+(?:vs\.?|versus)\s+/iu);
    if (parts.length !== 2) continue;
    const [a, b] = parts as [string, string];
    const ia = matcher.ids(a);
    const ib = matcher.ids(b);
    if (ia.length && ib.length) charSegs.push([ia, ib]);
    else if (!ia.length && !ib.length) {
      const [ha, hb] = [cleanHandle(a), cleanHandle(b)];
      if (ha && hb && ha.length <= 40 && hb.length <= 40) handleSegs.push([ha, hb]);
    }
  }
  if (charSegs.length !== 1 || handleSegs.length !== 1) return null;
  return { handles: handleSegs[0]!, chars: charSegs[0]! };
}

const cleanHandle = (h: string): string =>
  h
    .normalize('NFC')
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/^[\s|·—–\-:,."']+|[\s|·—–\-:,."']+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

// ── the index intake's record builder ────────────────────────────────────────
//
// A THIRD CONSTRUCTION PATH, beside the title parse and the review-verdict
// adoption. The catalogue arrives structured — handles, characters, event tag
// and offset are separate fields — so there is no title to parse and none of
// core()/splitSides()/slot() applies. The title these records carry was
// SYNTHESIZED by the fetcher from these same fields.
//
// TRUST TIER. Third-party curation is weaker provenance than either of the
// other two paths, so it takes the STRICTER of their gates, not the looser:
// characters resolve on an EXACT alias only — no fuzzy ladder, no matcher —
// and an unresolved token is dropped to residue rather than guessed. A side
// that loses a character to residue simply ships shorter, which is a state this
// contract already blesses; a side that loses all of them is a miss.
function buildTheaterRecords(
  ch: ChannelConfig,
  dump: TheaterRawRecord[],
  ctx: {
    committed: MatchVideo[];
    overrides: Record<string, VideoOverride>;
    rawSeen: Map<string, string>;
    characters: CharacterRecord[];
    skipped: { videoId: string; tag: string; where: string }[];
    residue: { id: string; raw: string }[];
    byIdForQueue: Map<
      string,
      { channel: ChannelKey; title: string; publishedAt: string; durationSec: number }
    >;
  },
): MatchVideo[] {
  // ── ignore-if-known, and it runs FIRST ────────────────────────────────────
  // If this repo has already ruled on a video IN ANY CAPACITY, the catalogue
  // entry is ignored. Not merged, not preferred — ignored. The predicate is
  // known-ANYWHERE rather than merely in-records, because an id excluded as
  // wrong-game or dropped as a duplicate must not re-enter through a side door;
  // those verdicts are the whole point of overrides.json.
  //
  // It keys on the VIDEO id, not the record id. A composite id can never equal
  // an 11-character YouTube id, so comparing record ids would match nothing and
  // the rule would silently never fire.
  //
  // The videos.json arm is unconditional. The reference reads it only when
  // something is being carried, which is a bug waiting for a repo with no
  // frozen channel — this one — where it would leave that arm dark on exactly
  // the run that rebuilds.
  const knownAnywhere = new Map<string, string>();
  const note = (id: string, where: string) => {
    if (!knownAnywhere.has(id)) knownAnywhere.set(id, where);
  };
  for (const [id, where] of ctx.rawSeen) note(id, where);
  for (const v of ctx.committed) note(v.id, `videos.json (${v.intake})`);
  for (const [id, ov] of Object.entries(ctx.overrides)) {
    note(id, ov.exclude === true ? 'overrides.json (excluded)' : 'overrides.json');
  }

  const kept: TheaterRawRecord[] = [];
  for (const r of dump) {
    const where = knownAnywhere.get(r.videoId);
    if (where) ctx.skipped.push({ videoId: r.videoId, tag: r.tag, where });
    else kept.push(r);
  }

  // ── duplicate ids across intakes ──────────────────────────────────────────
  // Structurally impossible today — every index id contains "@" and no other
  // intake's does — which is exactly why it is worth asserting rather than
  // assuming. Ids are the primary key of videos.json and overrides.json, so a
  // collision does not error downstream: one record silently replaces the
  // other. Names both intakes so the fix is obvious.
  const byId = new Map<string, string>();
  for (const [id, where] of ctx.rawSeen) byId.set(id, where);
  for (const v of ctx.committed)
    if (v.intake !== ch.id) byId.set(v.id, `videos.json (${v.intake})`);
  const collisions: string[] = [];
  const seenHere = new Set<string>();
  for (const r of kept) {
    const other = byId.get(r.id);
    if (other) collisions.push(`  ${r.id}: ${ch.id} vs ${other}`);
    if (seenHere.has(r.id)) collisions.push(`  ${r.id}: ${ch.id} vs ${ch.id}`);
    seenHere.add(r.id);
  }
  if (collisions.length > 0) {
    throw new Error(
      [
        `${collisions.length} record id(s) claimed by two intakes — nothing written:`,
        ...collisions.slice(0, 20),
        collisions.length > 20 ? `  … ${collisions.length - 20} more` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  // ── exact-alias character resolution ──────────────────────────────────────
  // Name and every declared alias, lowercased. The character ID is deliberately
  // NOT a key: ids are ours, the catalogue writes display names, and admitting
  // ids here would let a coincidence resolve.
  const byAlias = new Map<string, string>();
  for (const c of ctx.characters) {
    byAlias.set(c.name.trim().toLowerCase(), c.id);
    for (const a of c.extra?.aliases ?? []) byAlias.set(a.trim().toLowerCase(), c.id);
  }

  // The date floor, applied HERE and explicitly. An index intake never enters
  // the ACTIVE_CHANNELS loop, so it never reaches the floor that gates every
  // fetched channel — which would leave it with no floor at all rather than the
  // global one. Per channel, like every other floor in this file.
  const floor = ch.preReleaseFrom ?? LAUNCH;

  const out: MatchVideo[] = [];
  for (const r of kept) {
    if (r.publishedAt.slice(0, 10) < floor) continue;

    const sides: MatchSide[] = [];
    for (let i = 0; i < 2; i++) {
      // Sponsor prefix stripped, and it must be stripped rather than split:
      // "|" is not a duo delimiter in this catalogue.
      const handle = stripTheaterSponsor(r.players[i] ?? '');
      const ids: string[] = [];
      const unresolved: string[] = [];
      for (const tok of r.characters[i] ?? []) {
        const id = byAlias.get(tok.trim().toLowerCase());
        if (id === undefined) unresolved.push(tok);
        else if (!ids.includes(id)) ids.push(id);
      }
      if (unresolved.length) ctx.residue.push({ id: r.id, raw: unresolved.join(', ') });
      const provenance: CharProvenance = {
        tier: 'index',
        tiers: ['index'],
        // No title was parsed. The title on this record was synthesized FROM
        // these same fields, so citing it as a source would be circular.
        fromTitle: [],
        fromIndex: ids,
        // DERIVED, never asserted — the same predicate every other writer uses.
        // The catalogue happens to fill all four slots for this game, and that
        // is a measurement that belongs in report.md, not an invariant to bake
        // into the builder.
        //
        // `>=`, NOT `===`. `characters` is a union of 1..N in first-appearance
        // order, not a fixed-length tuple, so a mid-set team change legitimately
        // pushes a side past the cap — 7 sides in this corpus carry 5 or 6, and
        // emit.ts accepts them by design (verify-gates: "a 5-character side is
        // ACCEPTED (>4 is legal, only 0 fails)"). Under `===` every one of them
        // read `complete: false` while being MORE than complete, which put them
        // in the bench queue's population and told /dev they still needed work.
        // Every other writer of this field — complete-characters.ts:211,
        // bench-review.post.ts:249,262, review-queue.post.ts:150 and
        // disagreements.post.ts:107 — already said `>= 4`, so parse was the only
        // disagreeing voice and the same side changed meaning depending on which
        // path last touched it.
        complete: ids.length >= CHARACTERS_PER_SIDE,
      };
      sides.push({ player: playerId(handle), handle, characters: ids, provenance });
    }

    // ZERO characters is the only failure the contract does not admit, and emit
    // hard-fails on it. Catch it here so it reads as a countable miss on this
    // intake rather than as a crash three stages later.
    if (sides.some((s) => s.characters.length === 0)) continue;
    if (sides.some((s) => !s.handle || !s.player)) continue;

    ctx.byIdForQueue.set(r.id, {
      channel: ch.id,
      title: r.title,
      publishedAt: r.publishedAt,
      durationSec: r.durationSec,
    });

    out.push({
      id: r.id,
      channel: ch.source,
      intake: ch.id,
      title: r.title,
      publishedAt: r.publishedAt,
      durationSec: r.durationSec,
      season: seasonForDate(r.publishedAt.slice(0, 10)),
      videoId: r.videoId,
      startSeconds: r.startSeconds,
      sides: [sides[0]!, sides[1]!] as [MatchSide, MatchSide],
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const characters = await loadCharacters();
  const matcher = buildAliasMatcher(characters);
  const overrides: Record<string, VideoOverride> = await readJson('overrides.json', {});
  // NOT readJson: its catch-all fallback is wrong for this one file. `committed`
  // is the baseline for the freeze carry, the index intake's add-only merge AND
  // the collapse guard, so a truncated or half-written videos.json silently
  // becoming [] would carry nothing, leave the add-only merge with nothing to
  // preserve, and disarm the guard for every channel at once (`before > 0` false
  // everywhere) — a total loss with every gate green. Absent is fine and means a
  // first run; unreadable is a hard stop.
  const committed: MatchVideo[] = await readCommitted();

  const misses: Miss[] = [];
  const review: ReviewQueueItem[] = [];
  const benchQueue: BenchQueueItem[] = [];
  /** static per-record fields the post-override queue rebuild needs */
  const byIdForQueue = new Map<
    string,
    { channel: ChannelKey; title: string; publishedAt: string; durationSec: number }
  >();
  /** When report.md starts asking for a local drain. Chosen from the measured
   *  arrival rate — ~12 records/day enter the queue — so 40 is about three days
   *  of drift: long enough not to nag on a normal day, short enough that the
   *  backlog is still one sitting's work when it fires. */
  const BENCH_QUEUE_NUDGE = 40;

  const residues = new Map<string, { n: number; ids: string[] }>();
  let decomposedOnly = 0;
  const slotOrders: Record<SlotOrder, number> = {
    'handle-first': 0,
    'chars-first': 0,
    'parallel-lists': 0,
  };
  // Record<CharTier, …> makes adding a tier and forgetting it here a COMPILE
  // ERROR, and the report below reads this object's keys rather than repeating
  // the list — so a new tier can no longer go missing from report.md silently.
  const tierCount: Record<CharTier, number> = {
    title: 0,
    description: 0,
    index: 0,
    footage: 0,
    human: 0,
    review: 0,
  };
  const alignCount: Record<string, number> = {};
  let conflicts = 0;
  let completeSides = 0;

  const records: MatchVideo[] = [];
  const parsedPerChannel = new Map<ChannelKey, number>();
  /** Every video id this repo has FETCHED, pre-gate — the widest arm of the
   *  index intake's ignore-if-known rule below. Filled as the dumps are read so
   *  they are not read twice. */
  const rawSeen = new Map<string, string>();

  /**
   * A HUMAN VERDICT OUTRANKS THE PARSER'S INABILITY TO RESOLVE.
   *
   * Records that reach the two `character-completion` branches below are held
   * off the site entirely, and until now that was permanent by construction. A
   * queued record is absent from videos.json, therefore absent from
   * bench-queue.json, so the extractor could not read its footage and
   * /dev/bench-review could not show it — and `applyOverrides` maps over
   * `records`, which these never enter, so hand-authoring `sides` or setting
   * `exclude` did nothing either. The only way to resolve one was a commit.
   *
   * So the verdict is consulted HERE, before the record is queued, which is the
   * only point where it can still become a record. /dev/review-queue writes it.
   *
   * Deliberately scoped to these branches: a record that already parses is
   * untouched, and `exclude` keeps its existing meaning downstream in
   * applyOverrides. Nothing about the healthy path changes.
   *
   * The invariant this must not break (asserted in e2e.ts and in verify-gates):
   * a pending review item never reaches videos.json or replays.json. It holds
   * because a record is either pending — queued, unpublished — or resolved:
   * published and dequeued. A verdict moves it from one state to the other and
   * there is no third state where it is both.
   */
  type Verdict = 'excluded' | 'adopted' | null;
  const applyVerdict = (
    v: RawVideoRecord,
    ch: (typeof ACTIVE_CHANNELS)[number],
    title: string,
    handles?: [string, string],
  ): Verdict => {
    const ov = overrides[v.id];
    if (!ov) return null;
    if (ov.exclude === true) {
      misses.push({
        id: v.id,
        channel: ch.id,
        title,
        reason: 'not-a-match',
        detail: 'review verdict',
      });
      return 'excluded';
    }
    if (!ov.sides) return null;
    // Mirrors the ordinary record push below — same fields, same order, so the
    // two cannot drift into producing differently-shaped records.
    byIdForQueue.set(v.id, {
      channel: ch.id,
      title,
      publishedAt: v.publishedAt,
      durationSec: v.durationSec,
    });
    records.push({
      id: v.id,
      channel: ch.source,
      intake: ch.id,
      title,
      publishedAt: v.publishedAt,
      durationSec: v.durationSec,
      ...(v.viewCount !== undefined ? { viewCount: v.viewCount } : {}),
      season: seasonForDate(v.publishedAt.slice(0, 10)),
      sides: ov.sides as [MatchSide, MatchSide],
    });
    void handles;
    return 'adopted';
  };

  for (const ch of ACTIVE_CHANNELS) {
    const raw: RawVideoRecord[] = await readJson(`../raw/${ch.id}.json`, []);
    if (raw.length === 0) {
      throw new Error(
        `raw/${ch.id}.json is empty or missing — run \`npm run data:fetch\` before parsing.`,
      );
    }
    // Stale-raw guard: parsing a raw dump older than the committed catalogue
    // silently republishes yesterday's world as today's.
    assertRawIsFresh(ch.id, raw, committed);
    for (const v of raw) if (!rawSeen.has(v.id)) rawSeen.set(v.id, `raw/${ch.id}.json`);

    let parsed = 0;
    for (const v of raw) {
      const title = v.title.normalize('NFC');
      const searchable =
        ch.tokonSignal === 'titleOrDescription' ? `${title}\n${v.description}` : title;

      // ── the gate, in order ────────────────────────────────────────────────
      const isTokon = TOKON_RE.test(searchable);
      const isOther = OTHER_GAME_RE.test(title);
      if (!isTokon) {
        misses.push({
          id: v.id,
          channel: ch.id,
          title,
          reason: isOther ? 'other-game' : 'not-tokon',
        });
        continue;
      }
      if (isOther) {
        // Carries BOTH markers — a crossover title, a "vs 2XKO" comparison, or
        // the pollution case beginning. Never guessed.
        misses.push({
          id: v.id,
          channel: ch.id,
          title,
          reason: 'other-game',
          detail: 'both markers',
        });
        continue;
      }
      if (v.title !== title) decomposedOnly += 1;
      /**
       * The date floor. LAUNCH for every channel, unless the channel declares
       * its own — and only marvelTokonYT does, for its EVO 2026 exhibition set.
       *
       * PER CHANNEL, NOT GLOBAL, and that is load-bearing rather than tidy.
       * Measured on the raw dumps: floored globally at PRE_RELEASE this admits
       * 212 more records — 204 fightingStationX Open Beta ranked matches and
       * EVO Las Vegas uploads, and 8 hadoukenReplays from a December 2025
       * closed test. None of that is launch-comparable footage, and none of it
       * would announce itself as a problem: it parses, renders and counts
       * exactly like the rest of the archive.
       */
      const floor = ch.preReleaseFrom ?? LAUNCH;
      if (v.publishedAt.slice(0, 10) < floor) {
        misses.push({ id: v.id, channel: ch.id, title, reason: 'pre-launch' });
        continue;
      }
      /**
       * Events-only intake. A channel that publishes both kinds of footage but
       * is claimed for one: no event brand in the title, no record.
       *
       * Placed AFTER the game marker and the floor so its miss count means what
       * it says — "this channel published something we don't recognise as an
       * event" — rather than absorbing every other channel's rejections. The
       * online-brand veto runs first so a title carrying both signals is never
       * guessed at in the direction that publishes.
       */
      if (ch.eventsOnly && (ONLINE_BRAND_RE.test(title) || !EVENT_RE.test(title))) {
        misses.push({ id: v.id, channel: ch.id, title, reason: 'not-an-event' });
        continue;
      }
      if (v.liveBroadcastContent && v.liveBroadcastContent !== 'none') {
        misses.push({ id: v.id, channel: ch.id, title, reason: 'live-or-upcoming' });
        continue;
      }
      if (NOT_A_MATCH_RE.test(title)) {
        misses.push({ id: v.id, channel: ch.id, title, reason: 'not-a-match' });
        continue;
      }
      if (v.durationSec > 0 && v.durationSec < 60) {
        misses.push({ id: v.id, channel: ch.id, title, reason: 'short-duration' });
        continue;
      }

      // ── structure ─────────────────────────────────────────────────────────
      // The parallel-lists grammar is tried FIRST, because its titles also
      // satisfy the paren parser's outer shape — and satisfying it there
      // produces the wrong answer (fighter names read as player handles)
      // rather than no answer.
      const parallel = parallelLists(title, matcher);

      const c = parallel ? null : core(title);
      const sides = c ? splitSides(c) : null;
      if (!parallel && !sides) {
        misses.push({ id: v.id, channel: ch.id, title, reason: 'no-vs-title' });
        continue;
      }
      const slots = sides ? sides.map(slot) : [];
      if (!parallel && slots.some((s) => s === 'ambiguous')) {
        misses.push({ id: v.id, channel: ch.id, title, reason: 'slot-ambiguous' });
        review.push({
          id: v.id,
          kind: 'slot-ambiguous',
          channel: ch.id,
          title,
          publishedAt: v.publishedAt,
          durationSec: v.durationSec,
        });
        continue;
      }
      if (!parallel && slots.some((s) => s === null)) {
        // Match-shaped footage that states NO characters — two clean handles
        // either side of a vs, and nothing in parentheses. This is precisely
        // what the extractor exists for, so it is queued for
        // character-completion rather than dropped as a parse failure.
        //
        // Scoped tightly on purpose: it has already passed the game marker,
        // the launch date floor and the not-a-match filter, and BOTH sides
        // must clean to a plausible handle. A looser rule would queue every
        // "X vs Y" thumbnail-bait title on a general FGC channel.
        const bare = (sides ?? []).map(cleanHandle);
        const queueable =
          bare.length === 2 &&
          slots.every((s) => s === null) &&
          bare.every((h) => h && h.length <= 40);
        misses.push({
          id: v.id,
          channel: ch.id,
          title,
          reason: queueable ? 'char-unresolved' : 'no-vs-title',
          detail: 'no (chars) slot',
        });
        if (queueable) {
          const verdict = applyVerdict(v, ch, title, [bare[0]!, bare[1]!]);
          if (verdict === null) {
            review.push({
              id: v.id,
              kind: 'character-completion',
              channel: ch.id,
              title,
              publishedAt: v.publishedAt,
              durationSec: v.durationSec,
              handles: [bare[0]!, bare[1]!],
            });
          } else if (verdict === 'adopted') {
            parsed += 1;
          }
        }
        continue;
      }
      const [s0, s1] = parallel
        ? ([
            { handle: parallel.handles[0], chars: '', order: 'parallel-lists' as SlotOrder },
            { handle: parallel.handles[1], chars: '', order: 'parallel-lists' as SlotOrder },
          ] as [Slot, Slot])
        : (slots as [Slot, Slot]);

      const handles = [cleanHandle(s0.handle), cleanHandle(s1.handle)] as [string, string];
      // The length guard is on the CLEANED handle; the emptiness guard is on the
      // SLUG, which is not the same test. `playerId` strips to [a-z0-9] after
      // NFKD, so an all-CJK handle — "シルクちゃん", real, on record LxwV1YO7eGE —
      // is a perfectly good 6-character string here and slugs to "". That
      // shipped: data/players.json carried {"id": "", "handle": "シルクちゃん"},
      // nuxt.config seeded a prerender route for `/players/` (colliding with the
      // index), and stats grew a "" key. SF6 and Tekken have always guarded on
      // the slug (sf6/parse.ts:398). This is that guard.
      if (handles.some((h) => !h || h.length > 40 || !playerId(h))) {
        misses.push({
          id: v.id,
          channel: ch.id,
          title,
          reason: 'bad-handle',
          detail: handles.map((h) => `${h} → ${playerId(h) || '(empty slug)'}`).join(' | '),
        });
        continue;
      }

      // ── characters: span extraction, never a separator split ──────────────
      const titleChars = parallel
        ? parallel.chars.map((ids) => ({ ids, residue: '' }))
        : [s0, s1].map((s) => {
            const stripped = stripLeaderboard(s.chars);
            return { ids: matcher.ids(stripped), residue: matcher.residue(stripped) };
          });
      if (titleChars.some((t) => t.ids.length === 0)) {
        misses.push({
          id: v.id,
          channel: ch.id,
          title,
          reason: 'char-unresolved',
          detail: [s0.chars, s1.chars].join(' | '),
        });
        // Match-shaped footage whose characters no text resolves — exactly what
        // the extractor exists for.
        const verdict = applyVerdict(v, ch, title, handles);
        if (verdict === null) {
          review.push({
            id: v.id,
            kind: 'character-completion',
            channel: ch.id,
            title,
            publishedAt: v.publishedAt,
            durationSec: v.durationSec,
            handles,
          });
        } else if (verdict === 'adopted') {
          parsed += 1;
        }
        continue;
      }
      for (const t of titleChars) {
        if (t.residue) {
          const e = residues.get(t.residue) ?? { n: 0, ids: [] };
          e.n += 1;
          if (e.ids.length < 5) e.ids.push(v.id);
          residues.set(t.residue, e);
        }
      }
      slotOrders[s0.order] += 1;
      slotOrders[s1.order] += 1;

      // ── tier 2: the description bench ─────────────────────────────────────
      const benchRead = readBench(v.description, ch.descriptionBench, matcher);
      let aligned: ReturnType<typeof alignBench> | null = null;
      if (benchRead) {
        aligned = alignBench(benchRead, handles, [titleChars[0]!.ids, titleChars[1]!.ids]);
        alignCount[aligned.how] = (alignCount[aligned.how] ?? 0) + 1;
      }

      const built: MatchSide[] = [];
      let recordConflict = false;
      for (const i of [0, 1] as const) {
        const fromTitle = titleChars[i]!.ids;
        const benchSide = aligned && aligned.sides ? aligned.sides[i] : null;
        // 'player-lines' states one character per side — a handle source, not a
        // bench. Treating it as one would "complete" a 4-slot side at 1.
        const benchIds =
          benchSide && ch.descriptionBench !== 'player-lines' ? benchSide.characters : [];

        let chars = fromTitle;
        let tier: CharTier = 'title';
        const tiers: CharTier[] = ['title'];
        let conflict = false;

        if (benchIds.length) {
          const covered = fromTitle.every((x) => benchIds.includes(x));
          if (covered) {
            chars = benchIds;
          } else {
            // The bench omits something the title stated. Keep the union in
            // first-appearance order — never silently drop what the title said —
            // and send it to a human. The union is what the REVIEWER sees, not
            // what ships: the record is withheld below until a verdict lands.
            chars = [...fromTitle, ...benchIds.filter((x) => !fromTitle.includes(x))];
            conflict = true;
            recordConflict = true;
          }
          tier = 'description';
          tiers.push('description');
        }

        const provenance: CharProvenance = {
          tier,
          tiers,
          fromTitle,
          ...(benchIds.length ? { fromDescription: benchIds } : {}),
          ...(aligned ? { descAlign: aligned.how } : {}),
          slotOrder: i === 0 ? s0.order : s1.order,
          ...(conflict ? { conflict: true } : {}),
          // `>=` for the same reason as the index builder above: the union can
          // legitimately exceed the cap on a mid-set team change.
          complete: chars.length >= CHARACTERS_PER_SIDE,
        };
        tierCount[tier] += 1;
        if (provenance.complete) completeSides += 1;

        // A description handle beats an ALL-CAPS title handle for display.
        //
        // cleanHandle FIRST. bench.ts has no handle hygiene of its own — its
        // capture classes ([^():\n!] and [^\n(]) admit brackets and emoji and it
        // takes the match with a bare .trim() — and this branch OUTRANKS the
        // title handle, so an unclean description handle would reach playerId()
        // past a title path that had already been cleaned. Changes nothing in
        // the corpus today (measured: 0 handles differ); it closes the
        // higher-priority half of the defect BRACKET_TAIL_RE fixes above, so
        // don't go looking for the bug it repaired.
        const benchHandle = benchSide?.handle ? cleanHandle(benchSide.handle) : '';
        const handle = benchHandle && benchHandle.length <= 40 ? benchHandle : handles[i];

        built.push({ player: playerId(handle), handle, characters: chars, provenance });
      }

      /**
       * A BENCH CONFLICT WITHHOLDS THE RECORD. It used to publish one.
       *
       * The union above is built for the reviewer to look at, not for the site:
       * when the description omits a fighter the title stated, the two tiers
       * disagree about WHO WAS ON THE TEAM, and a union answers that by
       * asserting both. That is a guess wearing the shape of data — it renders,
       * filters and counts exactly like a read side, and it inflates
       * characterUsage for a fighter no source is sure appeared.
       *
       * It also broke the one invariant this project asserts hardest, in the
       * only way that could stay hidden: a queued record reaching replays.json.
       * The contradiction sat in types/index.ts the whole time — "pending items
       * NEVER reach videos.json or replays.json" beside "the union is kept and
       * the record is queued for review" — and nothing collided until
       * fgcReplaysHub published 7LQbkltIzso, the first bench conflict this
       * corpus ever produced. Two e2e assertions caught it the same day.
       *
       * So the review queue's contract wins and the record waits. The verdict
       * is consulted HERE, before queuing, exactly as the two
       * character-completion branches do it — the queue's own page writes the
       * answer, and the next parse adopts it.
       *
       * Note this is NOT the bench queue's case. A 2-of-4 side is true partial
       * data and publishes; a side whose tiers contradict each other is not
       * partial, it is unresolved.
       */
      if (recordConflict) {
        conflicts += 1;
        const conflictSide = built[0]!.provenance.conflict ? 0 : 1;
        const verdict = applyVerdict(v, ch, title, handles);
        if (verdict === null) {
          misses.push({
            id: v.id,
            channel: ch.id,
            title,
            reason: 'bench-conflict',
            detail: [
              `title=${built[conflictSide]!.provenance.fromTitle.join('/')}`,
              `desc=${(built[conflictSide]!.provenance.fromDescription ?? []).join('/')}`,
            ].join(' | '),
          });
          review.push({
            id: v.id,
            kind: 'bench-conflict',
            channel: ch.id,
            title,
            publishedAt: v.publishedAt,
            durationSec: v.durationSec,
            handles,
            conflict: {
              side: conflictSide,
              fromTitle: built[conflictSide]!.provenance.fromTitle,
              fromDescription: built[conflictSide]!.provenance.fromDescription ?? [],
            },
          });
        } else if (verdict === 'adopted') {
          parsed += 1;
        }
        continue;
      }

      // Publishable but incomplete → the extractor's worklist. NOT the review
      // queue: a 2-of-4 side is true partial data the contract blesses, not a
      // guess withheld from the site. See types/index.ts BenchQueueItem.
      const known = [built[0]!.characters.length, built[1]!.characters.length] as [number, number];
      // Pushed unconditionally: this pass only supplies the static fields (title,
      // channel, duration). Whether a record actually BELONGS in the queue is
      // decided after overrides are applied, below.
      byIdForQueue.set(v.id, {
        channel: ch.id,
        title,
        publishedAt: v.publishedAt,
        durationSec: v.durationSec,
      });
      if (known[0] < 4 || known[1] < 4) {
        benchQueue.push({
          id: v.id,
          channel: ch.id,
          title,
          publishedAt: v.publishedAt,
          durationSec: v.durationSec,
          known,
          tiers: [built[0]!.provenance.tier, built[1]!.provenance.tier],
        });
      }

      records.push({
        id: v.id,
        channel: ch.source,
        intake: ch.id,
        title,
        publishedAt: v.publishedAt,
        durationSec: v.durationSec,
        ...(v.viewCount !== undefined ? { viewCount: v.viewCount } : {}),
        season: seasonForDate(v.publishedAt.slice(0, 10)),
        sides: [built[0]!, built[1]!] as [MatchSide, MatchSide],
      });
      parsed += 1;
    }
    parsedPerChannel.set(ch.id, parsed);
  }

  // ── the index intake: rebuild from a dump, or carry ───────────────────────
  //
  // An INDEX source is fetched by the daily cron since 2026-08-31, and the carry
  // is now its FALLBACK rather than its normal state. raw/ is gitignored and the
  // cron works from a fresh checkout, so before that there was never a dump here
  // and the committed records were CARRIED every single run — the same mechanism
  // `frozen` uses. Now the cron pulls, so most runs rebuild, and the carry is
  // what happens on the mornings the catalogue is unreachable, unparseable or
  // hands back nothing. That is the whole of "the cron never depends on Replay
  // Theater succeeding".
  //
  // Both paths must publish identical bytes from identical inputs, which is why
  // there is no separate merge for either: applyOverrides below is the only
  // curation step and it runs over `records` whichever way they got there. That
  // is a property of this repo, not of the reference it is ported from — there,
  // the normal merge is wide enough to rewrite a title or an event, so index
  // records needed a narrower slot of their own. Here applyOverrides can only
  // touch season, sides and channel, so an override can correct or exclude an
  // index record and cannot silently outrank the catalogue on anything else.
  const theaterSkippedKnown: { videoId: string; tag: string; where: string }[] = [];
  const theaterResidue: { id: string; raw: string }[] = [];
  const carriedWithFallback: ChannelKey[] = [];
  /** intake → committed records this run's dump did not mention. Kept so
   *  report.md can STATE them; what the number means depends on the pull's mode,
   *  which is why the report only prints it after a full sweep. */
  const theaterSurvivors = new Map<ChannelKey, MatchVideo[]>();

  for (const ch of CHANNELS.filter((c) => c.cronFetchedWithCarry)) {
    const dump: TheaterRawRecord[] = await readJson(`../raw/${ch.id}.json`, []);
    const mine = committed.filter((r) => r.intake === ch.id);
    if (dump.length === 0) {
      // AN EMPTY OR ABSENT DUMP IS A CARRY, NOT A REBUILD TO ZERO — and this
      // repo has always said so, which is worth keeping rather than restating:
      // `readJson` returns its fallback for a missing file AND `JSON.parse`
      // succeeds on an empty array, so both the failed-pull case and the
      // pulled-nothing case land here instead of falling through to a rebuild
      // that produces 0 records. The sibling repo reached a rebuild on the empty
      // case and tripped its collapse guard at n → 0: a red cron for a reason
      // nothing in the failure named.
      //
      // A pull returning no TAGGED entries is the ORDINARY case here — 44
      // tournament records against a 248-entry catalogue — so this branch runs
      // on most quiet mornings, not only on broken ones.
      records.push(...mine);
      // WRITE THE COUNT BACK, do not `continue` past the guard. The reference
      // skips the collapse guard for a carried source and says so in its
      // report; this repo's guard is already documented asleep below 20
      // records, so an exclusion here would be the hole rather than a
      // concession. With the write-back a healthy carry reads n → n and a
      // broken one reads n → 0, and the guard stays armed alongside the pin.
      parsedPerChannel.set(ch.id, mine.length);
      carriedWithFallback.push(ch.id);
      theaterSurvivors.set(ch.id, []);
      continue;
    }
    // ── ADD-ONLY, and this is where the rule is mechanical ──────────────────
    // A rebuild used to REPLACE this intake with whatever the dump produced.
    // That was safe while the dump was always the whole catalogue, taken by a
    // human who would notice. It is not safe now, for two independent reasons,
    // either sufficient on its own:
    //
    //  · THE DUMP IS USUALLY A DELTA. The cron runs the cursor, which reads the
    //    front of the feed and stops, so `dump` holds the last few days of
    //    submissions rather than the catalogue. Replacing on that would delete
    //    the committed intake every morning.
    //  · A VOD GOING PRIVATE DELETES EVERY SEGMENT CUT FROM IT. These records
    //    are segments: the 44 committed here sit on just 5 source VODs, and the
    //    largest holds 18 of them — 40.9% of the intake. THE COLLAPSE GUARD IS
    //    BLIND TO THAT: the loss clears its >10% arm and FAILS its >20 arm, so
    //    the guard waves it through in silence and the pin would then be
    //    rewritten downward to match.
    //
    //    Two other things are not blind to it, and neither is this merge. On a
    //    FULL sweep the floor in scripts/fetch-theater.ts catches it first: at
    //    pin 44 the threshold is 39.6, a sweep missing that VOD produces 26, and
    //    data:theater exits 1 without writing a dump at all. What add-only is
    //    the LAST line for is the paths that floor does not cover — the cursor
    //    delta, where a small dump is the ordinary case and the floor is
    //    deliberately skipped, and a dump placed by hand. On those, this merge
    //    and the only-grows re-pin below are the whole of the protection.
    //
    // So: BUILT WINS WHERE THE DUMP SPEAKS, COMMITTED SURVIVES WHERE IT DOES
    // NOT. An entry still in the catalogue is re-derived exactly as before,
    // which is what keeps a carry and a rebuild byte-identical; an id the dump
    // does not mention is carried untouched rather than dropped.
    const built = buildTheaterRecords(ch, dump, {
      committed,
      overrides,
      rawSeen,
      characters,
      skipped: theaterSkippedKnown,
      residue: theaterResidue,
      byIdForQueue,
    });
    const builtIds = new Set(built.map((v) => v.id));
    const survivors = mine.filter((v) => !builtIds.has(v.id));
    theaterSurvivors.set(ch.id, survivors);
    const merged = [...built, ...survivors];
    records.push(...merged);
    parsedPerChannel.set(ch.id, merged.length);
  }

  // ── what the pull did, read from its own self-report ──────────────────────
  // scripts/fetch-theater.ts clears this file before its first request and
  // rewrites it only on success, so its PRESENCE means "a pull happened this
  // run" and its absence means "none did". That distinction is load-bearing
  // twice below: report.md says "no pull this run" rather than "found nothing",
  // and the cursor advances only off a number this run actually observed.
  const theaterStats = await readJson<{
    /** 'cursor' = this dump is a DELTA off the front of the feed; 'full' = it
     *  claims to be the whole catalogue. Only a full sweep can say a committed
     *  record is gone from upstream. */
    mode?: 'cursor' | 'full';
    maxEntryId?: number;
    pagesRead?: number;
    hitBound?: boolean;
    tagged?: number;
    collapsed?: number;
    collapsedTags?: Record<string, number>;
    unresolvableVods?: number;
  } | null>('../raw/.replayTheater.stats.json', null);
  /** The committed cursor, read here and rewritten below. */
  const theaterCursor: Record<string, number> = await readJson('theater-cursor.json', {});

  // ── the carry pin (data/source-pins.json) ─────────────────────────────────
  // The carry needs a pin for the reason `frozen.records` does: data/videos.json
  // is both the source and the target, so one bad run would poison the next
  // run's baseline permanently and silently. It cannot be a constant in
  // channels.ts the way frozen's is, because a cron-fetched index source GROWS —
  // hand-editing a number on every refresh is friction that teaches people to
  // skip the check.
  //
  // ASSERTED ON A CARRY, WRITTEN ON A REBUILD. A rebuild has the dump in front
  // of it and is the authority on the count; a carry has only yesterday's file
  // and needs something outside that file to check itself against. The re-pin
  // happens after applyOverrides, from the count actually published.
  //
  // Note the assertion is unconditional for a carried intake — it is NOT
  // guarded on `carried.length > 0`. That guard would make total loss the one
  // case that passes, which is the case the pin exists for.
  const pins: SourcePins = await readJson('source-pins.json', {});
  for (const key of carriedWithFallback) {
    const got = records.filter((r) => r.intake === key).length;
    const want = pins[key];
    if (want === undefined) {
      throw new Error(
        `${key} carried ${got} record(s) but data/source-pins.json has no pin for it.\n` +
          `  "No expectation" is the exact state the pin exists to prevent.\n` +
          `  Run \`npm run data:theater\` then \`npm run data:parse\` to rebuild from a dump and pin it.`,
      );
    }
    if (got !== want) {
      throw new Error(
        `source pin mismatch on ${key}: carried ${got}, pinned ${want}.\n` +
          `  data/videos.json is both the source and the target of this carry, so drift\n` +
          `  compounds: the next run would treat ${got} as the new baseline.\n` +
          `  If the change is deliberate, run \`npm run data:theater\` then\n` +
          `  \`npm run data:parse\` to rebuild and re-pin.`,
      );
    }
  }

  // ── the freeze carry ───────────────────────────────────────────────────────
  // A frozen channel's committed records are still real and still play. Carry
  // them forward byte-stable and hard-assert the pin: the committed file is both
  // the source and the target of the carry, so one bad run would poison the next
  // run's reference permanently and silently.
  for (const ch of CHANNELS.filter((c) => c.frozen)) {
    const carried = committed.filter((r) => r.intake === ch.id);
    if (carried.length !== ch.frozen!.records) {
      throw new Error(
        `freeze pin mismatch on ${ch.id}: carried ${carried.length}, pinned ${ch.frozen!.records}.\n` +
          `  Editing the pin is the deliberate-prune mechanism — do it in a reviewable commit.`,
      );
    }
    records.push(...carried);
    parsedPerChannel.set(ch.id, carried.length);
  }

  // ── the collapse guard ─────────────────────────────────────────────────────
  // Compares PARSED against COMMITTED, never raw against committed: this
  // pipeline gates the game at parse, and one channel is 8 usable uploads out of
  // 2,530, so a raw comparison would measure the game filter's mood rather than
  // the channel's health.
  //
  // Both thresholds are required. A percentage alone punishes a small channel
  // for ordinary churn; an absolute alone misses a large channel bleeding
  // slowly. HONEST LIMITATION: >20 AND >10% cannot fire for a channel holding
  // 20 records or fewer, and four of these five are under 40 today. The guard
  // is therefore asleep at this corpus size and verify:deployed plus the freeze
  // pin are the live protection until it wakes. That is a property of the
  // thresholds, not a reason to weaken them.
  const COLLAPSE_PCT = 0.1;
  const COLLAPSE_ABS = 20;
  const collapses: string[] = [];
  for (const ch of CHANNELS) {
    const before = committed.filter((r) => r.intake === ch.id).length;
    const after = parsedPerChannel.get(ch.id) ?? 0;
    const lost = before - after;
    if (before > 0 && lost > COLLAPSE_ABS && lost / before > COLLAPSE_PCT) {
      if (allowCollapse.has(ch.id)) {
        console.warn(`  ⚠ ${ch.id}: ${before} → ${after} (−${lost}) — allowed by --allow-collapse`);
      } else {
        collapses.push(
          `${ch.id}: ${before} → ${after} (−${lost}, ${((lost / before) * 100).toFixed(1)}%)`,
        );
      }
    }
  }
  if (collapses.length) {
    console.error(
      `\n✖ COLLAPSE GUARD — refusing to write. Nothing has been changed on disk.\n` +
        collapses.map((c) => `    ${c}`).join('\n') +
        `\n\n  A channel collapses because it was deleted, renamed, made private, or\n` +
        `  rebranded to another game and unlisted its back catalogue — all observed\n` +
        `  on this platform. Investigate before overriding.\n` +
        `  Override deliberately: npm run data:parse -- --allow-collapse=<channel,…>\n`,
    );
    process.exit(1);
  }

  // ── registries ─────────────────────────────────────────────────────────────
  // Newest first, ties broken by id. THE TIE-BREAK IS LOAD-BEARING, not tidiness.
  // `(a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)` stood here and returns
  // -1 in BOTH directions for two equal timestamps, which is not a valid
  // comparator: sort() is then free to return a different permutation every
  // call. It was inert only because all 455 committed publishedAt values happen
  // to be distinct — one record per video, one video per moment.
  //
  // An index source ends that. It publishes many records per VOD and they all
  // carry the VOD's own publish time, so a handful of timestamps repeat a dozen
  // times each. Measured on this corpus plus one such intake: the old comparator
  // never converged (four successive sorts of the same array gave four different
  // orders) and a shuffled input gave a fifth. That makes data/videos.json a
  // different file on every run, which defeats the no-change-day commit guard,
  // and makes the carry path and the rebuild path disagree — the exact
  // byte-identity the index intake's carry has to be able to prove.
  records.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  const withOverrides = applyOverrides(records, overrides);

  // THE PROVENANCE TALLY IS RECOMPUTED FROM THE FINAL RECORDS.
  //
  // It used to be accumulated as each record was built, which is BEFORE
  // applyOverrides runs — so a tier could exist throughout the corpus and be
  // absent from the report entirely. Measured the first time the extractor
  // wrote at scale: 168 sides landed at `footage`, and the report said the tier
  // had none, splitting them back across `title` and `description` as they had
  // been before the override replaced them. `complete` was wrong the same way,
  // reading 98 where the truth was 131, because the 33 sides the extraction
  // filled to four were counted in their pre-override state.
  //
  // A report that cannot see a whole tier is worse than no report: it is the
  // artifact a human consults to learn how the corpus was sourced, and it was
  // confidently describing a world that no longer existed.
  for (const k of Object.keys(tierCount) as CharTier[]) tierCount[k] = 0;
  completeSides = 0;
  for (const r of withOverrides) {
    for (const s of r.sides) {
      tierCount[s.provenance.tier] += 1;
      if (s.provenance.complete) completeSides += 1;
    }
  }

  // THE BENCH QUEUE IS REBUILT FROM THE FINAL RECORDS, FOR THE SAME REASON.
  //
  // The tally above was fixed once and the queue beside it was left accumulating
  // during record construction, which is before any override is applied — so it
  // listed work that had already been done. Measured when a person hand-read 224
  // sides: the queue still advertised 171 records when only 65 were genuinely
  // incomplete, so 106 of them were finished. A worklist that hands out completed
  // work is worse than a long one; it spends the scarcest thing here, which is
  // somebody's attention.
  benchQueue.length = 0;
  for (const r of withOverrides) {
    const known = [r.sides[0]!.characters.length, r.sides[1]!.characters.length] as [
      number,
      number,
    ];
    if (known[0] >= 4 && known[1] >= 4) continue;
    const src = byIdForQueue.get(r.id);
    if (!src) continue;
    benchQueue.push({
      id: r.id,
      channel: src.channel,
      title: src.title,
      publishedAt: src.publishedAt,
      durationSec: src.durationSec,
      known,
      tiers: [r.sides[0]!.provenance.tier, r.sides[1]!.provenance.tier],
    });
  }

  const playerMap = new Map<string, PlayerRecord>();
  /**
   * ONE PLAYER, ONE PAGE. Runs over the post-override records, so a hand verdict
   * that spells a handle differently is folded in like any other observation
   * rather than escaping the rule — applyOverrides replaces `sides` wholesale,
   * which is exactly how two override-authored spellings could otherwise mint a
   * second profile with nothing to catch it.
   *
   * This REPLACES the inline "prefer the mixed-case spelling" tiebreak that used
   * to live here. That rule was right about casing and blind to the split it was
   * choosing between: it picked the nicest spelling per ID, and two spellings of
   * one player have two ids, so it never compared them.
   */
  const mergeReport = resolvePlayers(withOverrides);

  for (const r of withOverrides) {
    for (const s of r.sides) {
      if (!playerMap.has(s.player)) playerMap.set(s.player, { id: s.player, handle: s.handle });
    }
  }
  const players = [...playerMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const collisions = undeclaredCollisions(players);

  // ── re-pin every index intake rebuilt from a dump this run — AND IT ONLY
  //    GROWS ───────────────────────────────────────────────────────────────
  // From the FINAL count, so the number the next carrying run checks against is
  // the number actually published — exclusions and all.
  //
  // THE ONLY-GROWS REFUSAL IS NEW, and it replaces a guarantee this move
  // removes rather than adding a belt on top of one. Until 2026-08-31 every cron
  // run was a carry, so the pin was ASSERTED daily at exact equality — the
  // strongest check this intake had. From today most runs rebuild, and a
  // rebuilding run does not assert the pin at all; it overwrites it.
  //
  // The only remaining check would have been the collapse guard, and this repo's
  // collapse guard cannot see the loss that actually happens here: the largest
  // source VOD holds 18 of the 44 records, so losing it is 40.9% — over the >10%
  // arm and nowhere near the >20 absolute one, which is the same blind spot this
  // file already documents for every intake under 20 records.
  //
  // A pin that can only rise turns "records left quietly" into a refusal. When
  // the drop is real — an event genuinely withdrawn — the operator says so once,
  // with --allow-shrink, and the new number is committed deliberately.
  const rebuiltThisRun = CHANNELS.filter(
    (c) => c.cronFetchedWithCarry && !carriedWithFallback.includes(c.id),
  );
  if (rebuiltThisRun.length > 0) {
    const next: SourcePins = { ...pins };
    for (const ch of rebuiltThisRun) {
      const got = withOverrides.filter((r) => r.intake === ch.id).length;
      const was = pins[ch.id] ?? 0;
      if (got < was && !args.includes('--allow-shrink')) {
        console.error(
          [
            `\n✖ ${ch.id} would re-pin DOWNWARD: ${was} → ${got}.`,
            ``,
            `  This intake is add-only: a committed record is carried whether or not the`,
            `  catalogue still lists it, so the published count cannot fall on its own.`,
            `  ${was - got} record(s) were dropped by something inside this run, and the`,
            `  collapse guard is not sensitive enough to have caught it — the largest`,
            `  single source VOD here is 18 records (40.9%) and the guard needs >20.`,
            ``,
            `  Nothing has been written. If the drop is genuine and deliberate:`,
            `    npm run data:parse -- --allow-shrink`,
          ].join('\n'),
        );
        process.exit(1);
      }
      next[ch.id] = got;
    }
    const ordered = Object.fromEntries(
      Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
    ) as SourcePins;
    await write('source-pins.json', ordered);
  }

  // ── the cursor (data/theater-cursor.json) ─────────────────────────────────
  // One integer per index intake: the highest catalogue entry id ever seen. It
  // is what lets tomorrow's fetch read two pages instead of the catalogue, so it
  // has to survive into the repository — raw/ is gitignored and CI starts from a
  // fresh checkout with no memory but data/.
  //
  // CONTENT ONLY, no timestamp. report.md's "_Generated_" line already costs the
  // cron a suppression rule; a second file that changed every morning would
  // defeat that rule from the other side and produce a commit — and a deploy —
  // on days when nothing happened.
  //
  // ONLY GROWS, for the reason the pin does, and here it matters more: a cursor
  // that moved BACKWARD would silently re-admit entries as "new", and one that
  // moved back to 0 would turn every cron run into a bounded sweep that never
  // goes quiet.
  //
  // THE SEED IS EXACT, NOT A GUESS. data/theater-cursor.json was committed at
  // 488095, which is the highest entry id on `?game=tokon&page=1` — verified
  // live 2026-08-31. A seed that overshot would skip real entries permanently
  // (nothing ever re-reads behind the cursor on the daily path); one that
  // undershot only costs pages. It is stated here because the file itself is
  // JSON and cannot carry the provenance of its own number.
  //
  // NOT STAGED WHEN IT IS THE ONLY THING THAT MOVED — see the commit guard in
  // .github/workflows/data-refresh.yml. The catalogue takes new entries most
  // days whether or not any are ours, so a cursor staged unconditionally would
  // produce a commit, and a deploy, every morning forever.
  //
  // KEYED ON THE PULL HAVING HAPPENED, NOT ON RECORDS HAVING BEEN REBUILT, and
  // that distinction is the whole reason this block reads `theaterStats` rather
  // than `rebuiltThisRun`. A cursor pass that returns no TAGGED entries is the
  // ordinary case here — 44 tournament records against a 248-entry catalogue —
  // and it writes an empty dump, which the carry above correctly treats as a
  // carry. `rebuiltThisRun` is then empty. Driving the cursor off that list means
  // the most common successful pull on the calendar advances the cursor in
  // memory and never persists it, so every following morning re-reads the same
  // pages and the cursor only ever moves on the days a tournament happened to be
  // added. The pull happening is what moves the cursor; whether it produced
  // records is a different question. (Found in the reference, where it was live.)
  if (theaterStats && typeof theaterStats.maxEntryId === 'number') {
    const nextCursor: Record<string, number> = { ...theaterCursor };
    for (const ch of CHANNELS.filter((c) => c.index && c.cronFetchedWithCarry)) {
      nextCursor[ch.id] = Math.max(theaterCursor[ch.id] ?? 0, theaterStats.maxEntryId);
    }
    await write(
      'theater-cursor.json',
      Object.fromEntries(Object.entries(nextCursor).sort(([a], [b]) => a.localeCompare(b))),
    );
  }

  // ── the second witness (scripts/crosscheck.ts) ────────────────────────────
  // Reads raw/replayTheater.witness.json — EVERY entry the pull saw, including
  // the untagged online rows the index intake deliberately ignores — and
  // compares the catalogue's claim to ours on the videos both sides hold. It
  // writes no field, gates nothing, and is skipped entirely when there is no
  // witness file, the same way the carry note above says "no pull this run"
  // rather than printing a zero.
  //
  // MEASURED AGAINST THE PUBLISHED RECORDS, not the pre-override ones. A
  // disagreement names a row a visitor can open, and the e2e gate asserts
  // exactly that — so the comparison has to be against what videos.json will
  // actually hold, overrides and exclusions included.
  //
  // WHY THE DISAGREEMENTS DO NOT GO IN data/review-queue.json: in this repo that
  // queue means WITHHELD. scripts/e2e.ts asserts `queue.every((q) =>
  // !videoIds.has(q.id))` — "pending review items never reach videos.json" — and
  // the bench queue beside it carries the opposite invariant for records that
  // ARE published. A cross-check disagreement is a record we have already
  // published from a tracked channel and are not proposing to unpublish on a
  // third party's say-so, so filing it in the review queue would either break
  // that gate or quietly pull a good record off the site. It is not bench work
  // either: the bench queue means "incomplete, 1..3 on a side", and a contested
  // side is complete and disputed, which is a different fact. So it gets its own
  // artifact — published, contested, both claims recorded — and e2e gates the
  // MIRROR of the review-queue rule.
  //
  // There is no /dev surface for these yet. The report block and the committed
  // artifact are the working surface; the first measurement (2026-08-31, 111
  // records compared) found zero rows, so that is the right amount of
  // machinery, and the count is what would justify more.
  const witness = await readJson<WitnessFile | null>('../raw/replayTheater.witness.json', null);
  // The SAME exact-alias table the index intake builds, from the same file. A
  // second copy that drifted would make the witness disagree with the parser
  // over a spelling the roster had already ruled on.
  const byAliasForWitness = new Map<string, string>();
  for (const c of characters) {
    byAliasForWitness.set(c.name.trim().toLowerCase(), c.id);
    for (const a of c.extra?.aliases ?? []) byAliasForWitness.set(a.trim().toLowerCase(), c.id);
  }
  const witnessResult = witness
    ? crossCheck(witness, withOverrides, byAliasForWitness, resolveKey, stripTheaterSponsor)
    : null;

  // ── write ──────────────────────────────────────────────────────────────────
  /**
   * THE RETIRED-ID LEDGER — append-only, and that is the whole point.
   *
   * A merged spelling's id is only observable at the moment of the merge: once
   * data/videos.json is canonicalised, the old spelling is gone from the corpus
   * and nothing can rediscover it. Recomputing this set from the committed data
   * therefore yields nothing, which is how the first attempt at the redirect
   * emitter silently produced zero.
   *
   * Worse, it decays. If the last record carrying the old spelling is deleted
   * upstream — the Tōkon channels unlist videos routinely — a recomputed set
   * would drop that redirect and the indexed URL would 404 again months later,
   * with no diff to explain it.
   *
   * So the ledger MERGES with what is already committed and never shrinks. It is
   * the input to `npm run data:redirects`, and a row leaves it only by hand.
   */
  const priorRedirects: Record<string, string> = await readJson('player-redirects.json', {});
  const proposed: Record<string, string> = { ...priorRedirects };
  for (const [canonical, absorbed] of mergeReport.merged) {
    for (const old of absorbed) proposed[old] = canonical;
  }
  // Two rows are dropped rather than carried: one pointing at itself (a spelling
  // that later won the id back — Vercel serves a self-redirect as a loop), and
  // one whose target no longer exists (the whole player left the corpus, so the
  // redirect would land on a 404 of its own).
  const redirects = Object.fromEntries(
    Object.entries(proposed).filter(([from, to]) => from !== to && playerMap.has(to)),
  );

  await write('videos.json', withOverrides);
  await write('players.json', players);
  await write(
    'player-redirects.json',
    Object.fromEntries(Object.entries(redirects).sort(([a], [b]) => a.localeCompare(b))),
  );
  await write('review-queue.json', review);
  // Only on a run that HAD a witness. A carrying run leaves the committed file
  // exactly as it is rather than overwriting it with [] — the absence of a pull
  // is not evidence that the disagreements were resolved.
  if (witnessResult) await write('theater-disagreements.json', witnessResult.disagreements);
  await write('bench-queue.json', benchQueue);
  await write('seasonBoundaries.json', SEASONS);

  await emitGeneric(
    withOverrides,
    characters,
    players,
    CHANNELS.map((c) => c.source),
  );

  // ── report ─────────────────────────────────────────────────────────────────
  const sideTotal = withOverrides.length * 2;
  const byReason = tally(misses.map((m) => m.reason));
  const lines: string[] = [];
  lines.push('# Tōkon pipeline report', '');
  lines.push(`_Generated ${new Date().toISOString()}_`, '');
  lines.push('## Coverage', '');
  lines.push('| channel | uploads | parsed | share |', '| --- | ---: | ---: | ---: |');
  for (const ch of CHANNELS) {
    const raw: RawVideoRecord[] = await readJson(`../raw/${ch.id}.json`, []);
    const n = parsedPerChannel.get(ch.id) ?? 0;
    lines.push(
      // The events-only marker is not decoration. This channel's share reads
      // ~17% by design — 28 of its 47 uploads are online replays we decline —
      // and an unmarked low share is indistinguishable from a parser regression.
      // The events-only and index markers are not decoration. An unmarked low
      // share is indistinguishable from a parser regression, and a CARRIED
      // intake has no uploads at all this run — a bare "0 | 44" row would read
      // as a channel that died.
      `| ${ch.id}${ch.frozen ? ' _(frozen)_' : ''}${ch.eventsOnly ? ' _(events only)_' : ''}${
        ch.index ? (carriedWithFallback.includes(ch.id) ? ' _(carried)_' : ' _(index)_') : ''
      } | ${carriedWithFallback.includes(ch.id) ? '—' : raw.length} | ${n} | ${
        // A SHARE IS ONLY MEANINGFUL WHEN `parsed` CAME OUT OF `uploads`. On a
        // cursor run the dump is a delta of a few entries while `n` counts the
        // whole merged intake, so the division would read several hundred per
        // cent — a number that is not wrong so much as meaningless.
        carriedWithFallback.includes(ch.id) || (ch.index && theaterStats?.mode === 'cursor')
          ? '—'
          : `${raw.length ? ((n / raw.length) * 100).toFixed(1) : '0.0'}%`
      } |`,
    );
  }
  lines.push(`| **total** | | **${withOverrides.length}** | |`, '');

  // ── the index intakes ─────────────────────────────────────────────────────
  // Stated rather than assumed. The reader needs to know which number is holding
  // this intake up: the pin, not the collapse guard, which this file already
  // documents as asleep below 20 records — though a carry writes its count back
  // so the guard is at least armed rather than skipped.
  const indexIntakes = CHANNELS.filter((c) => c.cronFetchedWithCarry);
  if (indexIntakes.length > 0) {
    lines.push('## Index intakes', '');
    lines.push(
      'Fetched by the daily cron since 2026-08-31, and ADD-ONLY: a committed record is',
      'carried whether or not the catalogue still lists it, so this count can only rise.',
      'The cron does not depend on the pull succeeding — on any failure there is no dump,',
      'the committed records are carried, and the run stays green.',
      '',
    );
    lines.push(
      '| intake | records | pin | this run | pages | new | not in this pull |',
      '| --- | ---: | ---: | --- | ---: | ---: | ---: |',
    );
    for (const ch of indexIntakes) {
      const n = withOverrides.filter((r) => r.intake === ch.id).length;
      const carried = carriedWithFallback.includes(ch.id);
      // The pull's self-report is what distinguishes these four, and its ABSENCE
      // is a fifth state rather than a default: a dump with no stats beside it
      // was placed by hand, so nothing here knows whether it is a delta or a
      // sweep and the row must not claim either.
      const mode = carried
        ? theaterStats
          ? 'carried (pull found no new tournament entries)'
          : 'carried (no pull this run)'
        : !theaterStats
          ? 'rebuilt from a dump (no pull report)'
          : theaterStats.mode === 'cursor'
            ? `cursor delta${theaterStats.hitBound ? ' (hit page bound)' : ''}`
            : 'rebuilt from a full sweep';
      const survivors = theaterSurvivors.get(ch.id) ?? [];
      // WHAT "not in this pull" MEANS DEPENDS ON THE MODE, and conflating the
      // two would make it the most misleading number on this page. After a FULL
      // sweep it is "committed records no longer in the catalogue" — the
      // add-only rule's whole visible output. After a CURSOR run it is every
      // record older than the two or three pages read, which is nearly all of
      // them, and it means nothing at all. So the full number is reported and
      // the cursor number is withheld rather than dressed up.
      const gone = carried || theaterStats?.mode !== 'full' ? '—' : String(survivors.length);
      // THE PIN COLUMN IS NOT `pins`, ON A REBUILDING RUN. `pins` is the file as
      // it was read at the top of this function and it is never mutated — the
      // re-pin block builds `next = { ...pins }` and writes THAT — so printing
      // it here on a run that rebuilt shows yesterday's number beside today's
      // record count and contradicts the data/source-pins.json this same run
      // just wrote. Latent while rebuilds were rare and done by hand; the cron
      // makes them the ordinary case. A CARRY is the opposite: it did not write
      // the pin, it asserted itself against it, so the committed value is
      // exactly the right thing to show.
      const pin = carried ? (pins[ch.id] ?? '—') : n;
      lines.push(
        `| \`${ch.id}\` | ${n} | ${pin} | ${mode} | ${
          carried ? '—' : (theaterStats?.pagesRead ?? '—')
        } | ${carried ? '—' : n - survivors.length} | ${gone} |`,
      );
    }
    lines.push('');
    if (carriedWithFallback.includes('replayTheater')) {
      // A CARRY measures none of the counts below — the dump they would have
      // been measured from is absent. Saying so beats printing 0, which reads as
      // "checked, found nothing" when the truth is "not checked this run".
      lines.push(
        ...(theaterStats
          ? [
              '_The pull ran and found no new tournament entries, so the committed catalogue_',
              '_was carried unchanged. The cursor still advanced — a quiet day is the_',
              '_ordinary case here, not a failed one._',
            ]
          : [
              '_No pull produced a dump this run, so the committed catalogue was carried and_',
              '_the counts below were not measured. That is the designed fallback, not a_',
              '_failure of this run: `npm run data:theater` refreshes them._',
            ]),
        '',
      );
    } else if (theaterStats) {
      // The collapse is only observable HERE. The entries it merged are gone
      // from the dump by the time this file reads it, so a report that stayed
      // silent would be indistinguishable from a reader that lost records.
      lines.push(
        `Entries **collapsed as double-submitted**: **${theaterStats.collapsed ?? 0}** of ` +
          `${theaterStats.tagged ?? 0} tagged` +
          (Object.keys(theaterStats.collapsedTags ?? {}).length
            ? ` — ${Object.entries(theaterStats.collapsedTags ?? {})
                .sort((a, b) => b[1] - a[1])
                .map(([pair, k]) => `${k}× \`${pair}\``)
                .join(' · ')}`
            : '') +
          '. The same match submitted twice under two tag spellings; one copy kept, ' +
          'chosen on the tag so the survivor does not depend on submission order.',
        '',
      );
    }
    if (theaterSkippedKnown.length > 0) {
      const byWhere = tally(theaterSkippedKnown.map((k) => k.where));
      lines.push(
        `Entries **skipped as already-known**: **${theaterSkippedKnown.length}** ` +
          `(${fmtTally(byWhere)}). An id this repo has already ruled on, in any capacity, ` +
          `does not re-enter through a side door — existing ids win, by ignoring.`,
        '',
      );
    } else {
      lines.push(
        '_Entries skipped as already-known: **0**. The catalogue indexes no video this ' +
          'repo has fetched, published or ruled on._',
        '',
      );
    }
    if (theaterResidue.length > 0) {
      lines.push(
        `⚠ **${theaterResidue.length}** side(s) carried a character string that resolves to no ` +
          'roster id. Dropped to residue, never guessed:',
        '',
      );
      for (const r of theaterResidue.slice(0, 20)) lines.push(`- \`${r.id}\` — ${r.raw}`);
      lines.push('');
    }
  }

  lines.push('## Character provenance', '');
  lines.push(`How every one of the ${sideTotal} sides got its characters.`, '');
  lines.push('| tier | sides | share |', '| --- | ---: | ---: |');
  // Derived from tierCount, never re-listed. A hand-written array here is a
  // second copy of the union that the `as CharTier[]` cast stops the compiler
  // from checking, so adding a tier and forgetting this line would drop a whole
  // tier out of report.md — the precise regression the re-tally above exists to
  // have already fixed once.
  for (const t of Object.keys(tierCount) as CharTier[]) {
    lines.push(
      `| ${t} | ${tierCount[t]} | ${sideTotal ? ((tierCount[t] / sideTotal) * 100).toFixed(1) : '0.0'}% |`,
    );
  }
  lines.push('');
  lines.push(
    `- complete (4/4): **${completeSides}/${sideTotal}** ` +
      `(${sideTotal ? ((completeSides / sideTotal) * 100).toFixed(1) : '0.0'}%)`,
  );
  // OVERSIZE SIDES ARE REPORTED, NOT ONLY COUNTED ON A CONSOLE.
  //
  // A side of more than four is a legitimate mid-set team change, and emit excludes
  // it from any pairing surface so C(n,2) cannot fabricate pairs that were never
  // played. An exclusion nobody can see in the artifact they consult is
  // indistinguishable from data quietly going missing — the same argument that put
  // the provenance tally in this file.
  const oversizeSides = withOverrides.reduce(
    (n, r) => n + r.sides.filter((s) => s.characters.length > 4).length,
    0,
  );
  lines.push(
    `- oversize (>4, mid-set team change): **${oversizeSides}** — counted in usage, excluded from pairing`,
  );

  // THE UNION SLIP, WHICH LOOKS EXACTLY LIKE HEALTHY DATA.
  //
  // When two players swap screen sides mid-match, both portrait clusters appear
  // on both halves, and reading the whole HUD puts all eight fighters on each
  // side. The result is two oversize sides holding an IDENTICAL set — and every
  // check downstream waves it through, because a side longer than four is a
  // legitimate mid-set team change, counted in usage and merely excluded from
  // pairing. Sixteen side appearances get counted for a match that had eight.
  //
  // Found twice in ~380 records, one of them live on the site for days. The save
  // path now refuses it (bench-review.post.ts); this line is the backstop for
  // anything written before that guard existed, and for a hand-edited override.
  //
  // Identity alone is NOT the signature: a four-fighter mirror match is legal
  // and present in this corpus. It takes identity AND oversize, which a mirror
  // cannot reach.
  const unionSlips = withOverrides.filter((r) => {
    const [a, b] = r.sides.map((sd) => sd.characters);
    if (!a || !b || a.length <= 4) return false;
    return [...a].sort().join(',') === [...b].sort().join(',');
  });
  if (unionSlips.length) {
    lines.push(
      `- ⚠ **${unionSlips.length} record(s) with identical oversize sides** — both screen clusters`,
      `  read onto one side, which is what a mid-match side swap looks like. Re-read in`,
      `  /dev/bench-review: ${unionSlips.map((r) => r.id).join(', ')}`,
    );
  }
  lines.push(`- bench alignment: ${fmtTally(alignCount) || '—'}`);
  lines.push(`- title slot order: ${fmtTally(slotOrders)}`);
  lines.push(`- tier conflicts (queued for review): ${conflicts}`);
  lines.push(`- decomposed-Ō titles seen: ${decomposedOnly}`);
  lines.push('');

  // ── THE SIDE-SIZE DISTRIBUTION, AND WHY A PERCENTAGE IS NOT ENOUGH ─────────
  //
  // "complete 71.5%" above is a single number that moves slowly and hides which
  // direction it is moving for. The distribution does not: this corpus is
  // BIMODAL — sides are either 1 (title only, nothing has drained them) or 4
  // (a description, the reader, or a human closed them), with essentially
  // nothing between. So the count at 1 IS the undrained backlog, and watching it
  // is watching the drift.
  //
  // This exists because the drift ran for four days unseen. Extraction is
  // local-only by design (YouTube blocks datacenter IPs), so the daily cron adds
  // ~25 sides/day at 1-of-4 and structurally cannot drain them. Without this
  // block the first visible symptom is a lone badge on the live site; with it,
  // the day the backlog starts growing is in the commit the cron itself makes.
  const sizeTally = new Map<number, number>();
  for (const r of withOverrides)
    for (const s of r.sides)
      sizeTally.set(s.characters.length, (sizeTally.get(s.characters.length) ?? 0) + 1);
  const sizeKeys = [...sizeTally.keys()].sort((a, b) => a - b);
  lines.push('### Side-size distribution', '');
  lines.push('| fighters on a side | sides | share |', '| --- | ---: | ---: |');
  for (const k of sizeKeys) {
    const n = sizeTally.get(k)!;
    lines.push(
      `| ${k}${k > 4 ? ' _(mid-set change)_' : ''} | ${n} | ${sideTotal ? ((n / sideTotal) * 100).toFixed(1) : '0.0'}% |`,
    );
  }
  lines.push('');

  // The backlog's AGE, not only its size. A queue of 40 that is all from today is
  // a normal day; a queue of 40 whose oldest entry is three weeks back means the
  // drain has stopped, and the two are indistinguishable from a count alone.
  const queueDays = benchQueue
    .map((q) => Math.floor((Date.now() - Date.parse(q.publishedAt)) / 86_400_000))
    .sort((a, b) => b - a);
  const oldest = queueDays[0] ?? 0;
  const benchSides = withOverrides.reduce(
    (n, r) => n + r.sides.filter((s) => s.characters.length < 4).length,
    0,
  );
  lines.push(
    `- **${benchSides} side(s) awaiting a drain** across ${benchQueue.length} record(s)` +
      (benchQueue.length ? ` — oldest published **${oldest} day(s)** ago` : ''),
  );
  if (benchQueue.length >= BENCH_QUEUE_NUDGE) {
    lines.push(
      '',
      `> The bench queue is at ${benchQueue.length} (nudge threshold ${BENCH_QUEUE_NUDGE}).`,
      '> Run `npm run data:catchup` locally — the cron cannot do this: extraction',
      '> needs a logged-in YouTube session from a residential address.',
    );
  }
  lines.push('');

  lines.push('## Queues', '');
  lines.push(
    `- review queue (never published): **${review.length}** — ${fmtTally(tally(review.map((r) => r.kind))) || '—'}`,
  );
  lines.push(`- bench queue (published, incomplete): **${benchQueue.length}**`);
  lines.push('');

  // ── player identity ───────────────────────────────────────────────────────
  if (mergeReport.merged.size) {
    lines.push('## Player identity', '');
    lines.push(
      `${mergeReport.merged.size} identity(s) resolved from more than one spelling. The`,
      'retired ids are 301-redirected from vercel.json — run `npm run data:redirects`',
      'after changing scripts/players.ts, or the old URLs 404.',
      '',
    );
    lines.push('| canonical | absorbed |', '| --- | --- |');
    for (const [canonical, absorbed] of [...mergeReport.merged].sort()) {
      lines.push(`| \`${canonical}\` | ${absorbed.map((a) => `\`${a}\``).join(' · ')} |`);
    }
    lines.push('');
  }

  if (witnessResult) lines.push(...formatCrossCheck(witnessResult, witness?.mode));

  lines.push('## Misses', '');
  lines.push('| reason | count |', '| --- | ---: |');
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${reason} | ${n} |`);
  }
  lines.push('');

  // ── the events-only classifier, per channel ───────────────────────────────
  // A `not-an-event` count is the ONLY place an unrecognised tournament brand
  // shows up: EVENT_RE is deliberately tight, so a new event the list does not
  // know is dropped rather than published under the Tournament chip. Watching
  // this number is how that stays a two-minute fix instead of a silent gap. It
  // should track the channel's online output (~28 today) and no higher.
  for (const ch of CHANNELS.filter((c) => c.eventsOnly)) {
    const dropped = misses.filter((m) => m.channel === ch.id && m.reason === 'not-an-event');
    lines.push(
      `- \`${ch.id}\` events-only gate: **${dropped.length}** upload(s) carried no known event brand.`,
    );
    // Name the most recent few. A brand-new event reads as an unfamiliar title
    // here long before it reads as a missing record anywhere else.
    for (const m of dropped.slice(0, 5)) lines.push(`  - ${m.title.slice(0, 96)}`);
    if (dropped.length > 5) lines.push(`  - …and ${dropped.length - 5} more`);
    lines.push('');
  }

  if (residues.size) {
    lines.push('## Unmatched text in character slots', '');
    lines.push('Text no roster alias covered. A new fighter, a new nickname, or a typo —', '');
    lines.push('| text | count | example |', '| --- | ---: | --- |');
    for (const [text, e] of [...residues].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
      lines.push(`| \`${text}\` | ${e.n} | ${e.ids[0]} |`);
    }
    lines.push('');
  }

  // ── handles that read like the game, not like a person ────────────────────
  // SURFACED, NEVER REWRITTEN — the same contract as the residue block above.
  // These are not parse errors: the uploader typed the game name (or a
  // placeholder) into the handle slot and the parser read the slot correctly.
  // "TOKON PLAYER" and "TŌKON PLAYER" are the same placeholder on two channels,
  // split only by the macron, which is exactly the kind of thing a person has to
  // adjudicate and a regex must not. Rewriting them would be the guess this
  // parser refuses everywhere else; leaving them unlisted is how the NEXT one
  // becomes a silent player page.
  const gameish = new Map<string, { n: number; ids: string[] }>();
  for (const r of withOverrides) {
    for (const side of r.sides) {
      if (!/t[ōo]kon|marvel/iu.test(side.handle)) continue;
      const e = gameish.get(side.handle) ?? { n: 0, ids: [] };
      e.n += 1;
      if (e.ids.length < 3) e.ids.push(r.id);
      gameish.set(side.handle, e);
    }
  }
  if (gameish.size) {
    lines.push('## Handles that resemble the game name', '');
    lines.push(
      'Handles matching `/t[ōo]kon|marvel/i`. The parser read the slot correctly —',
      'the uploader put this in the handle position. Listed so a placeholder or a',
      'garbled game name gets a human verdict instead of a quiet player page.',
      '',
    );
    lines.push('| handle | records | example |', '| --- | ---: | --- |');
    for (const [handle, e] of [...gameish].sort((a, b) => b[1].n - a[1].n)) {
      lines.push(`| \`${handle}\` | ${e.n} | ${e.ids[0]} |`);
    }
    lines.push('');
  }

  // ── the soft severity of the self-expiring gates ──────────────────────────
  // This path NEVER exits. A hard exit here would fail `npm run data:build` and
  // stop the daily refresh entirely, which is strictly worse than the misfiling
  // it warns about. The data gets written and pushed; the workflow's final step
  // goes red afterwards so the pending work cannot be missed.
  //
  // The block lands at the TOP of report.md on purpose, and it is real content
  // rather than a timestamp — so the cron's commit guard, which drops a
  // report.md whose only diff is its "_Generated_" line, lets it through on the
  // day it first appears even if nothing else changed.
  const due = dueExpiries();

  // A residue string on 3+ records is a roster event, not noise.
  const bigResidue = [...residues].filter(([, e]) => e.n >= 3);
  const actionRequired: string[] = [];
  if (due.length) actionRequired.push(...expiryBlock(due));
  if (collisions.length) {
    actionRequired.push(
      ...(due.length ? [] : ['## ⚠ ACTION REQUIRED', '']),
      `${collisions.length} normalised player key(s) still hold more than one player:`,
      ...collisions.map((c) => `- \`${c.key}\` — ${c.handles.join(' · ')}`),
      '',
      'Either they are one person (add a HANDLE_ALIASES entry in scripts/players.ts)',
      'or they are two (add the key to DISTINCT_KEYS). Both answers are cheap; leaving',
      'it undecided means one player reads as two, or two read as one, and the page',
      'looks correct either way.',
      '',
    );
  }
  if (bigResidue.length) {
    actionRequired.push(
      ...(due.length ? [] : ['## ⚠ ACTION REQUIRED', '']),
      `${bigResidue.length} unmatched character-slot string(s) appear on 3+ records:`,
      ...bigResidue.map(([t, e]) => `- \`${t}\` × ${e.n} (e.g. ${e.ids[0]})`),
      '',
      'A new fighter has probably shipped. Add it to scripts/characters.ts and',
      'get an accent token before it silently shortens every side it appears on.',
      '',
    );
  }
  if (actionRequired.length) lines.splice(2, 0, ...actionRequired);

  await writeFile(join(DATA, 'report.md'), lines.join('\n') + '\n', 'utf8');

  console.log(
    `\n✔ parsed ${withOverrides.length} records from ${CHANNELS.length} channels ` +
      `(${misses.length} misses)`,
  );
  console.log(
    `  provenance: ${fmtTally(tierCount)}  ·  complete ${completeSides}/${sideTotal}` +
      `  ·  conflicts ${conflicts}`,
  );
  console.log(`  queues: review ${review.length} · bench ${benchQueue.length}`);
  if (mergeReport.merged.size) {
    const absorbed = [...mergeReport.merged.values()].reduce((n, a) => n + a.length, 0);
    console.log(
      `  identity: ${absorbed} spelling(s) merged into ${mergeReport.merged.size} player(s)`,
    );
  }
  if (bigResidue.length)
    console.log(`  ⚠ ACTION REQUIRED: ${bigResidue.length} residue string(s) on 3+ records`);
  if (collisions.length)
    console.log(`  ⚠ ACTION REQUIRED: ${collisions.length} undeclared player key collision(s)`);
  if (due.length) {
    // Loud, but NOT fatal — see the note above the block. The workflow's final
    // step is what turns this red, after the data is safely pushed.
    console.log(`\n  ⚠ ${due.length} EXPIRY(S) DUE — written to report.md, not exiting here:`);
    for (const d of due) console.log(`      ${d.id} (${d.kind}, due ${d.date})`);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function readJson<T>(rel: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(DATA, rel), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** data/videos.json, read strictly. ENOENT is a legitimate first run and yields
 *  []; anything else — a truncated file, a bad merge, a half-written flush —
 *  throws. See the call site for why this one file cannot take readJson's
 *  fallback. */
async function readCommitted(): Promise<MatchVideo[]> {
  let text: string;
  try {
    text = await readFile(join(DATA, 'videos.json'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('data/videos.json is not an array — refusing to treat it as an empty corpus.');
  }
  return parsed as MatchVideo[];
}
const write = (name: string, value: unknown) =>
  writeFile(join(DATA, name), JSON.stringify(value, null, 2) + '\n', 'utf8');

/**
 * Refuse to parse a dump that provably predates the committed corpus.
 *
 * WALL-CLOCK AGE WAS A PROXY, AND THE PROXY LEAKED. This compared raw's mtime
 * against data/videos.json's with a 24-hour tolerance, and on 2026-08-29 a dump
 * one day old parsed 435 records over a committed 455 — inside the tolerance,
 * so the guard stayed silent. That is the same failure the sibling Tekken repo
 * lost 373 records to, wearing the guard built to prevent it. Tightening the
 * number only moves the leak: no fixed window is right for a corpus the cron
 * rewrites daily and a human refetches on no schedule.
 *
 * MTIME WAS A PROXY TOO, AND IT LEAKED THE SAME WAY. The first replacement kept
 * the clock and only sharpened the comparison — dump mtime against the newest
 * committed publishedAt. It is a sound relation and it still failed in practice,
 * because mtime is not a record of when a dump was FETCHED: `npm run
 * verify:gates` restores raw/ with `cp`, a fresh clone writes every file at
 * checkout time, and both stamp a months-old dump as new. Caught live on
 * 2026-08-30, when a 13-hour-old dump whose mtime had been reset by a gates run
 * parsed 523 records over a committed 536 with the guard silent.
 *
 * SO THE TEST READS ONLY DATA. A dump cannot contain an upload published after
 * it was taken, so if the committed corpus holds a record for this intake that
 * is NEWER than the newest upload anywhere in the dump, that record cannot have
 * come from this dump and parsing would drop it. Both sides of that comparison
 * are publish timestamps written by YouTube and carried in the files
 * themselves; no filesystem metadata is consulted, so `cp`, `git checkout` and
 * a fresh clone cannot forge it.
 *
 * What it buys:
 *  · fires at ANY age. A dump taken two minutes before the cron's is caught,
 *    where a 24-hour window never would be.
 *  · never fires on age alone. A months-old dump for a channel that has
 *    published nothing since is not stale, and re-parsing in the same session
 *    is always allowed — the committed corpus can only hold what this dump
 *    produced.
 *  · a DELETED upload stays legal. Committed holds it, the dump does not, but
 *    the dump's newest is unchanged — which is the prune this pipeline exists
 *    to publish, and the guard must not block it.
 *
 * Scoped per intake, because a stale telly dump says nothing about ranked.
 */
function assertRawIsFresh(id: ChannelKey, dump: RawVideoRecord[], committed: MatchVideo[]): void {
  let newestInDump = '';
  for (const r of dump) if (r.publishedAt > newestInDump) newestInDump = r.publishedAt;
  if (!newestInDump) return; // empty dump: the caller already refuses that

  let newestCommitted: MatchVideo | undefined;
  for (const v of committed) {
    if (v.intake !== id) continue;
    if (!newestCommitted || v.publishedAt > newestCommitted.publishedAt) newestCommitted = v;
  }
  if (!newestCommitted) return; // nothing committed for this intake yet
  if (newestCommitted.publishedAt <= newestInDump) return;

  throw new Error(
    [
      `raw/${id}.json is stale: the committed corpus holds an upload it cannot contain.`,
      ``,
      `  newest upload in the dump   ${newestInDump}`,
      `  newest committed record     ${newestCommitted.publishedAt}  ${newestCommitted.id}`,
      ``,
      `  A dump cannot contain an upload published after it was taken, so parsing`,
      `  now would drop that record and every one like it — and the next run would`,
      `  treat the smaller archive as the new baseline.`,
      ``,
      `  Refresh first:  npm run data:fetch`,
    ].join('\n'),
  );
}

const tally = <T extends string>(xs: T[]): Record<string, number> =>
  xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
const fmtTally = (o: Record<string, number>) =>
  Object.entries(o)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');

await main();
