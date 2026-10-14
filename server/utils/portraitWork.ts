/**
 * The bench-diamond labelling worklist, built identically for every endpoint that
 * touches it.
 *
 * WHY HAND LABELS AT ALL. Co-occurrence can only learn from sides whose bench is
 * already known from a description, and that caps the training set at 82 sides —
 * it reached 46.9% top-3 recall as an upper bound, with four fighters getting no
 * template. But Step 0 established that ALL FOUR of a side's fighters are drawn in
 * every HUD frame, so a person reading an upscaled corner is fast and exact. A few
 * dozen sides of hand labels beat everything inference produced.
 *
 * THE TASK IS AN ASSIGNMENT, NOT A RECALL TEST. For a side whose description names
 * its bench, the three diamonds hold a known SET of three fighters — what is
 * unknown is which diamond holds which, because the icons move between cells as
 * the point fighter changes. So the labeller picks among three candidates per
 * diamond rather than among twenty-one, which is why ~50 sides is one sitting.
 *
 * The list is derived deterministically and sorted by video id, so an index means
 * the same thing to the crop endpoint, the page and the writer without any of them
 * passing a video id around.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The title-refutation rules are shared with parse, e2e and verify-gates, none of
// which can import each other — see the module's header.
import { unmetTitle, type TitleSide } from '../../scripts/title-refutation';

export interface WorkItem {
  video: string;
  sec: number;
  side: 'L' | 'R';
  /** the fighter the plate read at this second — drawn as the bust, not a diamond */
  point: string;
  /** the three the diamonds must hold, in some order */
  candidates: string[];
}

interface FrameRead {
  sec: number;
  id: string | null;
  dist: number;
}
interface Extracted {
  left: FrameRead[];
  right: FrameRead[];
  geom: unknown;
}

export function readJson<T>(rel: string, fallback: T): T {
  const f = join(process.cwd(), rel);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback;
}

export function buildWorkList(): WorkItem[] {
  const extracted = readJson<Record<string, Extracted>>('cache/tokon/extracted.json', {});
  const videos = readJson<
    { id: string; sides: { provenance: { fromDescription?: string[] } }[] }[]
  >('data/videos.json', []);

  const out: WorkItem[] = [];
  for (const v of [...videos].sort((a, b) => a.id.localeCompare(b.id))) {
    if (v.sides.length !== 2) continue;
    // TRUTH IS THE DESCRIPTION'S BENCH. `characters.length === 4` now admits sides
    // the footage tier itself completed, which would feed the reader its own output.
    const benches = v.sides.map((s) => s.provenance.fromDescription ?? []);
    if (!benches.every((b) => b.length === 4)) continue;
    const e = extracted[v.id];
    if (!e?.geom) continue;
    if (!existsSync(join(process.cwd(), 'cache/tokon/frames', v.id))) continue;

    for (const side of ['L', 'R'] as const) {
      const reads = (side === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0);
      if (!reads.length) continue;
      // one frame per side, taken from the middle of what was read: early frames
      // catch walk-ons and round transitions where the cluster is still animating
      const r = reads[Math.floor(reads.length / 2)]!;
      const owning = benches.filter((b) => b.includes(r.id!));
      if (owning.length !== 1) continue; // ambiguous attribution — not a labelling task
      const frame = join(
        process.cwd(),
        'cache/tokon/frames',
        v.id,
        `${String(r.sec).padStart(6, '0')}.png`,
      );
      if (!existsSync(frame)) continue;
      out.push({
        video: v.id,
        sec: r.sec,
        side,
        point: r.id!,
        candidates: owning[0]!.filter((c) => c !== r.id),
      });
    }
  }

  // RAREST FIGHTERS FIRST. The worklist inherits the description corpus's
  // popularity skew — Magneto appears in 27 candidate sets, Wolverine and Peni
  // Parker in one each — and templates are only as good as their thinnest class.
  // Ordering by the rarity of a side's rarest fighter means a session that stops
  // early still bought the coverage that mattered, instead of a 20th crop of
  // Spider-Man.
  //
  // Deterministic, and a pure function of the candidate sets, so an index means
  // the same thing to every endpoint. Labels are keyed by video/second/side/cell
  // rather than by index, so a reordering cannot detach a stored label from the
  // crop it describes.
  const freq = new Map<string, number>();
  for (const w of out) for (const c of w.candidates) freq.set(c, (freq.get(c) ?? 0) + 1);
  const rarity = (w: WorkItem) => Math.min(...w.candidates.map((c) => freq.get(c) ?? 0));
  return out.sort(
    (a, b) =>
      rarity(a) - rarity(b) || a.video.localeCompare(b.video) || a.side.localeCompare(b.side),
  );
}

/** Stable key for one labelled diamond. */
export const labelKey = (w: WorkItem, cell: string): string =>
  `${w.video}/${w.sec}/${w.side}/${cell}`;

/**
 * The BENCH-QUEUE worklist — the human path, and the one that ships.
 *
 * The truth worklist above exists to build templates. This one exists to DRAIN:
 * its items are the corpus's genuinely incomplete sides, and a person reading them
 * is the final answer rather than training data. The portrait reader was measured
 * and stopped (see CharTier), so nothing here pre-sorts by hash; the candidate list
 * is the whole roster and the crop is the evidence.
 *
 * TWO FRAMES, COMPARED AS SETS. Each item carries two frames from different bursts,
 * because one frame can catch the cluster mid-animation or behind a super. But the
 * icons PERMUTE between cells as the point fighter changes, so cell A in one frame
 * is not cell A in the other and a per-cell comparison would flag disagreements that
 * are not disagreements. What must match is the SET of three.
 *
 * The point fighter is not asked for. The nameplate reader scored 100% on human
 * plate labels, so the bust's fighter is already known and the person only reads the
 * three assists — four of four from three picks.
 */
export interface BenchItem {
  video: string;
  /** which record side this screen side belongs to, or NULL when the plate could
   *  not attribute it and a person has to say */
  sideIndex: number | null;
  side: 'L' | 'R';
  /** two seconds from different bursts */
  secs: [number, number];
  /** the plate's point fighter at each second, or null where it read nothing */
  points: [string | null, string | null];
  /** what the record already knows for this side (empty when unattributed) */
  known: string[];
  /** both players' handles, in record order — what a person attributes BY */
  handles: [string, string];
  /** what the plate could not supply, so the page knows what to ask for */
  needs: { side: boolean; point: boolean };
  /** every cached second for this video, so a reviewer stuck on a cinematic or a
   *  super flash can step to a frame that shows the cluster */
  allSecs: number[];
  /** complete, yet missing the fighter its own title names — the free positive
   *  control failing, so the side is WRONG rather than done */
  recheck: boolean;
  /** the record's title as it stands, shown to the reviewer: the page used to
   *  judge a title it never displayed */
  title: string;
  /** fighters the plate read on the OTHER screen side. A title fighter the
   *  reading lacks that turns up here is the signature of a title that put a
   *  fighter on the wrong player (dE1pzpogWsU's Black Panther), not of a misread. */
  opposite: string[];
}

/**
 * THE FREE POSITIVE CONTROL, AS ONE PREDICATE: a side with a full bench that
 * still omits a fighter its title names. Such a side is WRONG rather than done.
 *
 * Extracted 2026-10-14 so the worklist below, the bench-review GET and
 * verify-gates all ask the same question. It is the e2e predicate
 * (`fromTitle ⊆ characters`, scripts/title-refutation.ts unmetTitle) restricted
 * to complete sides, because an incomplete side is unfinished for a simpler
 * reason and is already in the queue.
 *
 * A side whose title a person RULED WRONG passes, because the refuted ids are in
 * `titleRefuted`, not `fromTitle`. One that merely dropped them does not.
 */
export function failsControl(s: TitleSide): boolean {
  return s.characters.length >= 4 && unmetTitle(s).length > 0;
}

/**
 * THE BENCH-REVIEW PARTITION. A saved side is resolved only if it also passes its
 * control.
 *
 * c650959 (2026-09-11) partitioned on `done` alone — any human read at all — and
 * that silently undid 58836f3's "a failing control now means unfinished": a
 * complete side failing its title went to the drained list, visible only under
 * "show drained", and five of them sat there for three weeks while e2e was red.
 */
export const benchPartition = (it: { done: boolean; recheck: boolean }): 'pending' | 'resolved' =>
  it.done && !it.recheck ? 'resolved' : 'pending';

/**
 * Which overrides.json side a worklist item was saved to: matched by the SCREEN
 * side it was read from, else by the record side when the plate attributed it.
 * The GET reads both its "saved" tick and its recheck from this one side, so the
 * two can never describe different sides.
 */
export function savedSideFor<S extends { provenance?: { humanScreenSide?: string } }>(
  w: Pick<BenchItem, 'side' | 'sideIndex'>,
  ovSides: S[],
): S | undefined {
  const byScreen = ovSides.find((s) => s.provenance?.humanScreenSide === w.side);
  if (byScreen) return byScreen;
  return w.sideIndex !== null ? ovSides[w.sideIndex] : undefined;
}

/**
 * WHAT A SAVE ASKS FOR — read from the POST body.
 *
 * There used to be ONE flag, `force`, and it bypassed two unrelated refusals: the
 * two frames disagreeing, and the reading omitting a fighter the title names. The
 * second bypass wrote nothing down. A leftover "use frame A anyway" click after
 * fixing the picks skipped the title check as silently as "drop them and save"
 * did, and both left a side that failed e2e forever (2026-10-05 diagnosis: five
 * sides, every one a correct read of a wrong title).
 *
 * So each intent is its own field now, and the old flag keeps only its first
 * meaning: `force: true` from a page loaded before this change is `useFrameA`,
 * and it no longer gets past the title check.
 */
export interface SaveIntents {
  /** the frames disagree because frame B was misread — trust frame A */
  useFrameA: boolean;
  /** the frames disagree because the TEAM CHANGED — keep both readings */
  union: boolean;
  /** the title names a fighter the frames never showed — keep it as well */
  keepTitled: boolean;
  /** the title is WRONG for this side. `wholeSlot`: the slot was copied from
   *  another video, so even a title fighter the reading contains is refuted */
  titleWrong: { why: string; wholeSlot: boolean } | null;
}

export function readSaveIntents(body: Record<string, unknown>): SaveIntents {
  const tw = body.titleWrong;
  const twObj =
    tw && typeof tw === 'object' ? (tw as { why?: unknown; wholeSlot?: unknown }) : null;
  return {
    useFrameA: body.useFrameA === true || body.force === true,
    union: body.union === true,
    keepTitled: body.keepTitled === true,
    titleWrong:
      tw === true || twObj
        ? { why: String(twObj?.why ?? ''), wholeSlot: twObj?.wholeSlot === true }
        : null,
  };
}

export type TitleDecision =
  | {
      ok: true;
      characters: string[];
      fromTitle: string[];
      titleRefuted?: string[];
      teamChange?: true;
    }
  | { ok: false; titleMissing: string[] }
  | { ok: false; refused: string };

/**
 * THE TITLE HALF OF A SAVE. `titled` is the title's whole claim for this side
 * (`fromTitle ∪ titleRefuted`, so a re-save is judged against the title, never
 * against an earlier verdict), `characters` what the frames read.
 *
 *   nothing missing      → saved; fromTitle is the whole claim
 *   keepTitled           → the missing fighters are appended, as a team change
 *   titleWrong           → fromTitle keeps what the reading confirms; the rest
 *                          moves to titleRefuted. wholeSlot refutes all of it
 *   neither              → refused, naming what is missing
 *
 * "the title is wrong" without its evidence is refused outright: a refutation is
 * the one record that makes the title check pass without the title being met.
 */
export function decideTitle(
  titled: string[],
  characters: string[],
  intents: Pick<SaveIntents, 'keepTitled' | 'titleWrong'>,
): TitleDecision {
  if (intents.keepTitled && intents.titleWrong) {
    return {
      ok: false,
      refused: '"also keep" and "the title is wrong" contradict each other: send one',
    };
  }
  if (intents.titleWrong && !intents.titleWrong.why.trim()) {
    return {
      ok: false,
      refused:
        '"the title is wrong" needs its evidence: say what shows it (the HUD handles, the ' +
        'plate, the description, another upload of the same match)',
    };
  }
  const missing = titled.filter((t) => !characters.includes(t));
  if (intents.titleWrong) {
    const refuted = intents.titleWrong.wholeSlot ? titled : missing;
    if (!refuted.length) return { ok: true, characters, fromTitle: titled };
    return {
      ok: true,
      characters,
      fromTitle: titled.filter((t) => !refuted.includes(t)),
      titleRefuted: refuted,
    };
  }
  if (!missing.length) return { ok: true, characters, fromTitle: titled };
  if (intents.keepTitled) {
    return {
      ok: true,
      characters: [...characters, ...missing],
      fromTitle: titled,
      teamChange: true,
    };
  }
  return { ok: false, titleMissing: missing };
}

export type SaveDecision =
  | { ok: false; disagree: true; a: string[]; b: string[]; message: string }
  | { ok: false; titleMissing: string[]; message: string }
  | { ok: false; refused: string }
  | { ok: true; characters: string[]; provenance: Record<string, unknown> };

/**
 * A WHOLE BENCH-REVIEW SAVE, decided without touching a file: the frames
 * comparison, then the title. bench-review.post.ts only reads the inputs and
 * writes what this returns, which is what lets verify-gates control it.
 *
 * The two frames are compared as SETS ({point} + three assists): the icons
 * permute between cells as the point fighter changes.
 *
 * THREE DEFECTS OF THE OLD UNION PATH, fixed here (2026-10-14). It returned
 * before the title check, so "both — the team changed" skipped it entirely; a
 * plan to route it through the shared tail would instead have hit the frames
 * refusal (a union request sends no force), marked every union forced (its
 * frames differ by definition) and lost `teamChange`. So: a union skips ONLY the
 * frames refusal, is never `forced`, and always records `teamChange`.
 */
export function decideBenchSave(input: {
  points: [string | null, string | null];
  a: string[];
  b: string[];
  titled: string[];
  intents: SaveIntents;
  /** YYYY-MM-DD, UTC — stamped on a refutation */
  today: string;
}): SaveDecision {
  const { points, a, b, intents } = input;
  const membersOf = (point: string | null, rest: string[]) => [
    ...new Set([...(point ? [point] : []), ...rest]),
  ];
  const setA = membersOf(points[0], a).sort().join(',');
  const setB = membersOf(points[1], b).sort().join(',');
  const disagree = setA !== setB;
  const union = disagree && intents.union;

  if (disagree && !union && !intents.useFrameA) {
    return {
      ok: false,
      disagree: true,
      a: setA.split(','),
      b: setB.split(','),
      message: 'the two frames read different benches — resolve, or resend with useFrameA',
    };
  }

  // point first when known: they held the plate at the moment the frame was taken
  const read = union
    ? [...new Set([...membersOf(points[0], a), ...membersOf(points[1], b)])]
    : membersOf(points[0], a);

  const t = decideTitle(input.titled, read, intents);
  if (!t.ok) {
    if ('refused' in t) return t;
    return {
      ok: false,
      titleMissing: t.titleMissing,
      message:
        `the title names ${t.titleMissing.join(', ')} on this side, and the reading does not ` +
        'include them — check the attribution first; if it is right, either the team changed ' +
        '(keep both) or the title is wrong (say why)',
    };
  }
  const forced = disagree && !union;
  return {
    ok: true,
    characters: t.characters,
    provenance: {
      fromTitle: t.fromTitle,
      ...(t.titleRefuted
        ? {
            titleRefuted: t.titleRefuted,
            titleRefutedWhy: intents.titleWrong!.why.trim(),
            titleRefutedAt: input.today,
          }
        : {}),
      ...(union || t.teamChange ? { teamChange: true } : {}),
      ...(forced ? { forced: true } : {}),
      humanPicks: { a, b, forced },
    },
  };
}

/**
 * RELAXED SECOND PASS: the plate is an anchor, not a gatekeeper.
 *
 * The strict pass below requires two exact plate reads AND exactly one title match
 * to attribute a screen side to a record side. That is right when it works, and it
 * stopped working: of the 62 records still incomplete, every one carries a title
 * naming at most one fighter per side, so 26 side-slots matched BOTH record sides
 * and 16 matched neither, while another 40 had fewer than two exact reads. Zero
 * reached the page. The queue was not short of footage — all 62 already have
 * persisted reads — it was short of an ANCHOR.
 *
 * A person does not need one. The HUD draws each player's handle under their
 * nameplate and it survives the encode legibly — measured on two channels,
 * "Hikari" and "ROCK-MF" both plainly readable at 4x — so the reviewer can say
 * which side they are looking at. Where the plate also failed to name a point
 * fighter, they read the bust too: four picks instead of three.
 *
 * `needs` says which of those the page must ask for, so a side the plate CAN
 * attribute keeps its cheaper three-pick flow untouched.
 */
export function buildBenchList(): BenchItem[] {
  return buildBench().items;
}

/**
 * The worklist plus the queued records it could NOT offer because their footage
 * has never been read — no geometry in extracted.json, or no frames on disk.
 *
 * Without this the page could not tell "drained" from "not downloaded yet". The
 * cron adds ~12 title-only records a day and never downloads footage, so between
 * catchups the queue grows while the worklist stays empty. On 2026-10-03 the page
 * said "bench queue is empty 🎉" over 16 queued records (32 incomplete sides), all
 * uploaded after the last extract. Those records need `npm run data:catchup`, not
 * a reviewer, and the page should say that.
 */
export function buildBench(): { items: BenchItem[]; awaitingFootage: string[] } {
  const extracted = readJson<Record<string, Extracted>>('cache/tokon/extracted.json', {});
  const queue = readJson<{ id: string }[]>('data/bench-queue.json', []);
  const videos = readJson<
    {
      id: string;
      title: string;
      sides: { characters: string[]; handle: string; provenance: { fromTitle: string[] } }[];
    }[]
  >('data/videos.json', []);
  const byId = new Map(videos.map((v) => [v.id, v]));
  const queued = new Set(queue.map((q) => q.id));
  // THE BENCH QUEUE LISTS INCOMPLETE RECORDS, WHICH IS NOT THE SAME AS RECORDS
  // NEEDING WORK. A side can be complete and still fail `fromTitle ⊆ characters`,
  // and such a side is wrong rather than finished — but its record leaves the queue
  // the moment it fills up, so the tool that produced the error offered no way to
  // correct it.
  for (const v of videos) {
    if (v.sides.length !== 2) continue;
    if (v.sides.some(failsControl)) queued.add(v.id);
  }

  const out: BenchItem[] = [];
  const awaitingFootage: string[] = [];
  for (const id of [...queued].sort()) {
    const v = byId.get(id);
    const e = extracted[id];
    if (!v || v.sides.length !== 2) continue;
    if (!e?.geom || !existsSync(join(process.cwd(), 'cache/tokon/frames', id))) {
      awaitingFootage.push(id);
      continue;
    }

    const handles = v.sides.map((s) => s.handle) as [string, string];
    // A second where EITHER plate resolved is a second where the HUD was legible.
    // Preferring those matters for sides the plate could not read at all: their
    // frames are often mid-super, the wash that defeated the OCR also bleaches the
    // handle, and a reviewer would be handed the one frame least worth showing.
    const cleanSecs = [
      ...new Set([...e.left, ...e.right].filter((r) => r.id && r.dist === 0).map((r) => r.sec)),
    ].sort((a, b) => a - b);
    const anySecs = [...new Set([...e.left, ...e.right].map((r) => r.sec))].sort((a, b) => a - b);

    /**
     * THE FRAMES ON DISK ARE THE LAST FALLBACK, AND THE ONLY ONE THAT WORKS WHEN
     * THE PLATE READ NOTHING AT ALL.
     *
     * The two pools above both derive from `e.left`/`e.right` — the reader's own
     * rows. That degrades gracefully from "the OCR read a lot" to "the OCR read a
     * little", and then collapses at zero: no rows means no seconds, `pool.length
     * < 2` fires, and the side is never offered.
     *
     * Which is exactly backwards. "The plate resolved nothing" is the case a human
     * is MOST needed for, and it was the one case the worklist silently refused.
     * Measured when this was found: 19 records with zero read rows, 38 incomplete
     * sides unreachable, and 3,368 frames sitting on disk unused — every one of
     * them grabbed from a burst window the sampler had already chosen as
     * mid-match. The frames were never the problem.
     *
     * Filenames are the zero-padded second, so the directory IS the seconds list.
     * Read it only when the reader's pools cannot fill two slots; a directory
     * listing per record is not free, and for the ~85% of records with rows it
     * would be pure waste.
     */
    const framesDir = join(process.cwd(), 'cache/tokon/frames', id);
    const diskSecs = (): number[] => {
      try {
        return readdirSync(framesDir)
          .filter((f) => f.endsWith('.png'))
          .map((f) => Number(f.slice(0, -4)))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
      } catch {
        return [];
      }
    };
    const hudSecs = cleanSecs.length >= 2 ? cleanSecs : anySecs.length >= 2 ? anySecs : diskSecs();

    // ATTRIBUTION IS DEDUCIBLE FROM THE OTHER SIDE. A record has exactly two
    // players, so once the plate places one screen side the other follows by
    // elimination — no reading required, and no chance to get it wrong.
    //
    // Omitting this cost real work. On gT7bLwW8hK4 the plate read doctor-doom on the
    // LEFT, which fixes KING JON there and therefore SAIKKA on the right. The page
    // asked anyway; the same wrong answer came back four times, and every save
    // landed on the player who was already accounted for.
    const placed: Record<'L' | 'R', number | null> = { L: null, R: null };
    for (const sd of ['L', 'R'] as const) {
      const rs = (sd === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0);
      const own = v.sides
        .map((s, k) => ({ k, hit: rs.some((r) => s.provenance.fromTitle.includes(r.id!)) }))
        .filter((x) => x.hit);
      placed[sd] = own.length === 1 ? own[0]!.k : null;
    }
    if (placed.L === null && placed.R !== null) placed.L = 1 - placed.R;
    else if (placed.R === null && placed.L !== null) placed.R = 1 - placed.L;

    /**
     * BOTH SCREEN SIDES CANNOT BE THE SAME PLAYER, so if they both resolve to one
     * record side the attribution is wrong and neither answer is usable.
     *
     * The elimination step above only rescues the case where exactly ONE side is
     * unknown. Nothing caught the collision, and its consequence was silent: both
     * screen sides carry the index of a record side that is usually already
     * complete, `settled()` skips both, and the OTHER side — the incomplete one,
     * the whole reason the record is queued — is never offered to anybody.
     *
     * On L_s3lYOuR3k the right plate read spider-man, which is the LEFT player's
     * title fighter, so both sides placed onto record side 0 and HADO's bench was
     * unreachable behind 72 frames and 68 clean reads. Rare (1 of 312 records with
     * reads) and not necessarily even an OCR error: on a 21-fighter roster two
     * players fielding Spider-Man is ordinary, which is exactly why this cannot be
     * resolved by picking one.
     *
     * So drop both to null and let the page ask. That is the same verdict
     * alignBench reaches on an ambiguous bench: refuse and ask, never assume. A
     * question costs a reviewer one extra click; a guess costs the side.
     */
    if (placed.L !== null && placed.L === placed.R) {
      placed.L = null;
      placed.R = null;
    }

    for (const side of ['L', 'R'] as const) {
      const reads = (side === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0);
      // ATTRIBUTION PREFERS THE TITLE-KNOWN FIGHTER, never title order — one
      // uploader reverses its second title slot on 27 of 34 videos, so assuming
      // order would compound one error with another.
      const sideIndex = placed[side];
      const settled = (s: TitleSide) => s.characters.length >= 4 && !failsControl(s);
      if (sideIndex !== null && settled(v.sides[sideIndex]!)) continue;
      if (sideIndex === null && v.sides.every(settled)) continue;
      const recheck = sideIndex !== null && failsControl(v.sides[sideIndex]!);

      // two frames as far apart as available, so they are different bursts. Fall
      // back to any HUD frame when the plate resolved nothing: a person can read a
      // cluster the OCR could not. `hudSecs` ends at the frames directory itself,
      // so "the plate resolved nothing" still yields frames rather than silence.
      const pool = reads.length >= 2 ? reads.map((r) => r.sec) : hudSecs;
      if (pool.length < 2) continue;
      const firstSec = pool[0]!;
      const lastSec =
        [...pool].reverse().find((sec) => sec - firstSec > 30) ?? pool[pool.length - 1]!;
      if (lastSec === firstSec) continue;
      const secs = [firstSec, lastSec] as [number, number];
      if (
        !secs.every((sec) =>
          existsSync(
            join(process.cwd(), 'cache/tokon/frames', id, `${String(sec).padStart(6, '0')}.png`),
          ),
        )
      ) {
        continue;
      }
      const pointAt = (sec: number): string | null =>
        (side === 'L' ? e.left : e.right).find((r) => r.sec === sec && r.dist === 0)?.id ?? null;
      const points: [string | null, string | null] = [pointAt(secs[0]), pointAt(secs[1])];
      out.push({
        video: id,
        sideIndex,
        side,
        secs,
        allSecs: anySecs,
        points,
        known: sideIndex === null ? [] : v.sides[sideIndex]!.characters,
        recheck,
        handles,
        needs: { side: sideIndex === null, point: points[0] === null || points[1] === null },
        title: v.title,
        opposite: [
          ...new Set(
            (side === 'L' ? e.right : e.left).filter((r) => r.id && r.dist === 0).map((r) => r.id!),
          ),
        ],
      });
    }
  }
  return { items: out, awaitingFootage };
}
