/**
 * CROP SWEEP — per-channel geometry, measured, before any reader exists.
 *
 * Every prior extraction on this platform ran against ONE capture pipeline. This
 * corpus spans FIVE uploader channels with five capture paths, so "the HUD sits
 * at a fixed fraction" holds PER SOURCE until measured otherwise. If the channels
 * disagree, the crop config keys by ChannelKey; if they agree, that is a
 * measurement to state with numbers, not an assumption to inherit.
 *
 * Everything here is OCR-INDEPENDENT on purpose. Whether tesseract can read this
 * face is the next question, and geometry derived from a reader that might not
 * work would be geometry built on sand.
 *
 * WHAT IT MEASURES, per video:
 *   · letterboxing — a padded frame shifts every fraction
 *   · the nameplate band and both ink runs, via a local-range filter: the glyphs
 *     are a heavy condensed face with a hard outline, so they sustain high local
 *     contrast in a way live art does not. Raw brightness does NOT separate them
 *     (measured: 1.3% bright pixels inside the plate vs 0.9% just above it).
 *   · the right plate is RIGHT-ALIGNED, so it is reported as an xEnd anchor plus
 *     a width — a left-anchored box clips the first glyph off a long name.
 *   · UI language — Latin vs katakana glyph run, per channel
 *   · round-1 start — see below
 *   · distinct nameplate images per side, by perceptual hash
 *
 * TWO CONCLUSIONS THIS IS ALLOWED TO DRAW, AND TWO IT IS NOT:
 *
 * 1. ROUND-1 START. If round 1 begins at t≈0 the uploader TRIMMED the pre-match
 *    screens. Then "no text list of all eight" is a fact about THIS CHANNEL'S
 *    EDITING, and must be reported as "not present in these uploads" — never as
 *    "the game has no such screen". An absence caused by trimming is not
 *    evidence about the UI.
 *
 * 2. DISTINCT FIGHTERS PER SIDE. Tag-cycling is the basis for reading the
 *    nameplate as the primary source, and its blind spot is exact: a fighter who
 *    never enters never appears there. Counting DISTINCT NAMEPLATE IMAGES per
 *    side (perceptual hash, no reading required) bounds how often that case
 *    occurs — which is the number that decides whether a portrait tier is worth
 *    building at all. A side showing 4 distinct plates needs no portrait tier;
 *    a side showing 1 needs three fighters from somewhere else.
 *
 * Run: npx tsx scripts/spike/sweep.ts [--per-channel N] [--measure-only]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { CACHE, framesOf, grabWindow, pruneClips, samplePlan } from '../hud-frames';
import { CHANNELS } from '../channels';
import type { ChannelKey, MatchVideo } from '../../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const PER_CHANNEL = Number(argv[argv.indexOf('--per-channel') + 1]) || 2;
const MEASURE_ONLY = argv.includes('--measure-only');

// ── the local-range filter ──────────────────────────────────────────────────
const RANGE_MIN = 70; // a glyph edge sustains this; live art rarely does
const ROW_INK_MIN = 0.1; // fraction of columns in a row that must be edge
// The row window is narrow and left-anchored on purpose. Too wide and a SHORT
// name falls under the threshold: "LOKI" is a third the width of "BLACK
// PANTHER", so over a wide window its edge density reads as background and the
// detector drops to the player-handle row below — which looks exactly like
// framing variance and is not.
const ROW_X0 = 0.1;
const ROW_X1 = 0.26;
const COL_INK_MIN = 0.22; // fraction of rows in a column that must be edge
const COL_GAP = 10; // px gap tolerated inside one run (inter-word space)

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
interface FrameMeasure {
  hud: boolean;
  band?: { y0: number; y1: number };
  left?: Box;
  right?: Box;
  letterbox: { top: number; bottom: number };
  hashL?: string;
  hashR?: string;
}

async function grey(file: string) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { d: data, W: info.width, H: info.height };
}

/** Black bars top/bottom, as frame fractions. A padded frame shifts everything. */
function letterbox(d: Buffer, W: number, H: number) {
  const rowDark = (y: number) => {
    let s = 0;
    for (let x = 0; x < W; x += 4) s += d[y * W + x]!;
    return s / (W / 4);
  };
  let top = 0;
  while (top < H * 0.2 && rowDark(top) < 16) top++;
  let bot = 0;
  while (bot < H * 0.2 && rowDark(H - 1 - bot) < 16) bot++;
  return { top: top / H, bottom: bot / H };
}

function measure(d: Buffer, W: number, H: number): FrameMeasure {
  const lb = letterbox(d, W, H);
  const L = (x: number, y: number) => d[y * W + x]!;
  const rng = (x: number, y: number) => {
    let mn = 255;
    let mx = 0;
    for (let k = -2; k <= 2; k++) {
      const v = L(Math.min(W - 1, Math.max(0, x + k)), y);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return mx - mn;
  };

  // Rows: search right of the bench-portrait cluster (which lives at x<0.10 and
  // is dense with edges) and offset by any letterbox.
  const y0 = Math.round(H * (lb.top + 0.005));
  const y1 = Math.round(H * (lb.top + 0.14));
  const rows: number[] = [];
  for (let y = y0; y < y1; y++) {
    let b = 0;
    let t = 0;
    for (let x = Math.round(W * ROW_X0); x < W * ROW_X1; x++) {
      t++;
      if (rng(x, y) > RANGE_MIN) b++;
    }
    rows.push(b / t);
  }
  // TOPMOST qualifying band, not the densest. The nameplate is always the first
  // text below the frame top; the densest band is the player-handle row plus the
  // health-bar segments beneath it, which wins whenever the fighter's name is
  // short ("LOKI" is half the width of "BLACK PANTHER"). Picking by density
  // silently measured the wrong row on one channel and read as framing variance.
  let best: [number, number] | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]! < ROW_INK_MIN) continue;
    let j = i;
    while (j + 1 < rows.length && rows[j + 1]! >= ROW_INK_MIN) j++;
    if (j - i >= 6) {
      best = [i, j];
      break;
    }
    i = j;
  }
  if (!best || best[1] - best[0] < 8) return { hud: false, letterbox: lb };
  const by0 = y0 + best[0];
  const by1 = y0 + best[1];

  const run = (xa: number, xb: number) => {
    const cols: [number, number][] = [];
    for (let x = Math.round(W * xa); x < W * xb; x++) {
      let b = 0;
      for (let y = by0; y <= by1; y++) if (rng(x, y) > RANGE_MIN) b++;
      cols.push([x, b / (by1 - by0 + 1)]);
    }
    const runs: [number, number][] = [];
    let cur: [number, number] | null = null;
    let gap = 0;
    for (const [x, f] of cols) {
      if (f >= COL_INK_MIN) {
        if (!cur) cur = [x, x];
        else cur[1] = x;
        gap = 0;
      } else if (cur && ++gap > COL_GAP) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
    if (!runs.length) return null;
    return runs.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0]!;
  };

  const l = run(0.02, 0.46);
  const r = run(0.54, 0.99);
  if (!l || !r) return { hud: false, letterbox: lb };
  return {
    hud: true,
    band: { y0: by0 / H, y1: by1 / H },
    left: { x0: l[0] / W, x1: l[1] / W, y0: by0 / H, y1: by1 / H },
    right: { x0: r[0] / W, x1: r[1] / W, y0: by0 / H, y1: by1 / H },
    letterbox: lb,
  };
}

/**
 * 8x8 hash of the crop's EDGE MASK — distinct plates without reading them.
 *
 * Hashing greyscale directly does not work here: the plate is drawn over live
 * gameplay, so the hash tracks the background and reports ~20 distinct images
 * for a side that can field at most five fighters. The glyph EDGES are the part
 * that belongs to the name, so the mask is what gets hashed.
 */
async function dhash(file: string, b: Box): Promise<string> {
  const m = await sharp(file).metadata();
  const W = m.width!;
  const H = m.height!;
  const cw = Math.max(8, Math.round(W * (b.x1 - b.x0)));
  const chh = Math.max(8, Math.round(H * (b.y1 - b.y0)));
  const { data, info } = await sharp(file)
    .extract({
      left: Math.max(0, Math.round(W * b.x0)),
      top: Math.max(0, Math.round(H * b.y0)),
      width: cw,
      height: chh,
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cW = info.width;
  const cH = info.height;
  const at = (x: number, y: number) => data[y * cW + x]!;
  // edge mask, then area-average into an 8x8 grid
  const cells = new Float64Array(64);
  const counts = new Float64Array(64);
  for (let y = 1; y < cH - 1; y++) {
    for (let x = 2; x < cW - 2; x++) {
      let mn = 255;
      let mx = 0;
      for (let k = -2; k <= 2; k++) {
        const v = at(x + k, y);
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const gy = Math.min(7, Math.floor((y / cH) * 8));
      const gx = Math.min(7, Math.floor((x / cW) * 8));
      cells[gy * 8 + gx]! += mx - mn > RANGE_MIN ? 1 : 0;
      counts[gy * 8 + gx]! += 1;
    }
  }
  const dens = Array.from(cells, (v, i) => (counts[i] ? v / counts[i]! : 0));
  const mean = dens.reduce((a, b2) => a + b2, 0) / 64;
  return BigInt('0b' + dens.map((v) => (v > mean ? '1' : '0')).join('')).toString(36);
}

const ham = (a: string, b: string) => {
  const x =
    BigInt('0x' + Buffer.from(a).toString('hex')) ^ BigInt('0x' + Buffer.from(b).toString('hex'));
  return x.toString(2).split('1').length - 1;
};

/**
 * Cluster plate hashes; distinct clusters ≈ distinct fighters seen on that side.
 *
 * The threshold is 18 of 64 bits because that is the middle of a measured
 * PLATEAU, not a tuned peak. Swept on a full set: 8→13 clusters, 12→10, 16→4,
 * 20→4, 24→3. Sixteen and twenty agree, and they agree on four — which is
 * exactly a full side. A knife-edge threshold would mean the signal was noise;
 * a plateau two steps wide means the clusters are real.
 */
const HAMMING_MAX = 18;
function distinct(hashes: string[]): number {
  const reps: bigint[] = [];
  for (const h of hashes) {
    const v = BigInt(parseInt(h, 36));
    if (!reps.some((r) => (v ^ r).toString(2).split('1').length - 1 <= HAMMING_MAX)) reps.push(v);
  }
  return reps.length;
}

/** Available source formats — answers "1080p or 720p uploads" without downloading. */
function sourceRes(id: string): string {
  const r = spawnSync(
    'yt-dlp',
    [
      '--cookies',
      join(ROOT, 'secrets/yt-cookies.txt'),
      '--js-runtimes',
      'node',
      '-F',
      `https://www.youtube.com/watch?v=${id}`,
    ],
    {
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  const heights = [...(r.stdout ?? '').matchAll(/\b(\d{3,4})x(\d{3,4})\b/g)].map((m) =>
    Number(m[2]),
  );
  return heights.length ? `${Math.max(...heights)}p` : '?';
}

// ── main ────────────────────────────────────────────────────────────────────
const videos = JSON.parse(readFileSync(join(ROOT, 'data/videos.json'), 'utf8')) as MatchVideo[];
const byChannel = new Map<ChannelKey, MatchVideo[]>();
for (const v of videos) byChannel.set(v.intake, [...(byChannel.get(v.intake) ?? []), v]);

const picks: MatchVideo[] = [];
for (const ch of CHANNELS) {
  const list = (byChannel.get(ch.id) ?? []).sort((a, b) => b.durationSec - a.durationSec);
  picks.push(...list.slice(0, PER_CHANNEL));
}

console.log(`Crop sweep — ${picks.length} VODs across ${CHANNELS.length} channels\n`);
const OUT = join(CACHE, 'sweep.json');
mkdirSync(CACHE, { recursive: true });
const results: Record<string, unknown>[] = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>[])
  : [];
// Only a measurement that actually SAW a HUD counts as done. A --measure-only
// pass on an uncached video records zeros, and keying resume on the id alone
// would then skip its download forever.
const done = new Set(results.filter((r) => (r.hudFrames as number) > 0).map((r) => r.id as string));

for (const [i, v] of picks.entries()) {
  if (done.has(v.id)) {
    console.log(`[${i + 1}/${picks.length}] ${v.id} (${v.intake}) — cached`);
    continue;
  }
  console.log(
    `[${i + 1}/${picks.length}] ${v.id} (${v.intake}) ${Math.round(v.durationSec / 60)}min`,
  );

  if (!MEASURE_ONLY) {
    // dense start window (round-1 detection + any pre-match screen), then the sweep
    await grabWindow(v.id, 0, 60, 0.5);
    for (const s of samplePlan(v.durationSec, 8)) await grabWindow(v.id, s, 1, 1);
    pruneClips(v.id);
  }

  const frames = framesOf(v.id);
  const measures: { sec: number; m: FrameMeasure }[] = [];
  for (const f of frames) {
    const sec = Number(f.split('/').pop()!.replace('.png', ''));
    const { d, W, H } = await grey(f);
    measures.push({ sec, m: measure(d, W, H) });
  }
  const hudFrames = measures.filter((x) => x.m.hud);

  // round 1 start: earliest second in the dense window carrying a HUD
  const early = hudFrames.filter((x) => x.sec <= 60).map((x) => x.sec);
  const roundOne = early.length ? Math.min(...early) : null;

  const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

  // Distinct plates per side, hashed through a FIXED per-video box.
  // Hashing each frame's own measured box does not cluster: the box is
  // re-measured per frame and its width tracks the NAME, so the crop geometry
  // changes with the content it is trying to identify and every frame hashes
  // differently. One box per video, wide enough for the longest name, keeps the
  // only thing varying the glyphs themselves.
  const PLATE_W = 0.135;
  const by0 = med(hudFrames.map((x) => x.m.band!.y0));
  const by1 = med(hudFrames.map((x) => x.m.band!.y1));
  const lx0 = med(hudFrames.map((x) => x.m.left!.x0));
  const rx1 = med(hudFrames.map((x) => x.m.right!.x1));
  const boxL = { x0: lx0, x1: lx0 + PLATE_W, y0: by0, y1: by1 };
  const boxR = { x0: rx1 - PLATE_W, x1: rx1, y0: by0, y1: by1 };
  const hl: string[] = [];
  const hr: string[] = [];
  for (const { sec } of hudFrames) {
    const f = frames.find((p) => p.endsWith(`${String(sec).padStart(6, '0')}.png`))!;
    hl.push(await dhash(f, boxL));
    hr.push(await dhash(f, boxR));
  }
  const rec = {
    id: v.id,
    channel: v.intake,
    durationSec: v.durationSec,
    sourceRes: MEASURE_ONLY ? '?' : sourceRes(v.id),
    frames: frames.length,
    hudFrames: hudFrames.length,
    roundOneSec: roundOne,
    letterboxTop: med(measures.map((x) => x.m.letterbox.top)),
    bandY0: med(hudFrames.map((x) => x.m.band!.y0)),
    bandY1: med(hudFrames.map((x) => x.m.band!.y1)),
    leftX0: med(hudFrames.map((x) => x.m.left!.x0)),
    leftX1: med(hudFrames.map((x) => x.m.left!.x1)),
    rightX0: med(hudFrames.map((x) => x.m.right!.x0)),
    rightX1: med(hudFrames.map((x) => x.m.right!.x1)),
    // The seconds that actually carry a HUD. Scoring a reader over frames
    // without a nameplate measures the sampler, not the reader — a K.O. card or
    // a round banner has nothing to read and counting it as a miss hides the
    // reader's real behaviour.
    hudSecs: hudFrames.map((x) => x.sec),
    distinctLeft: distinct(hl),
    distinctRight: distinct(hr),
  };
  results.push(rec);
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(
    `   ${rec.hudFrames}/${rec.frames} HUD · band y ${rec.bandY0.toFixed(3)}-${rec.bandY1.toFixed(3)} · ` +
      `L x ${rec.leftX0.toFixed(3)}-${rec.leftX1.toFixed(3)} · R x ${rec.rightX0.toFixed(3)}-${rec.rightX1.toFixed(3)} · ` +
      `round1 ${roundOne ?? '—'}s · distinct ${rec.distinctLeft}/${rec.distinctRight}`,
  );
}

console.log(`\n✔ ${results.length} videos measured → ${OUT}`);
