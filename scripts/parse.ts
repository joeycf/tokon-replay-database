/**
 * Stage 2: raw/<channel>.json → data/videos.json (+ players, queues, report),
 * then emit the engine artifacts.
 *
 * Run: npm run data:parse
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { alignBench, readBench } from './bench';
import { ACTIVE_CHANNELS, CHANNELS } from './channels';
import { applyOverrides, emitGeneric } from './emit';
import { dueExpiries, expiryBlock } from './expiries';
import { LAUNCH, SEASONS, seasonForDate } from './patches';
import { buildAliasMatcher, loadCharacters, playerId, stripLeaderboard } from './roster';
import type {
  BenchQueueItem,
  CharProvenance,
  CharTier,
  ChannelKey,
  MatchSide,
  MatchVideo,
  PlayerRecord,
  RawVideoRecord,
  ReviewQueueItem,
  SlotOrder,
  VideoOverride,
} from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'raw');
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
const NOT_A_MATCH_RE =
  /\bCPU\b|HARDEST\s*AI|MAX\s*DIFFICULTY|#shorts|COMBO\s*(?:EXHIBITION|VIDEO|GUIDE)|\bTRAILER\b|TIER\s*LIST|STORY\s*MODE|WALKTHROUGH|ALL\s*(?:SUPERS|CHARACTERS|WIN)|COMPILATION|\bINTRO\b|BETA\s*TEST|\bREVIEW\b|GAMEPLAY\s*OVERVIEW|CHARACTER\s*GUIDE|\bRANKING\b|\bTUTORIAL\b/iu;

type MissReason =
  | 'not-tokon'
  | 'other-game'
  | 'pre-launch'
  | 'live-or-upcoming'
  | 'short-duration'
  | 'not-a-match'
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
// The ▰ affixes are cut RELATIVE TO THE PARENS rather than by counting ▰:
// everything up to the last ▰ that precedes the first "(", and everything from
// the first ▰ that follows the last ")". That is what makes variant (c) — where
// ▰ appears only as a suffix — work without a special case, and it can never
// eat into a side segment.
// ─────────────────────────────────────────────────────────────────────────────

const BRACKET_TAIL_RE = /\s*【[^】]*】\s*$/u;
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

  // Cut the ▰ affixes RELATIVE TO THE ANCHOR rather than by counting them:
  // everything up to the last ▰ preceding the sides, and everything from the
  // first ▰ following them. That is what makes the suffix-only variant
  // ("HANDLE (Char) vs HANDLE (Char) ▰ …") work with no special case, and it
  // can never eat into a side segment.
  let start = 0;
  let end = s.length;
  const lead = s.lastIndexOf('▰', anchorStart);
  if (lead >= 0) start = lead + 1;
  const trail = s.indexOf('▰', anchorEnd);
  if (trail >= 0) end = trail;

  s = s.slice(start, end).replace(EMOJI_TAIL_RE, '').trim();
  // A ▰ still inside the core means a mid-title accolade ("▰ Rank 1 NA ▰") we
  // have not modelled. Refuse rather than guess where the sides begin.
  return s.includes('▰') ? null : s;
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
    .split('▰')
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

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const characters = await loadCharacters();
  const matcher = buildAliasMatcher(characters);
  const overrides: Record<string, VideoOverride> = await readJson('overrides.json', {});
  const committed: MatchVideo[] = await readJson('videos.json', []);

  const misses: Miss[] = [];
  const review: ReviewQueueItem[] = [];
  const benchQueue: BenchQueueItem[] = [];
  /** static per-record fields the post-override queue rebuild needs */
  const byIdForQueue = new Map<
    string,
    { channel: ChannelKey; title: string; publishedAt: string; durationSec: number }
  >();
  const residues = new Map<string, { n: number; ids: string[] }>();
  let decomposedOnly = 0;
  const slotOrders: Record<SlotOrder, number> = {
    'handle-first': 0,
    'chars-first': 0,
    'parallel-lists': 0,
  };
  const tierCount: Record<CharTier, number> = { title: 0, description: 0, footage: 0, human: 0, review: 0 };
  const alignCount: Record<string, number> = {};
  let conflicts = 0;
  let completeSides = 0;

  const records: MatchVideo[] = [];
  const parsedPerChannel = new Map<ChannelKey, number>();

  for (const ch of ACTIVE_CHANNELS) {
    const raw: RawVideoRecord[] = await readJson(`../raw/${ch.id}.json`, []);
    if (raw.length === 0) {
      throw new Error(
        `raw/${ch.id}.json is empty or missing — run \`npm run data:fetch\` before parsing.`,
      );
    }
    // Stale-raw guard: parsing a raw dump older than the committed catalogue
    // silently republishes yesterday's world as today's.
    await assertRawIsFresh(ch.id);

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
      if (v.publishedAt.slice(0, 10) < LAUNCH) {
        misses.push({ id: v.id, channel: ch.id, title, reason: 'pre-launch' });
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
          review.push({
            id: v.id,
            kind: 'character-completion',
            channel: ch.id,
            title,
            publishedAt: v.publishedAt,
            durationSec: v.durationSec,
            handles: [bare[0]!, bare[1]!],
          });
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
      if (handles.some((h) => !h || h.length > 40)) {
        misses.push({
          id: v.id,
          channel: ch.id,
          title,
          reason: 'bad-handle',
          detail: handles.join(' | '),
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
        review.push({
          id: v.id,
          kind: 'character-completion',
          channel: ch.id,
          title,
          publishedAt: v.publishedAt,
          durationSec: v.durationSec,
          handles,
        });
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
            // and send it to a human.
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
          complete: chars.length === 4,
        };
        tierCount[tier] += 1;
        if (provenance.complete) completeSides += 1;

        // A description handle beats an ALL-CAPS title handle for display.
        const handle =
          benchSide && benchSide.handle && benchSide.handle.length <= 40
            ? benchSide.handle
            : handles[i];

        built.push({ player: playerId(handle), handle, characters: chars, provenance });
      }

      if (recordConflict) {
        conflicts += 1;
        review.push({
          id: v.id,
          kind: 'bench-conflict',
          channel: ch.id,
          title,
          publishedAt: v.publishedAt,
          durationSec: v.durationSec,
          handles,
          conflict: {
            side: built[0]!.provenance.conflict ? 0 : 1,
            fromTitle: built[built[0]!.provenance.conflict ? 0 : 1]!.provenance.fromTitle,
            fromDescription:
              built[built[0]!.provenance.conflict ? 0 : 1]!.provenance.fromDescription ?? [],
          },
        });
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
  records.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
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
    const known = [r.sides[0]!.characters.length, r.sides[1]!.characters.length] as [number, number];
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
  for (const r of withOverrides) {
    for (const s of r.sides) {
      const existing = playerMap.get(s.player);
      if (!existing) playerMap.set(s.player, { id: s.player, handle: s.handle });
      else if (s.handle !== existing.handle && /[a-z]/.test(s.handle)) {
        // Prefer the mixed-case spelling; ALL CAPS titles are the noisy source.
        existing.handle = s.handle;
      }
    }
  }
  const players = [...playerMap.values()].sort((a, b) => a.id.localeCompare(b.id));

  // ── write ──────────────────────────────────────────────────────────────────
  await write('videos.json', withOverrides);
  await write('players.json', players);
  await write('review-queue.json', review);
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
      `| ${ch.id}${ch.frozen ? ' _(frozen)_' : ''} | ${raw.length} | ${n} | ${raw.length ? ((n / raw.length) * 100).toFixed(1) : '0.0'}% |`,
    );
  }
  lines.push(`| **total** | | **${withOverrides.length}** | |`, '');

  lines.push('## Character provenance', '');
  lines.push(`How every one of the ${sideTotal} sides got its characters.`, '');
  lines.push('| tier | sides | share |', '| --- | ---: | ---: |');
  for (const t of ['title', 'description', 'footage', 'human', 'review'] as CharTier[]) {
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
  lines.push(`- bench alignment: ${fmtTally(alignCount) || '—'}`);
  lines.push(`- title slot order: ${fmtTally(slotOrders)}`);
  lines.push(`- tier conflicts (queued for review): ${conflicts}`);
  lines.push(`- decomposed-Ō titles seen: ${decomposedOnly}`);
  lines.push('');

  lines.push('## Queues', '');
  lines.push(
    `- review queue (never published): **${review.length}** — ${fmtTally(tally(review.map((r) => r.kind))) || '—'}`,
  );
  lines.push(`- bench queue (published, incomplete): **${benchQueue.length}**`);
  lines.push('');

  lines.push('## Misses', '');
  lines.push('| reason | count |', '| --- | ---: |');
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${reason} | ${n} |`);
  }
  lines.push('');

  if (residues.size) {
    lines.push('## Unmatched text in character slots', '');
    lines.push('Text no roster alias covered. A new fighter, a new nickname, or a typo —', '');
    lines.push('| text | count | example |', '| --- | ---: | --- |');
    for (const [text, e] of [...residues].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
      lines.push(`| \`${text}\` | ${e.n} | ${e.ids[0]} |`);
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
  if (bigResidue.length)
    console.log(`  ⚠ ACTION REQUIRED: ${bigResidue.length} residue string(s) on 3+ records`);
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
const write = (name: string, value: unknown) =>
  writeFile(join(DATA, name), JSON.stringify(value, null, 2) + '\n', 'utf8');

async function assertRawIsFresh(id: ChannelKey): Promise<void> {
  try {
    const rawStat = await stat(join(RAW, `${id}.json`));
    const videosStat = await stat(join(DATA, 'videos.json'));
    if (rawStat.mtimeMs < videosStat.mtimeMs - 86_400_000) {
      throw new Error(
        `raw/${id}.json is more than a day older than data/videos.json.\n` +
          `  Parsing it would republish a stale world. Run \`npm run data:fetch\` first.`,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('stale world')) throw e;
    // videos.json absent on a first run — nothing to be stale against.
  }
}

const tally = <T extends string>(xs: T[]): Record<string, number> =>
  xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
const fmtTally = (o: Record<string, number>) =>
  Object.entries(o)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');

await main();
