/**
 * Read one video's nameplates: frames → geometry → plates → per-frame reads.
 *
 * The orchestration only. The primitives it composes live in hud-read.ts and the
 * matcher in roster.ts, so the spike and the driver read footage identically —
 * a spike that measures a different reader from the one that ships measures
 * nothing.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { createWorker } from 'tesseract.js';

import { CACHE, framesOf, grabBursts, pruneClips } from './hud-frames';
import {
  grey,
  measure,
  platesOf,
  prep,
  type Box,
  type FrameRead,
  type PlateGeom,
} from './hud-read';
import type { PlateRoster } from './roster';

type Worker = Awaited<ReturnType<typeof createWorker>>;

/**
 * The preprocessing variants actually run per plate.
 *
 * TRIMMED BY MEASUREMENT, not by taste. The probe ran five tone treatments × two
 * polarities; scoring every subset against 1176 persisted reads
 * (scripts/spike/reads-report.ts) puts three of them at 85.5% against the full
 * ten's 87.4% — within 2pp for 3.3× less work. Ten variants put a full-corpus
 * pass around five hours and the trim brings it inside two, which is the
 * difference between a sampler that can afford 72 frames a video and one that
 * cannot.
 *
 * RE-SELECTED AFTER THE END-TRIM LANDED, and the answer moved: scored against
 * whole-string matching the winning subset was four variants of a different mix.
 * A subset chosen for one matcher is not the subset for another, so this list is
 * downstream of roster.ts and gets re-derived whenever that changes.
 *
 * BOTH POLARITIES SURVIVE, which is the part worth keeping. The sibling negates
 * unconditionally because its glyphs are near-white on dark art; Tōkon's are a
 * mid-dark fill inside a bright outline, and inheriting that `negate` would have
 * silently halved the ensemble.
 */
export const VARIANTS: { t: number; neg: boolean }[] = [
  { t: 0, neg: false }, // normalise, as-is
  { t: 150, neg: true },
  { t: 175, neg: false },
];

export interface VideoRead {
  id: string;
  /** per-frame reads for the screen-LEFT plate, timestamp order */
  left: FrameRead[];
  /** per-frame reads for the screen-RIGHT plate, timestamp order */
  right: FrameRead[];
  /** frames that carried a HUD at all */
  hud: number;
  /** frames cut and inspected */
  frames: number;
  geom: PlateGeom | null;
}

/** Which cached frames carry a nameplate, with the per-video median geometry.
 *
 *  A frame showing a K.O. card, a round banner or a replay cut has no nameplate
 *  in it. Asking a reader to read one and scoring the silence as a miss measures
 *  the SAMPLER, not the reader — an earlier probe did exactly that and reported
 *  38% where the plates it actually saw were coming back exact. */
export async function hudFramesOf(
  files: string[],
): Promise<{ hud: { file: string; sec: number }[]; geom: PlateGeom | null }> {
  const rows: { file: string; sec: number; y0: number; y1: number; lx: number; rx: number }[] = [];
  for (const f of files) {
    const sec = Number(f.split('/').pop()!.replace('.png', ''));
    const { d, W, H } = await grey(f);
    const m = measure(d, W, H);
    if (!m.hud) continue;
    rows.push({ file: f, sec, y0: m.band!.y0, y1: m.band!.y1, lx: m.left!.x0, rx: m.right!.x1 });
  }
  if (!rows.length) return { hud: [], geom: null };
  const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  return {
    hud: rows.map((r) => ({ file: r.file, sec: r.sec })),
    geom: {
      bandY0: med(rows.map((r) => r.y0)),
      bandY1: med(rows.map((r) => r.y1)),
      leftX0: med(rows.map((r) => r.lx)),
      rightX1: med(rows.map((r) => r.rx)),
    },
  };
}

/** One plate, through the ensemble, resolved against the roster. */
async function readPlate(
  worker: Worker,
  file: string,
  box: Box,
  sec: number,
  roster: PlateRoster,
): Promise<FrameRead> {
  const texts: string[] = [];
  for (const v of VARIANTS) {
    const { data } = await worker.recognize(await prep(file, box, v.t, v.neg));
    const t = data.text.trim();
    if (t) texts.push(t);
  }
  let best: { id: string; dist: number; margin: number } | null = null;
  for (const t of texts) {
    const m = roster.match(t);
    // prefer the closer read; break ties on the larger margin, which is the
    // less ambiguous of two equally-close answers
    if (m && (!best || m.dist < best.dist || (m.dist === best.dist && m.margin > best.margin))) {
      best = m;
    }
  }
  if (!best) return { sec, id: null, dist: 0, margin: 0, votes: 0, of: texts.length };
  const votes = texts.filter((t) => roster.match(t)?.id === best.id).length;
  return { sec, id: best.id, dist: best.dist, margin: best.margin, votes, of: texts.length };
}

/** Read every cached frame of a video. Does NOT download — call `grabBursts`
 *  first, or `readVideo` which does both. */
export async function readCached(
  worker: Worker,
  id: string,
  roster: PlateRoster,
): Promise<VideoRead> {
  const files = framesOf(id);
  const { hud, geom } = await hudFramesOf(files);
  if (!geom) return { id, left: [], right: [], hud: 0, frames: files.length, geom: null };
  const boxes = platesOf(geom, 'symmetric');
  const left: FrameRead[] = [];
  const right: FrameRead[] = [];
  for (const { file, sec } of hud) {
    left.push(await readPlate(worker, file, boxes.left, sec, roster));
    right.push(await readPlate(worker, file, boxes.right, sec, roster));
  }
  return { id, left, right, hud: hud.length, frames: files.length, geom };
}

/** Grab the burst plan for a video and read it. Additive: a second call with
 *  more windows re-reads the union of old and new frames. */
export async function readVideo(
  worker: Worker,
  id: string,
  durationSec: number,
  roster: PlateRoster,
  windows = 12,
): Promise<VideoRead> {
  await grabBursts(id, durationSec, windows);
  pruneClips(id);
  return readCached(worker, id, roster);
}

/** True when this id has any cached frames — lets a scoring pass run offline. */
export const isCached = (id: string): boolean => existsSync(join(CACHE, 'frames', id));
