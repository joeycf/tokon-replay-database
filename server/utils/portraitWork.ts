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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
      const frame = join(process.cwd(), 'cache/tokon/frames', v.id, `${String(r.sec).padStart(6, '0')}.png`);
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
    (a, b) => rarity(a) - rarity(b) || a.video.localeCompare(b.video) || a.side.localeCompare(b.side),
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
  const extracted = readJson<Record<string, Extracted>>('cache/tokon/extracted.json', {});
  const queue = readJson<{ id: string }[]>('data/bench-queue.json', []);
  const videos = readJson<
    {
      id: string;
      sides: { characters: string[]; handle: string; provenance: { fromTitle: string[] } }[];
    }[]
  >('data/videos.json', []);
  const byId = new Map(videos.map((v) => [v.id, v]));
  const queued = new Set(queue.map((q) => q.id));

  const out: BenchItem[] = [];
  for (const id of [...queued].sort()) {
    const v = byId.get(id);
    const e = extracted[id];
    if (!v || !e?.geom || v.sides.length !== 2) continue;
    if (!existsSync(join(process.cwd(), 'cache/tokon/frames', id))) continue;

    const handles = v.sides.map((s) => s.handle) as [string, string];
    // A second where EITHER plate resolved is a second where the HUD was legible.
    // Preferring those matters for sides the plate could not read at all: their
    // frames are often mid-super, the wash that defeated the OCR also bleaches the
    // handle, and a reviewer would be handed the one frame least worth showing.
    const cleanSecs = [...new Set([...e.left, ...e.right].filter((r) => r.id && r.dist === 0).map((r) => r.sec))].sort(
      (a, b) => a - b,
    );
    const anySecs = [...new Set([...e.left, ...e.right].map((r) => r.sec))].sort((a, b) => a - b);
    const hudSecs = cleanSecs.length >= 2 ? cleanSecs : anySecs;

    for (const side of ['L', 'R'] as const) {
      const reads = (side === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0);
      // ATTRIBUTION PREFERS THE TITLE-KNOWN FIGHTER, never title order — one
      // uploader reverses its second title slot on 27 of 34 videos, so assuming
      // order would compound one error with another.
      const owning = v.sides
        .map((s, k) => ({ k, hit: reads.some((r) => s.provenance.fromTitle.includes(r.id!)) }))
        .filter((x) => x.hit);
      const sideIndex = owning.length === 1 ? owning[0]!.k : null;
      // a side the plate CAN place, and which is already done, is not work
      if (sideIndex !== null && v.sides[sideIndex]!.characters.length >= 4) continue;
      // when it cannot place the side, both of the record's sides must still have
      // something missing, or there is nothing here to fill
      if (sideIndex === null && v.sides.every((s) => s.characters.length >= 4)) continue;

      // two frames as far apart as available, so they are different bursts. Fall
      // back to any HUD frame when the plate resolved nothing: a person can read a
      // cluster the OCR could not.
      const pool = reads.length >= 2 ? reads.map((r) => r.sec) : hudSecs;
      if (pool.length < 2) continue;
      const firstSec = pool[0]!;
      const lastSec = [...pool].reverse().find((sec) => sec - firstSec > 30) ?? pool[pool.length - 1]!;
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
        points,
        known: sideIndex === null ? [] : v.sides[sideIndex]!.characters,
        handles,
        needs: { side: sideIndex === null, point: points[0] === null || points[1] === null },
      });
    }
  }
  return out;
}
