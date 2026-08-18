/**
 * Step 0 recon for the PORTRAIT TIER: what is actually in the HUD's corner
 * clusters, measured from frames already on disk. No downloads.
 *
 * WHY THIS TIER EXISTS. The nameplate names who took POINT; descriptions name
 * the team SELECTED. 36% of bench slots never appear on a plate at any sampling
 * rate, and saturation says those sides ran out of things to find rather than
 * being starved — a fighter who never tags in has no nameplate to read, so more
 * frames cannot help. The corner clusters are drawn every HUD frame and show the
 * team regardless of point time.
 *
 * `--dump` writes upscaled corner crops to cache/tokon/portrait-recon/ so the
 * geometry can be DERIVED FROM THE PICTURES rather than guessed at. Every silent
 * defect in this project has been caught by opening the file and looking at it.
 *
 * Run: npx tsx scripts/spike/portrait.ts [--dump]
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp, { type OverlayOptions } from 'sharp';

import { CACHE } from '../hud-frames';
import { hamming, type Box, type FrameRead, type PlateGeom } from '../hud-read';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(CACHE, 'portrait-recon');
const DUMP = process.argv.includes('--dump');

interface Extracted {
  id: string;
  left: FrameRead[];
  right: FrameRead[];
  hud: number;
  frames: number;
  geom: PlateGeom | null;
}
/** `--store <file>` reads a snapshot instead of the live store, so a backfill
 *  writing `extracted.json` cannot hand this spike a half-written JSON. */
const STORE_ARG = process.argv.indexOf('--store');
const STORE = STORE_ARG > 0 ? process.argv[STORE_ARG + 1]! : join(CACHE, 'extracted.json');
const extracted = JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, Extracted>;

interface SideRec {
  characters: string[];
  provenance: { fromTitle: string[]; fromDescription?: string[] };
}
const videos = JSON.parse(readFileSync(join(ROOT, 'data/videos.json'), 'utf8')) as {
  id: string;
  intake: string;
  sides: SideRec[];
}[];
const channelOf = new Map(videos.map((v) => [v.id, v.intake]));

/**
 * TRUTH IS `fromDescription.length === 4`, NOT `characters.length === 4`.
 *
 * `scripts/spike/accuracy.ts` uses the latter, and that predicate went CIRCULAR the
 * moment the footage tier started completing sides: it now admits records the
 * reader itself filled in, so scoring against it grades a reader partly against its
 * own output. Measured — the set has grown 41 -> 55 records and 4 of those 55 reach
 * four only via footage. Descriptions are written by uploaders and are independent
 * of every pixel, which is the property that makes them truth.
 */
const truthBenches = new Map<string, [string[], string[]]>();
for (const v of videos) {
  if (v.sides.length !== 2) continue;
  const d0 = v.sides[0]!.provenance.fromDescription ?? [];
  const d1 = v.sides[1]!.provenance.fromDescription ?? [];
  if (d0.length === 4 && d1.length === 4) truthBenches.set(v.id, [d0, d1]);
}

const frameFile = (id: string, sec: number): string =>
  join(CACHE, 'frames', id, `${String(sec).padStart(6, '0')}.png`);

/** One video per channel, at a frame whose plate actually resolved a fighter —
 *  so the picture can be checked against a known answer. */
function picks(): { ch: string; id: string; sec: number; plate: string }[] {
  const out: { ch: string; id: string; sec: number; plate: string }[] = [];
  const seen = new Set<string>();
  for (const [id, e] of Object.entries(extracted)) {
    const ch = channelOf.get(id) ?? '?';
    if (seen.has(ch) || !e.geom) continue;
    const hit = e.left.find((r) => r.id);
    if (!hit?.id) continue;
    seen.add(ch);
    out.push({ ch, id, sec: hit.sec, plate: hit.id });
  }
  return out;
}

/**
 * THE HUD IS FIXED AND THE GAMEPLAY BEHIND IT IS NOT — so average it out.
 *
 * Border-finding on a single frame does not work: the corner sits over live art
 * (pink crystal, red sky, a white cityscape), the edge mask fires on all of it,
 * and the lattice peaks came back different on every video. Measured, not
 * assumed: `--geom` found u=89/v=94 on three videos and noise on the other two.
 *
 * Averaging hundreds of frames from DIFFERENT matches fixes it by construction.
 * Anything drawn at a fixed screen position survives the mean; anything that
 * moves — the stage, the fighters, the point-fighter bust, which is a different
 * character every video — blurs to flat grey. What is left is the chrome.
 */
async function meanCorner(
  side: 'L' | 'R',
  limit = 8,
): Promise<{ mean: Float64Array; edge: Float64Array; w: number; h: number; n: number }> {
  const WIN =
    side === 'L' ? { x0: 0.0, x1: 0.14 } : { x0: 0.86, x1: 1.0 };
  let w = 0;
  let h = 0;
  let mean: Float64Array | null = null;
  let edge: Float64Array | null = null;
  let n = 0;
  for (const [id, e] of Object.entries(extracted)) {
    if (!e.geom) continue;
    const secs = (side === 'L' ? e.left : e.right)
      .filter((r) => r.id)
      .slice(0, limit)
      .map((r) => r.sec);
    for (const sec of secs) {
      const f = frameFile(id, sec);
      let raw;
      try {
        raw = await sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true });
      } catch {
        continue;
      }
      const { data, info } = raw;
      const W = info.width;
      const H = info.height;
      const X0 = Math.round(W * WIN.x0);
      const X1 = Math.round(W * WIN.x1);
      const Y1 = Math.round(H * 0.21);
      if (!mean) {
        w = X1 - X0;
        h = Y1;
        mean = new Float64Array(w * h);
        edge = new Float64Array(w * h);
      }
      if (X1 - X0 !== w || Y1 !== h) continue; // a differently-sized upload
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const px = data[y * W + (X0 + x)]!;
          mean[y * w + x]! += px;
          let mn = 255;
          let mx = 0;
          for (let k = -2; k <= 2; k++) {
            const v = data[y * W + Math.min(W - 1, Math.max(0, X0 + x + k))]!;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
          edge![y * w + x]! += mx - mn > 70 ? 1 : 0;
        }
      }
      n++;
    }
  }
  return { mean: mean!, edge: edge!, w, h, n };
}

if (process.argv.includes('--mean')) {
  mkdirSync(OUT, { recursive: true });
  for (const side of ['L', 'R'] as const) {
    const { mean, edge, w, h, n } = await meanCorner(side);
    for (const [name, buf] of [
      ['mean', mean],
      ['edge', edge],
    ] as [string, Float64Array][]) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of buf) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const px = Buffer.alloc(w * h);
      for (let i = 0; i < buf.length; i++) {
        px[i] = Math.round(((buf[i]! - lo) / (hi - lo || 1)) * 255);
      }
      await sharp(px, { raw: { width: w, height: h, channels: 1 } })
        .resize({ width: w * 6, kernel: 'nearest' })
        .png()
        .toFile(join(OUT, `${name}-${side}.png`));
    }
    console.log(
      `  ${side}: averaged ${n} frames over ${w}x${h} px → mean-${side}.png, edge-${side}.png`,
    );
  }
  console.log('');
}

/** Diagonal accumulators over an already-averaged corner. Run on ONE frame the
 *  peaks are noise (measured: three of five videos agreed, two returned
 *  nothing); run on the mean of 384 frames and the lattice is unambiguous. */
function latticeOf(buf: Float64Array, w: number, h: number) {
  const uAcc = new Float64Array(w + h);
  const vAcc = new Float64Array(w + h);
  const uN = new Float64Array(w + h);
  const vN = new Float64Array(w + h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = buf[y * w + x]!;
      uAcc[x + y]! += e;
      uN[x + y]! += 1;
      vAcc[x - y + h]! += e;
      vN[x - y + h]! += 1;
    }
  }
  const norm = (a: Float64Array, n: Float64Array) =>
    Array.from(a, (s, i) => (n[i]! >= 20 ? s / n[i]! : 0));
  return { u: norm(uAcc, uN), v: norm(vAcc, vN) };
}

/** Local maxima, strongest first, separated by at least `sep`. */
function topPeaks(a: number[], sep = 8, take = 6): { at: number; val: number }[] {
  const idx = a
    .map((v, i) => ({ at: i, val: v }))
    .filter((p) => p.val > 0)
    .sort((x, y) => y.val - x.val);
  const out: { at: number; val: number }[] = [];
  for (const p of idx) {
    if (out.every((q) => Math.abs(q.at - p.at) >= sep)) out.push(p);
    if (out.length >= take) break;
  }
  return out.sort((x, y) => x.at - y.at);
}

/**
 * LOCATE THE ASSIST CELLS BY WHAT MAKES THEM DIFFERENT, not by their borders.
 *
 * Border-fitting kept failing — on one frame the corner's live art swamps the
 * edge mask, and on the averaged image the nameplate shares the window and
 * smears both diagonal accumulators. Both attempts were measuring the wrong
 * thing, because the lattice chrome is not the target: the ART INSIDE the cells
 * is.
 *
 * That art has a signature nothing else in the corner has. Within one match the
 * three assists are FIXED (same three fighters for the whole set), while
 * everything else in the window moves: the stage, the fighters, the nameplate
 * and the point-fighter bust all change the instant somebody tags. Across
 * matches the assists change completely. So
 *
 *     score = var_between_videos(per-video mean) / mean_within_video(variance)
 *
 * is large exactly on pixels that hold match-specific, tag-invariant data — the
 * bench icons — and small on the lattice borders (constant everywhere, no
 * between-video signal), on the nameplate and bust (they change on every tag),
 * and on gameplay (high within-video variance). No threshold is asserted: the
 * map is printed and read.
 */
async function cellScore(side: 'L' | 'R', minReads = 20, maxVideos = 30) {
  const WIN = side === 'L' ? { x0: 0.0, x1: 0.14 } : { x0: 0.86, x1: 1.0 };
  let w = 0;
  let h = 0;
  const means: Float64Array[] = [];
  let withinSum: Float64Array | null = null;
  let nVid = 0;
  for (const [id, e] of Object.entries(extracted)) {
    if (!e.geom || nVid >= maxVideos) continue;
    const secs = (side === 'L' ? e.left : e.right).filter((r) => r.id).map((r) => r.sec);
    if (secs.length < minReads) continue;
    let sum: Float64Array | null = null;
    let sq: Float64Array | null = null;
    let n = 0;
    for (const sec of secs.slice(0, 40)) {
      let raw;
      try {
        raw = await sharp(frameFile(id, sec)).greyscale().raw().toBuffer({ resolveWithObject: true });
      } catch {
        continue;
      }
      const { data, info } = raw;
      const W = info.width;
      const H = info.height;
      const X0 = Math.round(W * WIN.x0);
      const cw = Math.round(W * (WIN.x1 - WIN.x0));
      const chh = Math.round(H * 0.21);
      if (!w) {
        w = cw;
        h = chh;
      }
      if (cw !== w || chh !== h) continue;
      sum ??= new Float64Array(w * h);
      sq ??= new Float64Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const px = data[y * W + (X0 + x)]!;
          sum[y * w + x]! += px;
          sq[y * w + x]! += px * px;
        }
      }
      n++;
    }
    if (!sum || n < minReads) continue;
    const mean = new Float64Array(w * h);
    const vari = new Float64Array(w * h);
    for (let i = 0; i < mean.length; i++) {
      mean[i] = sum[i]! / n;
      vari[i] = Math.max(0, sq![i]! / n - mean[i]! * mean[i]!);
    }
    means.push(mean);
    withinSum ??= new Float64Array(w * h);
    for (let i = 0; i < vari.length; i++) withinSum[i]! += vari[i]!;
    nVid++;
  }
  const within = Float64Array.from(withinSum!, (v) => v / nVid);
  const between = new Float64Array(w * h);
  for (let i = 0; i < between.length; i++) {
    let m = 0;
    for (const mv of means) m += mv[i]!;
    m /= means.length;
    let s = 0;
    for (const mv of means) s += (mv[i]! - m) ** 2;
    between[i] = s / means.length;
  }
  const score = new Float64Array(w * h);
  for (let i = 0; i < score.length; i++) score[i] = between[i]! / (within[i]! + 25);
  return { score, w, h, nVid };
}

/**
 * The 8x8 edge-density hash of `hud-read.dhash`, computed from a buffer already
 * in memory instead of a fresh `sharp` extract per crop.
 *
 * SAME ALGORITHM ON PURPOSE — local range over a 5-wide window, 8x8 grid of
 * edge densities, thresholded at the crop mean, returned as 64 characters of
 * '0'/'1'. A spike that hashes differently from the shipping reader measures a
 * reader that does not exist, which is the mistake matcher-sweep.ts made once
 * already by re-measuring geometry per frame. The buffer version exists only so
 * a few hundred candidate crops per frame are affordable.
 */
function hashBoxRaw(d: Buffer, W: number, H: number, b: Box): string {
  const x0 = Math.max(0, Math.round(W * b.x0));
  const y0 = Math.max(0, Math.round(H * b.y0));
  const x1 = Math.min(W - 1, Math.round(W * b.x1));
  const y1 = Math.min(H - 1, Math.round(H * b.y1));
  const cW = x1 - x0;
  const cH = y1 - y0;
  if (cW < 8 || cH < 8) return '0'.repeat(64);
  const cells = new Float64Array(64);
  const counts = new Float64Array(64);
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 2; x < x1 - 2; x++) {
      let mn = 255;
      let mx = 0;
      for (let k = -2; k <= 2; k++) {
        const v = d[y * W + x + k]!;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const gy = Math.min(7, Math.floor(((y - y0) / cH) * 8));
      const gx = Math.min(7, Math.floor(((x - x0) / cW) * 8));
      cells[gy * 8 + gx]! += mx - mn > 70 ? 1 : 0;
      counts[gy * 8 + gx]! += 1;
    }
  }
  const dens = Array.from(cells, (v, i) => (counts[i] ? v / counts[i]! : 0));
  const mean = dens.reduce((a, b2) => a + b2, 0) / 64;
  return dens.map((v) => (v > mean ? '1' : '0')).join('');
}

/**
 * FIT THE CROP AGAINST FREE LABELS instead of deriving it from borders.
 *
 * Every geometric attempt above measured the chrome and not the art. But the
 * nameplate reader already labels the POINT fighter on every frame it resolved,
 * exactly (dist 0) on the large majority — tens of thousands of labels that cost
 * nothing. So the crop can be chosen the way every other constant in this
 * project was: by scoring candidates and keeping what measures best.
 *
 * The objective is the only thing this tier needs to be true:
 *
 *     separation = mean Hamming BETWEEN fighters - mean Hamming WITHIN a fighter
 *
 * and WITHIN is computed only across DIFFERENT videos. Two crops of the same
 * fighter one second apart in one match are near-identical whatever the box is,
 * so a same-video pair would flatter any candidate; the question is whether a
 * fighter looks like themselves in somebody else's upload.
 */
interface Sample {
  video: string;
  label: string;
  data: Buffer;
  W: number;
  H: number;
}

async function bustSamples(side: 'L' | 'R', perVideo = 6): Promise<Sample[]> {
  const out: Sample[] = [];
  for (const [id, e] of Object.entries(extracted)) {
    if (!e.geom) continue;
    // exact reads only: a 1-edit read is a fine character but a noisy LABEL, and
    // label noise would be charged to the hash.
    const reads = (side === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0);
    const picked: FrameRead[] = [];
    for (const r of reads) {
      if (picked.length >= perVideo) break;
      // spread across the video, and never two frames of one burst
      if (picked.every((p) => Math.abs(p.sec - r.sec) > 20)) picked.push(r);
    }
    for (const r of picked) {
      try {
        const { data, info } = await sharp(frameFile(id, r.sec))
          .greyscale()
          .raw()
          .toBuffer({ resolveWithObject: true });
        if (info.width !== 1280 || info.height !== 720) continue;
        out.push({ video: id, label: r.id!, data, W: info.width, H: info.height });
      } catch {
        /* unreadable frame — skip */
      }
    }
  }
  return out;
}

function separability(hashes: { video: string; label: string; h: string }[]) {
  let wSum = 0;
  let wN = 0;
  let bSum = 0;
  let bN = 0;
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const a = hashes[i]!;
      const b = hashes[j]!;
      if (a.video === b.video) continue; // same match tells us nothing
      const d = hamming(a.h, b.h);
      if (a.label === b.label) {
        wSum += d;
        wN++;
      } else {
        bSum += d;
        bN++;
      }
    }
  }
  const within = wN ? wSum / wN : 0;
  const between = bN ? bSum / bN : 0;
  return { within, between, sep: between - within, wN, bN };
}

if (process.argv.includes('--fit')) {
  for (const side of ['L', 'R'] as const) {
    const samples = await bustSamples(side);
    const labels = new Set(samples.map((s) => s.label));
    console.log(
      `\n  ${side}: ${samples.length} exact-read frames from ` +
        `${new Set(samples.map((s) => s.video)).size} videos, ${labels.size} distinct fighters`,
    );
    const results: { box: Box; within: number; between: number; sep: number; label: string }[] = [];
    for (const S of [32, 44, 56, 68]) {
      for (let px = 20; px <= 130; px += 10) {
        for (let py = 10; py <= 110; py += 10) {
          const cx = side === 'L' ? px : 1280 - px;
          const box: Box = {
            x0: (cx - S / 2) / 1280,
            x1: (cx + S / 2) / 1280,
            y0: (py - S / 2) / 720,
            y1: (py + S / 2) / 720,
          };
          if (box.x0 < 0 || box.x1 > 1 || box.y0 < 0 || box.y1 > 1) continue;
          const hashes = samples.map((s) => ({
            video: s.video,
            label: s.label,
            h: hashBoxRaw(s.data, s.W, s.H, box),
          }));
          const r = separability(hashes);
          results.push({ box, ...r, label: `S=${S} centre=(${px},${py})` });
        }
      }
    }
    results.sort((a, b) => b.sep - a.sep);
    console.log('     best crops by cross-video separation (between - within, of 64 bits)');
    for (const r of results.slice(0, 8)) {
      console.log(
        `       ${r.label.padEnd(26)} within ${r.within.toFixed(1)}  between ${r.between.toFixed(1)}  sep ${r.sep.toFixed(2)}`,
      );
    }
    const worst = results[results.length - 1]!;
    console.log(
      `     worst: ${worst.label.padEnd(26)} within ${worst.within.toFixed(1)}  between ${worst.between.toFixed(1)}  sep ${worst.sep.toFixed(2)}`,
    );
  }
  console.log('');
}

/**
 * THE ASSIST CELLS NEED THE OPPOSITE OBJECTIVE FROM THE BUST.
 *
 * The bust is scored by whether a fighter looks like themselves across matches,
 * because the plate hands us its label for free. No such label exists for the
 * three assist diamonds — that is the whole reason this tier is being built. But
 * they have a structural signature the bust does not:
 *
 *   assist cell : FIXED for the whole match (the team is chosen once), and
 *                 completely different in the next match      -> within 0, between high
 *   bust        : changes the instant anyone tags              -> within moderate
 *   gameplay    : changes every frame                          -> within high
 *   chrome      : identical in every match                     -> between 0
 *
 * so `mean(between-video) - mean(within-video)` peaks on exactly the cells this
 * tier has to read, and needs no labels at all. Frames within a video are taken
 * >20 s apart so "within" is a real test of tag-invariance rather than two
 * frames of one burst.
 */
function assistObjective(hashes: { video: string; h: string }[]) {
  let wSum = 0;
  let wN = 0;
  let bSum = 0;
  let bN = 0;
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const d = hamming(hashes[i]!.h, hashes[j]!.h);
      if (hashes[i]!.video === hashes[j]!.video) {
        wSum += d;
        wN++;
      } else {
        bSum += d;
        bN++;
      }
    }
  }
  const within = wN ? wSum / wN : 0;
  const between = bN ? bSum / bN : 0;
  return { within, between, sep: between - within };
}

if (process.argv.includes('--fit-assist')) {
  for (const side of ['L', 'R'] as const) {
    const samples = await bustSamples(side);
    console.log(
      `\n  ${side}: ${samples.length} frames from ${new Set(samples.map((s) => s.video)).size} videos` +
        ` (>20 s apart within a video)`,
    );
    const results: { label: string; within: number; between: number; sep: number }[] = [];
    for (const S of [24, 32, 40]) {
      for (let px = 15; px <= 145; px += 5) {
        for (let py = 15; py <= 145; py += 5) {
          const cx = side === 'L' ? px : 1280 - px;
          const box: Box = {
            x0: (cx - S / 2) / 1280,
            x1: (cx + S / 2) / 1280,
            y0: (py - S / 2) / 720,
            y1: (py + S / 2) / 720,
          };
          if (box.x0 < 0 || box.x1 > 1 || box.y0 < 0 || box.y1 > 1) continue;
          const hashes = samples.map((s) => ({
            video: s.video,
            h: hashBoxRaw(s.data, s.W, s.H, box),
          }));
          const r = assistObjective(hashes);
          results.push({ label: `S=${S} centre=(${px},${py})`, ...r });
        }
      }
    }
    results.sort((a, b) => b.sep - a.sep);
    console.log('     most tag-invariant, match-specific crops (between - within, of 64 bits)');
    for (const r of results.slice(0, 10)) {
      console.log(
        `       ${r.label.padEnd(26)} within ${r.within.toFixed(1)}  between ${r.between.toFixed(1)}  sep ${r.sep.toFixed(2)}`,
      );
    }
  }
  console.log('');
}

/**
 * THE LATTICE, as derived from the mean image and then CONFIRMED in a montage.
 *
 * The corner holds a 2x2 grid of squares rotated 45°. Its centre is the point
 * where all four cells meet, measured at (80, 73) px on a 1280x720 frame — the
 * `lattice-mid` box lands exactly on the chrome cross, which is what a correct
 * centre looks like. Cell half-diagonal is 36 px, so cell centres sit at
 * centre ± (36,0) and centre ± (0,36).
 *
 * The TOP cell is not a framed icon: the point fighter is drawn there as a large
 * unframed bust that overflows the cell. The other three hold the bench, each a
 * framed diamond. So a side shows all four of its fighters at once — one as a
 * bust, three as diamonds — which is exactly the 36% the nameplate can never
 * reach.
 *
 * Pixel coordinates, not fractions of the trusted anchor, and deliberately so
 * for now: the anchor's own spread is only ±12 px (rightX1 0.897-0.915) and
 * whether the cluster tracks the anchor or the frame edge is a Step 1
 * measurement, not something to bake in here on a guess.
 */
const CELL_S = 40;
const CELLS = [
  { name: 'top(bust)', px: 80, py: 37 },
  { name: 'left', px: 44, py: 73 },
  { name: 'right', px: 116, py: 73 },
  { name: 'bottom', px: 80, py: 109 },
  { name: 'centre-chrome', px: 80, py: 73 },
];
/** The three framed bench diamonds — the point fighter's cell is the bust. */
const ASSIST_CELLS = CELLS.filter((c) => ['left', 'right', 'bottom'].includes(c.name));

const cellBox = (c: { px: number; py: number }, side: 'L' | 'R', S = CELL_S): Box => {
  const cx = side === 'L' ? c.px : 1280 - c.px;
  return {
    x0: (cx - S / 2) / 1280,
    x1: (cx + S / 2) / 1280,
    y0: (c.py - S / 2) / 720,
    y1: (c.py + S / 2) / 720,
  };
};

/**
 * DO THE CELLS ROTATE WHEN SOMEBODY TAGS?
 *
 * The tag-invariance fit found nothing in the corner that holds still across a
 * match — `within` stayed at 13-14 bits even for frames 20 s apart, higher than
 * the bust's CROSS-VIDEO same-fighter distance of 7.6. Yet the montage shows the
 * bottom cell holding a clean, framed bench icon in every row. Both are true only
 * if the cell CONTENTS move: the team is fixed, but which diamond holds whom
 * changes as the point fighter changes.
 *
 * The plate settles it for free. Compare each cell across pairs of frames from
 * one video, split by whether the plate read the SAME point fighter in both:
 *
 *   contents follow the point  ->  same-point ~0,  different-point large
 *   contents are fixed         ->  both ~0
 *   the box is not a cell      ->  both large
 */
if (process.argv.includes('--rotate')) {
  for (const side of ['L', 'R'] as const) {
    const samples = await bustSamples(side, 8);
    const byVideo = new Map<string, Sample[]>();
    for (const s of samples) byVideo.set(s.video, [...(byVideo.get(s.video) ?? []), s]);
    console.log(`\n  ${side} corner — within-video cell distance, split by the plate's point read`);
    console.log('     cell            same point       different point     pairs');
    for (const c of CELLS) {
      const box = cellBox(c, side);
      let sSum = 0;
      let sN = 0;
      let dSum = 0;
      let dN = 0;
      for (const list of byVideo.values()) {
        const hs = list.map((s) => ({
          label: s.label,
          h: hashBoxRaw(s.data, s.W, s.H, box),
        }));
        for (let i = 0; i < hs.length; i++) {
          for (let j = i + 1; j < hs.length; j++) {
            const d = hamming(hs[i]!.h, hs[j]!.h);
            if (hs[i]!.label === hs[j]!.label) {
              sSum += d;
              sN++;
            } else {
              dSum += d;
              dN++;
            }
          }
        }
      }
      console.log(
        `     ${c.name.padEnd(14)} ${(sN ? sSum / sN : 0).toFixed(1).padStart(6)} (${String(sN).padStart(4)})   ` +
          `${(dN ? dSum / dN : 0).toFixed(1).padStart(6)} (${String(dN).padStart(4)})`,
      );
    }
  }
  console.log('');
}

/**
 * IS A 15-BIT MEAN ONE NOISY SIGNAL, OR A MIXTURE OF TWO CLEAN ONES?
 *
 * The assist cells sit at ~15 bits within a match even when the plate says the
 * point fighter never changed, which reads at first like the art being unstable.
 * But a mean is not a distribution, and 15 is close to what a PERMUTATION would
 * produce: if the three bench icons swap cells during the match, a given cell
 * holds the same fighter in about a third of frame pairs, so the distances should
 * be a 1/3 mass near zero and a 2/3 mass out near the between-fighter distance —
 * mixing to 0.33x2 + 0.67x22 ~= 15.
 *
 * A unimodal spread around 15 means the art itself moves (a health gauge, a
 * cooldown fill) and the crop needs rethinking. A bimodal one means the icons are
 * perfectly readable and only their POSITION is unstable — which costs nothing,
 * because a bench is a SET and this tier only ever needed set membership.
 *
 * Also reported: the same histogram for the three cells matched as a set (each
 * cell to its nearest counterpart in the other frame). Under the permutation
 * story that collapses to near zero; under the unstable-art story it does not.
 */
if (process.argv.includes('--hist')) {
  const BUCKETS = [0, 2, 4, 6, 8, 12, 16, 20, 24, 28, 64];
  const histo = (xs: number[]): string => {
    const h = new Array<number>(BUCKETS.length - 1).fill(0);
    for (const x of xs) {
      for (let i = BUCKETS.length - 2; i >= 0; i--) {
        if (x >= BUCKETS[i]!) {
          h[i]!++;
          break;
        }
      }
    }
    return h
      .map((n, i) => `${BUCKETS[i]}-${BUCKETS[i + 1]! - 1}:${((100 * n) / xs.length).toFixed(0)}%`)
      .join('  ');
  };
  for (const S of [28, 36, 40]) {
    console.log(`\n  cell size ${S}px — same-point within-video distances (LEFT corner)`);
    const samples = await bustSamples('L', 8);
    const byVideo = new Map<string, Sample[]>();
    for (const s of samples) byVideo.set(s.video, [...(byVideo.get(s.video) ?? []), s]);
    const per: Record<string, number[]> = {};
    const setMatched: number[] = [];
    for (const list of byVideo.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i]!.label !== list[j]!.label) continue;
          const hi = ASSIST_CELLS.map((c) => hashBoxRaw(list[i]!.data, 1280, 720, cellBox(c, 'L', S)));
          const hj = ASSIST_CELLS.map((c) => hashBoxRaw(list[j]!.data, 1280, 720, cellBox(c, 'L', S)));
          ASSIST_CELLS.forEach((c, k) => {
            (per[c.name] ??= []).push(hamming(hi[k]!, hj[k]!));
          });
          // set matching: each cell to its BEST counterpart, order ignored
          for (const a of hi) setMatched.push(Math.min(...hj.map((b) => hamming(a, b))));
        }
      }
    }
    for (const c of ASSIST_CELLS) {
      console.log(`     ${c.name.padEnd(8)} fixed-cell   ${histo(per[c.name]!)}`);
    }
    console.log(`     ${'ANY cell'.padEnd(8)} set-matched  ${histo(setMatched)}`);
  }
  console.log('');
}

/**
 * HASH THE DIAMOND ITSELF, not the axis-aligned square inside it.
 *
 * A cell is a square rotated 45° with half-diagonal 36 px. The largest
 * axis-aligned box that fits inside it has side 36 — so `hashBoxRaw` was using
 * about HALF the icon's pixels (the diamond's area is 2d² = 2592 px², equivalent
 * to a 51x51 square) and throwing away the four triangles that carry a good deal
 * of the art. Worse, an axis-aligned box is unforgiving of a few pixels of centre
 * error: it starts eating the NEIGHBOURING cells, whose contents are different
 * fighters, which is the most plausible source of the residual disagreement in
 * both-drawn pairs.
 *
 * Rotating is done by sampling rather than by a `sharp` round-trip, which keeps it
 * cheap enough for a parameter search. Substituting
 *
 *     x = cx + (a + b)      y = cy + (a - b)
 *
 * turns |x-cx| + |y-cy| <= d — the diamond — into max(|a|,|b|) <= d/2, a square in
 * (a,b). Sweeping a and b over [-d/2, d/2] therefore covers exactly the cell and
 * nothing outside it. Local range is still measured along the SOURCE row with the
 * same 5-tap window and the same threshold of 70, so the hash stays comparable to
 * the shipping `dhash`.
 */
function hashDiamond(
  d: Buffer,
  W: number,
  H: number,
  cx: number,
  cy: number,
  halfDiag: number,
  /** Mirror about the cell's vertical axis. The two corners are mirror images of
   *  each other (measured: left cell cores at x-fraction 0.0336/0.0492 against the
   *  right's 0.9633/0.9516), so comparing a left crop with a right one without
   *  flipping compares a portrait against its own reflection. Flipping keeps
   *  y = cy + (a-b) while sending x to cx - (a+b). */
  mirror = false,
): string {
  const N = Math.max(16, Math.round(halfDiag * Math.SQRT2));
  const cells = new Float64Array(64);
  const counts = new Float64Array(64);
  for (let i = 0; i < N; i++) {
    const a = (i / (N - 1) - 0.5) * halfDiag;
    for (let j = 0; j < N; j++) {
      const b = (j / (N - 1) - 0.5) * halfDiag;
      const x = Math.round(mirror ? cx - (a + b) : cx + a + b);
      const y = Math.round(cy + a - b);
      if (x < 2 || y < 0 || x >= W - 2 || y >= H) continue;
      let mn = 255;
      let mx = 0;
      for (let k = -2; k <= 2; k++) {
        const v = d[y * W + x + k]!;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const gi = Math.min(7, Math.floor((i / N) * 8));
      const gj = Math.min(7, Math.floor((j / N) * 8));
      cells[gi * 8 + gj]! += mx - mn > 70 ? 1 : 0;
      counts[gi * 8 + gj]! += 1;
    }
  }
  const dens = Array.from(cells, (v, i) => (counts[i] ? v / counts[i]! : 0));
  const mean = dens.reduce((a, b) => a + b, 0) / 64;
  return dens.map((v) => (v > mean ? '1' : '0')).join('');
}

/**
 * Refit the lattice centre and cell size against the crop's own job.
 *
 * The objective has to reward a crop that is STABLE when it should be and still
 * DISCRIMINATING, or it degenerates: a box parked on the chrome cross is identical
 * in every frame of every match and would win any stability-only score outright.
 * So both halves are measured on the same pairs —
 *
 *     stable   = share of within-video, same-point pairs at <= 7 bits
 *     leaky    = share of CROSS-video pairs at <= 7 bits   (chrome scores 1.0 here)
 *     score    = stable - leaky
 *
 * and chrome nets out to zero by construction.
 */
if (process.argv.includes('--refit')) {
  const samples = await bustSamples('L', 8);
  const byVideo = new Map<string, Sample[]>();
  for (const s of samples) byVideo.set(s.video, [...(byVideo.get(s.video) ?? []), s]);
  const vids = [...byVideo.values()];
  console.log('\n  refitting the lattice on the three bench diamonds (LEFT corner)\n');
  const results: { label: string; stable: number; leaky: number; score: number }[] = [];
  for (const hd of [14, 18, 22, 26, 30, 36]) {
    for (let ox = -6; ox <= 6; ox += 3) {
      for (let oy = -6; oy <= 6; oy += 3) {
        const centres = ASSIST_CELLS.map((c) => ({ px: c.px + ox, py: c.py + oy }));
        let sLow = 0;
        let sN = 0;
        let xLow = 0;
        let xN = 0;
        const perVideo = vids.map((list) =>
          list.map((s) => ({
            label: s.label,
            hs: centres.map((c) => hashDiamond(s.data, s.W, s.H, c.px, c.py, hd)),
          })),
        );
        for (const list of perVideo) {
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              if (list[i]!.label !== list[j]!.label) continue;
              for (let k = 0; k < centres.length; k++) {
                if (hamming(list[i]!.hs[k]!, list[j]!.hs[k]!) <= 7) sLow++;
                sN++;
              }
            }
          }
        }
        for (let vi = 0; vi < perVideo.length; vi++) {
          for (let vj = vi + 1; vj < perVideo.length; vj++) {
            const A = perVideo[vi]![0];
            const B = perVideo[vj]![0];
            if (!A || !B) continue;
            for (let k = 0; k < centres.length; k++) {
              if (hamming(A.hs[k]!, B.hs[k]!) <= 7) xLow++;
              xN++;
            }
          }
        }
        const stable = sN ? sLow / sN : 0;
        const leaky = xN ? xLow / xN : 0;
        results.push({
          label: `d=${hd} offset=(${ox >= 0 ? '+' : ''}${ox},${oy >= 0 ? '+' : ''}${oy})`,
          stable,
          leaky,
          score: stable - leaky,
        });
      }
    }
  }
  results.sort((a, b) => b.score - a.score);
  console.log('     geometry                stable(<=7)   leaky(<=7)   score');
  for (const r of results.slice(0, 10)) {
    console.log(
      `     ${r.label.padEnd(24)} ${(100 * r.stable).toFixed(1).padStart(9)}%   ${(100 * r.leaky).toFixed(1).padStart(8)}%   ${(100 * r.score).toFixed(1).padStart(5)}`,
    );
  }
  const base = results.find((r) => r.label === 'd=36 offset=(+0,+0)')!;
  console.log(
    `\n     baseline (the eyeballed centre): ${(100 * base.stable).toFixed(1)}% stable, ` +
      `${(100 * base.leaky).toFixed(1)}% leaky, score ${(100 * base.score).toFixed(1)}`,
  );
  console.log('');
}

/**
 * CANONICAL ORIENTATION. Every crop is hashed as if it came from the LEFT corner:
 * the right side's cell centre is mirrored in x and its sampling is flipped. The
 * measurement that forces this is below — same fighter, different match, comparing a
 * left crop with an unflipped right crop scores 29.14 bits, which is the
 * DIFFERENT-fighter level, while flipping brings it to 15.16 alongside L-L's 11.92.
 * Pool the sides without this and every cross-side pair is noise, which is exactly
 * what happened to the first run of the transfer and identity tests.
 *
 * It also doubles each fighter's crop count, which matters most for the thin classes
 * the per-fighter radius has to be widened for.
 */
const canon = (s: Sample, side: 'L' | 'R', px: number, py: number, d: number): string =>
  hashDiamond(s.data, s.W, s.H, side === 'L' ? px : 1280 - px, py, d, side === 'R');

/**
 * IS THE RIGHT CORNER'S ART MIRRORED, OR ONLY ITS POSITION?
 *
 * The LAYOUT is mirrored — that was measured in Step 0. Whether the PORTRAITS inside
 * the cells are also flipped is a separate question, and it decides whether the two
 * sides share one template set or need two. It also explains an anomaly: the bust
 * control returned 23.41 bits for same-fighter pairs when the per-side measurement
 * had said 12.9, and the difference is that the control pooled left and right crops
 * without flipping either.
 *
 * Settled by splitting same-fighter bust pairs four ways. If L-R flipped lands near
 * L-L and R-R while L-R unflipped sits far above them, the art is mirrored and one
 * flipped template set serves both sides — which doubles every fighter's crop count
 * and matters most for the thin classes.
 */
if (process.argv.includes('--mirror')) {
  const rows: { side: 'L' | 'R'; video: string; label: string; plain: string; flip: string }[] = [];
  for (const side of ['L', 'R'] as const) {
    for (const s of await bustSamples(side, 6)) {
      const cx = side === 'L' ? 80 : 1280 - 80;
      rows.push({
        side,
        video: s.video,
        label: s.label,
        plain: hashDiamond(s.data, s.W, s.H, cx, 37, 36, false),
        flip: hashDiamond(s.data, s.W, s.H, cx, 37, 36, true),
      });
    }
  }
  const cats: Record<string, number[]> = { 'L-L': [], 'R-R': [], 'L-R plain': [], 'L-R flipped': [] };
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const A = rows[i]!;
      const B = rows[j]!;
      if (A.video === B.video || A.label !== B.label) continue; // same fighter, different match
      if (A.side === 'L' && B.side === 'L') cats['L-L']!.push(hamming(A.plain, B.plain));
      else if (A.side === 'R' && B.side === 'R') cats['R-R']!.push(hamming(A.plain, B.plain));
      else {
        const [l, r] = A.side === 'L' ? [A, B] : [B, A];
        cats['L-R plain']!.push(hamming(l.plain, r.plain));
        cats['L-R flipped']!.push(hamming(l.plain, r.flip));
      }
    }
  }
  console.log('\n  same fighter, different match — bust distance by side pairing\n');
  console.log('     pairing        pairs   mean bits');
  for (const [k, ds] of Object.entries(cats)) {
    console.log(
      `     ${k.padEnd(13)} ${String(ds.length).padStart(6)}   ${(ds.reduce((a, b) => a + b, 0) / (ds.length || 1)).toFixed(2).padStart(8)}`,
    );
  }
  console.log('');
}

/**
 * THE WATCH ITEM, NOW THE BINDING CONSTRAINT: two render states per fighter.
 *
 * A side fields three assists, yet its crops resolve to about SIX groups of
 * meaningful size (6.1 at t=8, covering only 61% of crops in the top three). Six is
 * what three fighters produce when each is drawn two ways — and the single-frame
 * crops show exactly two ways: two diamonds desaturated, one rendered at full colour
 * inside a border in the side's own hue.
 *
 * If the state is detectable per crop, it can be tagged and the class split, which
 * turns six noisy groups into three clean pairs. Measured here rather than assumed:
 * take each frame's three cells and ask whether one is a consistent luminance
 * outlier. A large, reliable gap means the state is readable directly; a small one
 * means it has to come from colour, which greyscale hashing has thrown away.
 */
function cellMeanLuma(d: Buffer, W: number, H: number, cx: number, cy: number, halfDiag: number, mirror: boolean): number {
  const N = Math.max(16, Math.round(halfDiag * Math.SQRT2));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / (N - 1) - 0.5) * halfDiag;
    for (let j = 0; j < N; j++) {
      const b = (j / (N - 1) - 0.5) * halfDiag;
      const x = Math.round(mirror ? cx - (a + b) : cx + a + b);
      const y = Math.round(cy + a - b);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      sum += d[y * W + x]!;
      n++;
    }
  }
  return n ? sum / n : 0;
}

if (process.argv.includes('--states')) {
  const gaps: number[] = [];
  const outlierCell: number[] = [0, 0, 0];
  let n = 0;
  for (const [id, e] of Object.entries(extracted)) {
    if (!e.geom || !truthBenches.has(id)) continue;
    for (const side of ['L', 'R'] as const) {
      const reads = (side === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0).slice(0, 6);
      for (const r of reads) {
        let raw;
        try {
          raw = await sharp(frameFile(id, r.sec)).greyscale().raw().toBuffer({ resolveWithObject: true });
        } catch {
          continue;
        }
        if (raw.info.width !== 1280) continue;
        const lum = ASSIST_CELLS.map((c) =>
          cellMeanLuma(raw.data, 1280, 720, side === 'L' ? c.px : 1280 - c.px, c.py, 22, side === 'R'),
        );
        const sorted = [...lum].sort((a, b) => a - b);
        gaps.push(sorted[2]! - sorted[0]!);
        outlierCell[lum.indexOf(sorted[2]!)]!++;
        n++;
      }
    }
  }
  gaps.sort((a, b) => a - b);
  console.log(`\n  ${n} frames — is one of the three cells a luminance outlier?\n`);
  console.log(
    `     brightest-minus-dimmest cell luminance:  median ${gaps[Math.floor(gaps.length / 2)]!.toFixed(1)}` +
      `   p10 ${gaps[Math.floor(gaps.length * 0.1)]!.toFixed(1)}   p90 ${gaps[Math.floor(gaps.length * 0.9)]!.toFixed(1)}  (of 255)`,
  );
  console.log(
    `     which cell is brightest:  left ${((100 * outlierCell[0]!) / n).toFixed(0)}%  ` +
      `right ${((100 * outlierCell[1]!) / n).toFixed(0)}%  bottom ${((100 * outlierCell[2]!) / n).toFixed(0)}%`,
  );
  console.log(
    '     A large gap with no fixed winner = a real, moving render state worth tagging.\n' +
      '     A small gap = the state lives in COLOUR, which greyscale hashing discarded.\n',
  );
}

/**
 * CO-OCCURRENCE, STAGE ONE: does one side's own crops form three groups?
 *
 * Transfer is dead — bust templates rank diamond crops WORSE than a pixel-blind
 * popularity prior (16.7% vs 36.7% top-1, orientation corrected), so the bust's free
 * labels do not carry over and the diamonds need labels of their own. Co-occurrence
 * can supply them, but only if the crops cluster first: a side fields exactly three
 * assists, so its diamond crops over a whole match should collapse to three groups,
 * whatever order the cells hold them in.
 *
 * This measures that before any cross-video linking is attempted. Clustering WITHIN
 * a side also cleans the descriptor for free — a group's majority hash is built from
 * dozens of crops, so it is far less noisy than the single crops whose pairwise
 * distances looked so weak (k=3 sides best-matched at 11.71 bits against k=0's
 * 17.41).
 *
 * If a side's crops do not resolve to about three groups of usable size, the
 * co-occurrence route fails here rather than after a lot more machinery.
 */
async function sideCrops(perVideo = 20) {
  const out: {
    video: string;
    side: 'L' | 'R';
    expected: string[];
    point: string;
    sec: number;
    hs: string[];
    lum: number[];
  }[] = [];
  for (const [id, e] of Object.entries(extracted)) {
    const benches = truthBenches.get(id);
    if (!benches || !e.geom) continue;
    for (const side of ['L', 'R'] as const) {
      const reads = (side === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0);
      const picked: FrameRead[] = [];
      for (const r of reads) {
        if (picked.length >= perVideo) break;
        if (picked.every((p) => Math.abs(p.sec - r.sec) > 4)) picked.push(r);
      }
      for (const r of picked) {
        const owning = benches.filter((b) => b.includes(r.id!));
        if (owning.length !== 1) continue;
        let raw;
        try {
          raw = await sharp(frameFile(id, r.sec)).greyscale().raw().toBuffer({ resolveWithObject: true });
        } catch {
          continue;
        }
        if (raw.info.width !== 1280 || raw.info.height !== 720) continue;
        const s: Sample = { video: id, label: r.id!, data: raw.data, W: 1280, H: 720 };
        out.push({
          video: id,
          side,
          expected: owning[0]!.filter((c) => c !== r.id),
          point: r.id!,
          sec: r.sec,
          hs: ASSIST_CELLS.map((c) => canon(s, side, c.px, c.py, 22)),
          lum: ASSIST_CELLS.map((c) =>
            cellMeanLuma(raw.data, 1280, 720, side === 'L' ? c.px : 1280 - c.px, c.py, 22, side === 'R'),
          ),
        });
      }
    }
  }
  return out;
}

/** Agglomerate hashes: a crop joins the first group whose representative is within
 *  `t`, else starts one. Same rule as `distinct()` in hud-read.ts. */
function group(hs: string[], t: number): { rep: string; members: string[] }[] {
  const gs: { rep: string; members: string[] }[] = [];
  for (const h of hs) {
    const g = gs.find((x) => hamming(h, x.rep) <= t);
    if (g) g.members.push(h);
    else gs.push({ rep: h, members: [h] });
  }
  for (const g of gs) g.rep = majorityHash(g.members);
  return gs.sort((a, b) => b.members.length - a.members.length);
}

if (process.argv.includes('--cluster')) {
  const crops = await sideCrops();
  // Tag each crop's render state from its own frame: within a frame the brightest
  // of the three cells is the highlighted one, the other two are desaturated. The
  // gap is a median 100 of 255, so the tag is not a close call.
  const pooled = new Map<string, string[]>();
  const split = new Map<string, { lit: string[]; dim: string[] }>();
  for (const c of crops) {
    const k = `${c.video}/${c.side}`;
    pooled.set(k, [...(pooled.get(k) ?? []), ...c.hs]);
    const s = split.get(k) ?? { lit: [], dim: [] };
    const bright = c.lum.indexOf(Math.max(...c.lum));
    c.hs.forEach((h, i) => (i === bright ? s.lit : s.dim).push(h));
    split.set(k, s);
  }
  console.log(
    `\n  ${crops.length} frames over ${pooled.size} sides — a side fields THREE assists.\n` +
      `  Groups found, pooling both render states vs splitting them:\n`,
  );
  console.log('     t    pooled groups   pooled top-3    dim groups   lit groups   split top-3');
  for (const t of [6, 8, 10, 12, 14, 16]) {
    let gTot = 0;
    let topShare = 0;
    let dimTot = 0;
    let litTot = 0;
    let splitShare = 0;
    let n = 0;
    for (const [k, hs] of pooled) {
      if (hs.length < 12) continue;
      const gs = group(hs, t);
      gTot += gs.length;
      topShare += gs.slice(0, 3).reduce((a, g) => a + g.members.length, 0) / hs.length;
      const s = split.get(k)!;
      const dg = group(s.dim, t);
      const lg = group(s.lit, t);
      dimTot += dg.length;
      litTot += lg.length;
      splitShare +=
        (dg.slice(0, 3).reduce((a, g) => a + g.members.length, 0) +
          lg.slice(0, 3).reduce((a, g) => a + g.members.length, 0)) /
        hs.length;
      n++;
    }
    console.log(
      `     ${String(t).padStart(2)}   ${(gTot / n).toFixed(1).padStart(12)}   ${((100 * topShare) / n).toFixed(0).padStart(11)}%   ` +
        `${(dimTot / n).toFixed(1).padStart(10)}   ${(litTot / n).toFixed(1).padStart(10)}   ${((100 * splitShare) / n).toFixed(0).padStart(10)}%`,
    );
  }
  console.log('');
}

/**
 * IS THE DESCRIPTOR THE PROBLEM? TEST COLOUR, THE SIBLING'S OWN ANSWER.
 *
 * The greyscale edge hash was inherited from the nameplate reader, where it is
 * right: glyphs are shape, and the plate is drawn over arbitrary live art. A bench
 * portrait is not glyphs. It is a 31x31 patch of character art whose most
 * distinctive property is COLOUR — Green Goblin's purple and green, Magneto's red,
 * Blade's near-monochrome — and 64 bits of edge density at that size throws all of
 * it away. Co-occurrence tops out at 46.9% recall as an upper bound, so the
 * descriptor is the thing to question.
 *
 * `2xko-replay-database/scripts/fuses.ts` already solved the same shape of problem —
 * identify a small coloured HUD element over live gameplay — with saturation-
 * weighted hue voting rather than structure, after mean-hue averaging failed on
 * crops that mix the element with health-bar bleed. Votes, not means, is the lesson
 * carried here; the histogram below is that idea with the classes left open.
 *
 * Hue was deliberately held back until recolour behaviour was measured. It has been:
 * the two render states differ by a median 100 luminance levels, and a hue histogram
 * normalised by saturation is far less disturbed by a brightness change than an
 * edge-density hash thresholded at an absolute 70.
 */
const HUE_BINS = 12;
function colourDescriptor(
  rgb: Buffer,
  W: number,
  H: number,
  ch: number,
  cx: number,
  cy: number,
  halfDiag: number,
  mirror: boolean,
): Float64Array {
  // HUE_BINS hue bins (saturation-weighted) + one achromatic bin, L1-normalised
  const out = new Float64Array(HUE_BINS + 1);
  const N = Math.max(16, Math.round(halfDiag * Math.SQRT2));
  for (let i = 0; i < N; i++) {
    const a = (i / (N - 1) - 0.5) * halfDiag;
    for (let j = 0; j < N; j++) {
      const b = (j / (N - 1) - 0.5) * halfDiag;
      const x = Math.round(mirror ? cx - (a + b) : cx + a + b);
      const y = Math.round(cy + a - b);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const o = (y * W + x) * ch;
      const r = rgb[o]! / 255;
      const g = rgb[o + 1]! / 255;
      const bl = rgb[o + 2]! / 255;
      const mx = Math.max(r, g, bl);
      const mn = Math.min(r, g, bl);
      const d = mx - mn;
      const sat = mx === 0 ? 0 : d / mx;
      if (sat < 0.25 || mx < 0.15) {
        out[HUE_BINS]! += 1; // achromatic: its OWN bin, not a vote discarded
        continue;
      }
      let h: number;
      if (mx === r) h = ((g - bl) / d) % 6;
      else if (mx === g) h = (bl - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      out[Math.min(HUE_BINS - 1, Math.floor((h / 360) * HUE_BINS))]! += sat;
    }
  }
  let s = 0;
  for (const v of out) s += v;
  if (s > 0) for (let i = 0; i < out.length; i++) out[i]! /= s;
  return out;
}

/** L1 distance, scaled to 0..64 so it reads on the same axis as Hamming bits. */
const l1 = (a: Float64Array, b: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return (s / 2) * 64;
};

if (process.argv.includes('--colour')) {
  interface CRec {
    video: string;
    expected: string[];
    point: string;
    cells: Float64Array[];
    bust: Float64Array;
  }
  const recs: CRec[] = [];
  for (const [id, e] of Object.entries(extracted)) {
    const benches = truthBenches.get(id);
    if (!benches || !e.geom) continue;
    for (const side of ['L', 'R'] as const) {
      const reads = (side === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0);
      const picked: FrameRead[] = [];
      for (const r of reads) {
        if (picked.length >= 3) break;
        if (picked.every((p) => Math.abs(p.sec - r.sec) > 20)) picked.push(r);
      }
      for (const r of picked) {
        const owning = benches.filter((b) => b.includes(r.id!));
        if (owning.length !== 1) continue;
        let raw;
        try {
          raw = await sharp(frameFile(id, r.sec)).raw().toBuffer({ resolveWithObject: true });
        } catch {
          continue;
        }
        const { data, info } = raw;
        if (info.width !== 1280) continue;
        const mir = side === 'R';
        const cxOf = (px: number) => (side === 'L' ? px : 1280 - px);
        recs.push({
          video: id,
          expected: owning[0]!.filter((c) => c !== r.id),
          point: r.id!,
          cells: ASSIST_CELLS.map((c) =>
            colourDescriptor(data, info.width, info.height, info.channels, cxOf(c.px), c.py, 22, mir),
          ),
          bust: colourDescriptor(data, info.width, info.height, info.channels, cxOf(80), 37, 36, mir),
        });
      }
    }
  }
  console.log(`\n  ${recs.length} sides — COLOUR descriptor (${HUE_BINS} hue bins + achromatic)\n`);
  const byK = new Map<number, number[]>();
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const A = recs[i]!;
      const B = recs[j]!;
      if (A.video === B.video) continue;
      const k = A.expected.filter((e) => B.expected.includes(e)).length;
      let min = Infinity;
      for (const a of A.cells) for (const b of B.cells) min = Math.min(min, l1(a, b));
      byK.set(k, [...(byK.get(k) ?? []), min]);
    }
  }
  console.log('  DIAMONDS — best cell-to-cell match by shared fighters (lower = closer)');
  console.log('     shared (k)   side-pairs   mean best distance');
  for (const k of [...byK.keys()].sort()) {
    const ds = byK.get(k)!;
    console.log(
      `     ${String(k).padStart(6)}       ${String(ds.length).padStart(6)}       ${(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(2).padStart(10)}`,
    );
  }
  let sameSum = 0;
  let sameN = 0;
  let diffSum = 0;
  let diffN = 0;
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      if (recs[i]!.video === recs[j]!.video) continue;
      const d = l1(recs[i]!.bust, recs[j]!.bust);
      if (recs[i]!.point === recs[j]!.point) {
        sameSum += d;
        sameN++;
      } else {
        diffSum += d;
        diffN++;
      }
    }
  }
  console.log(
    `\n  BUST control — same point fighter ${(sameSum / sameN).toFixed(2)} (${sameN}), ` +
      `different ${(diffSum / diffN).toFixed(2)} (${diffN})   [greyscale hash gave 14.93 vs 29.16]\n`,
  );
}

/**
 * CO-OCCURRENCE, STAGE TWO: label the groups without a single human judgement.
 *
 * Global clustering then intersecting candidate sets is the obvious route and it is
 * fragile here — the descriptor is weak enough that one bad link merges two
 * fighters and the intersection empties. A pairwise formulation is far more robust
 * and uses the same information:
 *
 *   if two sides from different matches share EXACTLY ONE fighter, then whichever
 *   of their groups match each other best are probably both that fighter.
 *
 * The shared fighter's identity is known outright — it is the single element of the
 * intersection — so every such pair casts a labelled vote at the cost of one
 * distance computation, with no clustering to go wrong. Votes accumulate over
 * thousands of pairs, and a group's label is its argmax. Wrong pairings do not
 * conspire: a spurious best-match scatters its vote across whatever fighter happens
 * to be shared, while genuine matches all vote the same way.
 *
 * Templates stay PER STATE. The measurement above forces it — pooling the lit and
 * desaturated renderings of one fighter leaves six groups where there are three
 * fighters, and splitting them lifts top-3 coverage from 61% to 78%.
 */
if (process.argv.includes('--assign')) {
  const crops = await sideCrops();
  interface SideRep {
    key: string;
    video: string;
    expected: string[];
    reps: { state: 'lit' | 'dim'; h: string; n: number }[];
  }
  const bySide = new Map<string, { expected: string[]; video: string; lit: string[]; dim: string[] }>();
  for (const c of crops) {
    const k = `${c.video}/${c.side}`;
    const s = bySide.get(k) ?? { expected: c.expected, video: c.video, lit: [], dim: [] };
    const bright = c.lum.indexOf(Math.max(...c.lum));
    c.hs.forEach((h, i) => (i === bright ? s.lit : s.dim).push(h));
    bySide.set(k, s);
  }
  const T_GROUP = 10;
  const sides: SideRep[] = [];
  for (const [key, s] of bySide) {
    if (s.lit.length + s.dim.length < 12) continue;
    const reps: SideRep['reps'] = [];
    for (const [state, hs] of [
      ['lit', s.lit],
      ['dim', s.dim],
    ] as ['lit' | 'dim', string[]][]) {
      for (const g of group(hs, T_GROUP).slice(0, 3)) {
        reps.push({ state, h: g.rep, n: g.members.length });
      }
    }
    sides.push({ key, video: s.video, expected: s.expected, reps });
  }
  console.log(`\n  ${sides.length} sides with grouped representatives (t=${T_GROUP})\n`);

  // ── pairwise voting ───────────────────────────────────────────────────────
  const votes = new Map<string, Map<string, number>>(); // repKey -> fighter -> weight
  let pairs = 0;
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const A = sides[i]!;
      const B = sides[j]!;
      if (A.video === B.video) continue;
      const shared = A.expected.filter((e) => B.expected.includes(e));
      if (shared.length !== 1) continue; // exactly one -> its identity is known
      const f = shared[0]!;
      pairs++;
      for (const state of ['lit', 'dim'] as const) {
        const ar = A.reps.filter((r) => r.state === state);
        const br = B.reps.filter((r) => r.state === state);
        if (!ar.length || !br.length) continue;
        let bestA = -1;
        let bestB = -1;
        let bestD = 65;
        for (let ai = 0; ai < ar.length; ai++) {
          for (let bi = 0; bi < br.length; bi++) {
            const d = hamming(ar[ai]!.h, br[bi]!.h);
            if (d < bestD) {
              bestD = d;
              bestA = ai;
              bestB = bi;
            }
          }
        }
        if (bestD > 16) continue; // too far to be evidence of anything
        const w = 1 - bestD / 16;
        for (const [side, idx] of [
          [A, bestA],
          [B, bestB],
        ] as [SideRep, number][]) {
          const rk = `${side.key}/${state}/${idx}`;
          const m = votes.get(rk) ?? new Map<string, number>();
          m.set(f, (m.get(f) ?? 0) + w);
          votes.set(rk, m);
        }
      }
    }
  }
  console.log(`  ${pairs} side-pairs shared exactly one fighter and cast a labelled vote`);

  // ── labels, then templates ────────────────────────────────────────────────
  const labelled: { f: string; state: string; h: string; margin: number }[] = [];
  for (const side of sides) {
    for (const state of ['lit', 'dim'] as const) {
      side.reps
        .filter((r) => r.state === state)
        .forEach((r, idx) => {
          const m = votes.get(`${side.key}/${state}/${idx}`);
          if (!m) return;
          const ranked = [...m].sort((a, b) => b[1] - a[1]);
          // the label must also be one this side could actually field
          const legal = ranked.filter(([f]) => side.expected.includes(f));
          if (!legal.length) return;
          const margin = legal[0]![1] - (legal[1]?.[1] ?? 0);
          labelled.push({ f: legal[0]![0], state, h: r.h, margin });
        });
    }
  }
  const byFighter = new Map<string, { lit: string[]; dim: string[] }>();
  for (const l of labelled) {
    const e = byFighter.get(l.f) ?? { lit: [], dim: [] };
    (l.state === 'lit' ? e.lit : e.dim).push(l.h);
    byFighter.set(l.f, e);
  }
  console.log(
    `  ${labelled.length} groups labelled  ->  templates for ${byFighter.size} of 21 fighters\n`,
  );
  console.log('     fighter            lit crops   dim crops');
  for (const [f, e] of [...byFighter].sort((a, b) => b[1].lit.length + b[1].dim.length - a[1].lit.length - a[1].dim.length)) {
    console.log(`     ${f.padEnd(18)} ${String(e.lit.length).padStart(9)}   ${String(e.dim.length).padStart(9)}`);
  }
  const missing = [...new Set(sides.flatMap((s) => s.expected))].filter((f) => !byFighter.has(f));
  if (missing.length) console.log(`     NO TEMPLATE: ${missing.join(', ')}`);

  // ── leave-one-video-out recall ────────────────────────────────────────────
  let hit = 0;
  let want = 0;
  let sidesScored = 0;
  let exact = 0;
  for (const side of sides) {
    const tpl = new Map<string, string>();
    for (const [f, e] of byFighter) {
      const hs = [...e.lit, ...e.dim];
      if (hs.length) tpl.set(f, majorityHash(hs));
    }
    if (!tpl.size) continue;
    const scores = new Map<string, number>();
    for (const r of side.reps) {
      for (const [f, h] of tpl) {
        const d = hamming(r.h, h);
        scores.set(f, Math.min(scores.get(f) ?? 64, d));
      }
    }
    const pred = [...scores].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([f]) => f);
    hit += pred.filter((p) => side.expected.includes(p)).length;
    want += side.expected.length;
    if (pred.filter((p) => side.expected.includes(p)).length === 3) exact++;
    sidesScored++;
  }
  console.log(
    `\n  top-3 prediction over ${sidesScored} sides: recall ${((100 * hit) / want).toFixed(1)}%  ` +
      `(all three right on ${((100 * exact) / sidesScored).toFixed(1)}% of sides)`,
  );
  console.log('  NOTE: templates here are built from ALL sides including the scored one —');
  console.log('  an upper bound, not the honest number. Step 2 holds the video out.\n');
}

/**
 * DO THE DIAMONDS CARRY IDENTITY ACROSS MATCHES AT ALL?
 *
 * This is the tier's load-bearing assumption and Step 0 never tested it. What Step 0
 * showed was that the same cell in the SAME match hashes consistently once presence
 * is gated (62-72% within 7 bits). Templates need something strictly stronger: that
 * the same FIGHTER hashes consistently in a DIFFERENT uploader's match. The bust
 * clears that bar (12.9 bits cross-channel); nothing yet says the diamonds do, and
 * the transfer test's failure is consistent with them not doing so.
 *
 * It can be tested without solving the assignment problem. Each (video, side) has a
 * known candidate set of 3, so for a pair of sides from different videos let
 * k = |E_A ∩ E_B|. Compare their 3x3 matrix of cell distances: if the art carries
 * identity, pairs sharing fighters must produce closer best-matches than pairs
 * sharing none, and the gap should widen with k. If min-distance is flat in k, the
 * descriptor holds no cross-match identity and no amount of clustering will invent
 * it.
 *
 * The bust runs through the identical statistic as a POSITIVE CONTROL on the
 * instrument — an answer known to be there. A test that cannot detect the bust's
 * signal would say nothing about the diamonds' lack of one.
 */
if (process.argv.includes('--identity')) {
  interface Rec {
    video: string;
    expected: string[];
    point: string;
    cells: string[];
    bust: string;
  }
  const recs: Rec[] = [];
  for (const side of ['L', 'R'] as const) {
    for (const s of await bustSamples(side, 3)) {
      const benches = truthBenches.get(s.video);
      if (!benches) continue;
      const owning = benches.filter((b) => b.includes(s.label));
      if (owning.length !== 1) continue;
      recs.push({
        video: s.video,
        expected: owning[0]!.filter((c) => c !== s.label),
        point: s.label,
        cells: ASSIST_CELLS.map((c) => canon(s, side, c.px, c.py, 22)),
        bust: canon(s, side, 80, 37, 36),
      });
    }
  }
  console.log(`\n  ${recs.length} sides with a known bench and an attributed point fighter\n`);

  const byK = new Map<number, number[]>();
  const closeByK = new Map<number, { close: number; total: number }>();
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const A = recs[i]!;
      const B = recs[j]!;
      if (A.video === B.video) continue;
      const k = A.expected.filter((e) => B.expected.includes(e)).length;
      let min = 64;
      let close = 0;
      for (const a of A.cells) {
        for (const b of B.cells) {
          const d = hamming(a, b);
          if (d < min) min = d;
          if (d <= 7) close++;
        }
      }
      byK.set(k, [...(byK.get(k) ?? []), min]);
      const c = closeByK.get(k) ?? { close: 0, total: 0 };
      closeByK.set(k, { close: c.close + close, total: c.total + 9 });
    }
  }
  console.log('  DIAMONDS — best cell-to-cell match between two sides, by shared fighters');
  console.log('     shared (k)   side-pairs   mean best distance   cell-pairs <=7 bits');
  for (const k of [...byK.keys()].sort()) {
    const ds = byK.get(k)!;
    const c = closeByK.get(k)!;
    console.log(
      `     ${String(k).padStart(6)}       ${String(ds.length).padStart(6)}       ` +
        `${(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(2).padStart(10)}       ` +
        `${((100 * c.close) / c.total).toFixed(2).padStart(8)}%`,
    );
  }

  let sameSum = 0;
  let sameN = 0;
  let diffSum = 0;
  let diffN = 0;
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      if (recs[i]!.video === recs[j]!.video) continue;
      const d = hamming(recs[i]!.bust, recs[j]!.bust);
      if (recs[i]!.point === recs[j]!.point) {
        sameSum += d;
        sameN++;
      } else {
        diffSum += d;
        diffN++;
      }
    }
  }
  console.log(
    `\n  BUST positive control on the same statistic — same point fighter ` +
      `${(sameSum / sameN).toFixed(2)} bits (${sameN}), different ${(diffSum / diffN).toFixed(2)} (${diffN})`,
  );
  console.log('  If the diamond table is flat in k while this gap is wide, the');
  console.log('  instrument works and the diamond descriptor is what does not.\n');
}

/**
 * DOES BUST ART TRANSFER TO THE DIAMONDS?
 *
 * If a bench diamond is a scaled crop of the same portrait the bust draws, then the
 * bust's templates — which the plate labels for free on every frame it resolved —
 * are also the diamonds' templates, and the whole co-occurrence exercise shrinks to
 * covering the gap. It is the cheapest possible route to templates, so it gets
 * tested before anything is built.
 *
 * The test needs no human labels either. For a video whose two benches are known
 * from its DESCRIPTION, the plate names who is on point at a given second; whichever
 * bench contains that fighter is that screen side's team; and the three diamonds
 * must therefore hold the other three. So each diamond crop arrives with a candidate
 * set of exactly 3 out of 21, and the question is whether the nearest bust template
 * falls inside it. Chance is 3/21 = 14.3%.
 *
 * Templates are built LEAVE-ONE-VIDEO-OUT. A template that had seen the very video
 * it is being tested on would be matching a frame against itself, which is the same
 * self-scoring error the truth predicate above fell into.
 */
interface Crop {
  video: string;
  label: string;
  h: string;
}

async function bustCrops(bustS: number): Promise<Crop[]> {
  const out: Crop[] = [];
  for (const side of ['L', 'R'] as const) {
    for (const s of await bustSamples(side, 8)) {
      out.push({
        video: s.video,
        label: s.label,
        h: canon(s, side, 80, 37, bustS),
      });
    }
  }
  return out;
}

/** Per-fighter template = per-bit majority over crops, excluding one video. */
function templatesExcluding(crops: Crop[], skip: string): Map<string, { h: string; n: number }> {
  const by = new Map<string, string[]>();
  for (const c of crops) {
    if (c.video === skip) continue;
    by.set(c.label, [...(by.get(c.label) ?? []), c.h]);
  }
  const out = new Map<string, { h: string; n: number }>();
  for (const [f, hs] of by) out.set(f, { h: majorityHash(hs), n: hs.length });
  return out;
}

if (process.argv.includes('--transfer')) {
  for (const bustS of [40, 56, 72]) {
    const crops = await bustCrops(bustS);
    console.log(
      `\n  bust box ${bustS}px — ${crops.length} plate-labelled crops, ` +
        `${new Set(crops.map((c) => c.label)).size} fighters, ${new Set(crops.map((c) => c.video)).size} videos`,
    );
    let tested = 0;
    let top1 = 0;
    let top3 = 0;
    let rankSum = 0;
    let noCover = 0;
    // POPULARITY CONTROL. `magik` and `spider-man` own far more crops than
    // `peni-parker`, and they are also likelier to sit in any given bench — so a
    // ranking that ignores the pixels entirely and just prefers thick templates
    // would already beat 14.3%. Without this baseline, an above-chance top-1 says
    // nothing about whether the ART transfers.
    let cTop1 = 0;
    let cTop3 = 0;
    for (const side of ['L', 'R'] as const) {
      const samples = await bustSamples(side, 8);
      for (const s of samples) {
        const benches = truthBenches.get(s.video);
        if (!benches) continue;
        // the bench holding the point fighter IS this screen side's team
        const owning = benches.filter((b) => b.includes(s.label));
        if (owning.length !== 1) continue; // both or neither: no attribution
        const expected = owning[0]!.filter((c) => c !== s.label);
        const templates = templatesExcluding(crops, s.video);
        if (expected.some((e) => !templates.has(e))) {
          noCover++;
          continue;
        }
        const byPopularity = [...templates.entries()]
          .sort((a, b) => b[1].n - a[1].n)
          .map(([f]) => f);
        for (const c of ASSIST_CELLS) {
          const h = canon(s, side, c.px, c.py, 22);
          const ranked = [...templates.entries()]
            .map(([f, t]) => ({ f, d: hamming(h, t.h) }))
            .sort((a, b) => a.d - b.d);
          tested++;
          if (expected.includes(ranked[0]!.f)) top1++;
          if (ranked.slice(0, 3).some((r) => expected.includes(r.f))) top3++;
          rankSum += ranked.findIndex((r) => expected.includes(r.f)) + 1;
          if (expected.includes(byPopularity[0]!)) cTop1++;
          if (byPopularity.slice(0, 3).some((f) => expected.includes(f))) cTop3++;
        }
      }
    }
    const chance = (100 * 3) / 21;
    console.log(
      `     diamond crops tested ${tested}  (skipped ${noCover} for template coverage)\n` +
        `     nearest bust template is one of the 3 expected: ${((100 * top1) / (tested || 1)).toFixed(1)}%` +
        `   (chance ${chance.toFixed(1)}%)\n` +
        `     an expected fighter in the top 3:                ${((100 * top3) / (tested || 1)).toFixed(1)}%\n` +
        `     mean rank of the best expected fighter:          ${(rankSum / (tested || 1)).toFixed(1)} of 21\n` +
        `     PIXEL-BLIND popularity control, same sets:      top1 ${((100 * cTop1) / (tested || 1)).toFixed(1)}%` +
        `  top3 ${((100 * cTop3) / (tested || 1)).toFixed(1)}%`,
    );
  }
  console.log('');
}

/**
 * The bust reader, scored the way a reader gets scored: cross-CHANNEL pairs only.
 *
 * Cross-video already excludes the easy case, but two uploads from one channel
 * share an encoder, a bitrate and often an overlay. A fighter looking like
 * themselves in a DIFFERENT uploader's compression is the claim that has to hold,
 * and it is the one the tier will be asked to make on the bench queue.
 */
if (process.argv.includes('--bust-report')) {
  for (const side of ['L', 'R'] as const) {
    const samples = await bustSamples(side, 8);
    const box = cellBox({ px: 80, py: 37 }, side, 56);
    const hs = samples.map((s) => ({
      video: s.video,
      ch: channelOf.get(s.video) ?? '?',
      label: s.label,
      h: hashBoxRaw(s.data, s.W, s.H, box),
    }));
    const same: number[] = [];
    const diff: number[] = [];
    for (let i = 0; i < hs.length; i++) {
      for (let j = i + 1; j < hs.length; j++) {
        if (hs[i]!.ch === hs[j]!.ch) continue; // cross-CHANNEL only
        const d = hamming(hs[i]!.h, hs[j]!.h);
        (hs[i]!.label === hs[j]!.label ? same : diff).push(d);
      }
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    console.log(
      `\n  ${side} bust — cross-CHANNEL pairs: same fighter ${mean(same).toFixed(1)} bits (${same.length})` +
        `  different ${mean(diff).toFixed(1)} bits (${diff.length})`,
    );
    console.log('     gate curve (accept when distance <= t)');
    console.log('       t    recall(same)   false-accept(diff)');
    for (const t of [4, 6, 8, 10, 12, 14, 16, 18]) {
      const rec = (100 * same.filter((d) => d <= t).length) / (same.length || 1);
      const fa = (100 * diff.filter((d) => d <= t).length) / (diff.length || 1);
      console.log(
        `       ${String(t).padStart(2)}   ${rec.toFixed(1).padStart(8)}%   ${fa.toFixed(2).padStart(14)}%`,
      );
    }
    const perF = new Map<string, number>();
    for (const x of hs) perF.set(x.label, (perF.get(x.label) ?? 0) + 1);
    console.log(
      `     crops per fighter: ${[...perF].sort((a, b) => a[1] - b[1]).map(([f, n]) => `${f}:${n}`).join(' ')}`,
    );
  }
  console.log('');
}

/**
 * IS THE UPPER MODE SIMPLY THE CELL NOT BEING THERE?
 *
 * Two modes, ~42% at or under 7 bits and ~44% over 24, and the contrast-invariant
 * hash does not merge them — so the cell really does hold different pixels. Before
 * concluding the icons permute, the cheaper explanation has to be excluded: the
 * cluster is COVERED or absent in a large minority of frames. If visibility is
 * ~65%, then both frames of a pair are clear about 0.65^2 = 42% of the time, which
 * is exactly the lower mode's mass.
 *
 * A per-cell presence test separates the two stories. Each cell is a framed
 * diamond, so its BORDER is constant across matches while its interior is not:
 * the corpus-mean edge map of one cell is therefore mostly border, and a frame
 * whose edge map still correlates with that mean has its cell drawn and unblocked.
 * Restricted to pairs that BOTH pass, the distances must collapse if the icons are
 * reliable — and if they do not, the cells permute after all.
 */
function edgeMap(d: Buffer, W: number, H: number, b: Box): Float64Array {
  const x0 = Math.max(0, Math.round(W * b.x0));
  const y0 = Math.max(0, Math.round(H * b.y0));
  const x1 = Math.min(W - 1, Math.round(W * b.x1));
  const y1 = Math.min(H - 1, Math.round(H * b.y1));
  const cW = x1 - x0;
  const cH = y1 - y0;
  const out = new Float64Array(Math.max(0, cW * cH));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let mn = 255;
      let mx = 0;
      for (let k = -2; k <= 2; k++) {
        const v = d[y * W + Math.min(W - 1, Math.max(0, x + k))]!;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      out[(y - y0) * cW + (x - x0)] = mx - mn > 70 ? 1 : 0;
    }
  }
  return out;
}

const cosine = (a: Float64Array, b: Float64Array): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

if (process.argv.includes('--present')) {
  const samples = await bustSamples('L', 8);
  console.log('\n  per-cell presence, and distances restricted to pairs where BOTH cells are drawn\n');
  for (const c of ASSIST_CELLS) {
    const box = cellBox(c, 'L', 36);
    const maps = samples.map((s) => edgeMap(s.data, s.W, s.H, box));
    const ref = new Float64Array(maps[0]!.length);
    for (const m of maps) for (let i = 0; i < m.length; i++) ref[i]! += m[i]!;
    for (let i = 0; i < ref.length; i++) ref[i]! /= maps.length;
    const sims = maps.map((m) => cosine(m, ref));
    const sorted = sims.slice().sort((a, b) => a - b);
    // Presence cut, swept rather than asserted. Agreement among both-drawn pairs
    // rises MONOTONICALLY as the cut tightens — p25 55/64/55%, p35 61/63/59%,
    // p50 72/71/62%, with the mean distance falling 13.4 -> 9.7 bits — which is
    // what a crop limited by AVAILABILITY looks like, not one limited by geometry.
    const thr = sorted[Math.floor(sorted.length * 0.5)]!;
    const byVideo = new Map<string, { s: Sample; sim: number; h: string }[]>();
    samples.forEach((s, i) => {
      byVideo.set(s.video, [
        ...(byVideo.get(s.video) ?? []),
        // de-rotated cell at the refitted half-diagonal — the fit preferred d=22
        { s, sim: sims[i]!, h: hashDiamond(s.data, s.W, s.H, c.px, c.py, 22) },
      ]);
    });
    let bothSum = 0;
    let bothN = 0;
    let bothLow = 0;
    let elseSum = 0;
    let elseN = 0;
    for (const list of byVideo.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i]!.s.label !== list[j]!.s.label) continue;
          const dd = hamming(list[i]!.h, list[j]!.h);
          if (list[i]!.sim > thr && list[j]!.sim > thr) {
            bothSum += dd;
            bothN++;
            if (dd <= 7) bothLow++;
          } else {
            elseSum += dd;
            elseN++;
          }
        }
      }
    }
    console.log(
      `     ${c.name.padEnd(8)} presence sim median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(2)}` +
        `  thr ${thr.toFixed(2)}  |  both-drawn mean ${(bothSum / bothN).toFixed(1)} bits (${bothN} pairs, ${((100 * bothLow) / bothN).toFixed(0)}% <=7)` +
        `  |  otherwise ${(elseSum / (elseN || 1)).toFixed(1)} bits (${elseN})`,
    );
  }
  console.log('');
}

/**
 * IS THE BIMODALITY A CONTRAST STATE RATHER THAN A DIFFERENT FIGHTER?
 *
 * The single-frame crops show two of the three bench diamonds DESATURATED and one
 * rendered at full colour inside a border in the side's own hue (orange left, blue
 * right). If that highlight moves between cells during a match, one cell holds the
 * same fighter rendered two different ways — and `dhash` would call that a
 * different fighter, because it thresholds edge density at the crop's own MEAN, so
 * a dimmer rendering crosses the threshold in fewer cells.
 *
 * The test is a contrast-invariant variant of the same hash: threshold the local
 * range at a fraction of the crop's OWN p95 range instead of the absolute 70 that
 * the nameplate reader uses. If the upper mode collapses, the icons were always
 * readable and the fix is one constant. If it does not, the two modes are two
 * different fighters and the cells genuinely permute.
 */
function hashBoxAdaptive(d: Buffer, W: number, H: number, b: Box, frac = 0.35): string {
  const x0 = Math.max(0, Math.round(W * b.x0));
  const y0 = Math.max(0, Math.round(H * b.y0));
  const x1 = Math.min(W - 1, Math.round(W * b.x1));
  const y1 = Math.min(H - 1, Math.round(H * b.y1));
  const cW = x1 - x0;
  const cH = y1 - y0;
  if (cW < 8 || cH < 8) return '0'.repeat(64);
  const ranges: number[] = [];
  const at: number[] = [];
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 2; x < x1 - 2; x++) {
      let mn = 255;
      let mx = 0;
      for (let k = -2; k <= 2; k++) {
        const v = d[y * W + x + k]!;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      ranges.push(mx - mn);
      at.push(y * W + x);
    }
  }
  const sorted = ranges.slice().sort((a, b2) => a - b2);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const thr = Math.max(20, frac * p95);
  const cells = new Float64Array(64);
  const counts = new Float64Array(64);
  for (let i = 0; i < ranges.length; i++) {
    const idx = at[i]!;
    const x = idx % W;
    const y = (idx - x) / W;
    const gy = Math.min(7, Math.floor(((y - y0) / cH) * 8));
    const gx = Math.min(7, Math.floor(((x - x0) / cW) * 8));
    cells[gy * 8 + gx]! += ranges[i]! > thr ? 1 : 0;
    counts[gy * 8 + gx]! += 1;
  }
  const dens = Array.from(cells, (v, i) => (counts[i] ? v / counts[i]! : 0));
  const mean = dens.reduce((a, b2) => a + b2, 0) / 64;
  return dens.map((v) => (v > mean ? '1' : '0')).join('');
}

if (process.argv.includes('--state')) {
  const BUCKETS = [0, 4, 8, 12, 16, 20, 24, 64];
  const histo = (xs: number[]): string => {
    const h = new Array<number>(BUCKETS.length - 1).fill(0);
    for (const x of xs) {
      for (let i = BUCKETS.length - 2; i >= 0; i--) {
        if (x >= BUCKETS[i]!) {
          h[i]!++;
          break;
        }
      }
    }
    return h
      .map((n, i) => `${BUCKETS[i]}-${BUCKETS[i + 1]! - 1}:${((100 * n) / xs.length).toFixed(0)}%`)
      .join('  ');
  };
  const samples = await bustSamples('L', 8);
  const byVideo = new Map<string, Sample[]>();
  for (const s of samples) byVideo.set(s.video, [...(byVideo.get(s.video) ?? []), s]);
  console.log('\n  same-point within-video distances, absolute vs contrast-invariant hash\n');
  for (const [name, fn] of [
    ['absolute (dhash, thr=70)', (s: Sample, b: Box) => hashBoxRaw(s.data, s.W, s.H, b)],
    ['adaptive (thr=0.35*p95)', (s: Sample, b: Box) => hashBoxAdaptive(s.data, s.W, s.H, b)],
  ] as [string, (s: Sample, b: Box) => string][]) {
    for (const c of [...ASSIST_CELLS, { name: 'top(bust)', px: 80, py: 37 }]) {
      const box = cellBox(c, 'L', 36);
      const ds: number[] = [];
      for (const list of byVideo.values()) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            if (list[i]!.label !== list[j]!.label) continue;
            ds.push(hamming(fn(list[i]!, box), fn(list[j]!, box)));
          }
        }
      }
      console.log(`     ${name.padEnd(25)} ${c.name.padEnd(10)} ${histo(ds)}`);
    }
    console.log('');
  }
}

/**
 * THE CHROME CROSS IS A FREE OCCLUSION DETECTOR.
 *
 * The lattice's centre cross is drawn identically in every match — that is why it
 * scored near zero on the between-video statistic and why it was useless as a
 * cell. That same property makes it the perfect reference: take the per-bit
 * MAJORITY hash across the corpus and any frame whose centre deviates from it has
 * something in front of the cluster. No labels, no threshold asserted, and it
 * measures the one thing a portrait reader must know before it trusts a crop.
 */
function majorityHash(hs: string[]): string {
  let out = '';
  for (let i = 0; i < 64; i++) {
    let ones = 0;
    for (const h of hs) if (h[i] === '1') ones++;
    out += ones * 2 >= hs.length ? '1' : '0';
  }
  return out;
}

if (process.argv.includes('--occl')) {
  const chrome = CELLS.find((c) => c.name === 'centre-chrome')!;
  for (const side of ['L', 'R'] as const) {
    const samples = await bustSamples(side, 8);
    const box = cellBox(chrome, side);
    const hs = samples.map((s) => ({
      video: s.video,
      ch: channelOf.get(s.video) ?? '?',
      h: hashBoxRaw(s.data, s.W, s.H, box),
    }));
    const ref = majorityHash(hs.map((x) => x.h));
    const byCh = new Map<string, number[]>();
    for (const x of hs) byCh.set(x.ch, [...(byCh.get(x.ch) ?? []), hamming(x.h, ref)]);
    console.log(`\n  ${side} corner — distance of the lattice's centre chrome from the corpus majority`);
    console.log('     channel               frames   median   p90    clear(<=8)   covered(>16)');
    for (const [ch, ds] of [...byCh].sort((a, b) => b[1].length - a[1].length)) {
      const s = ds.slice().sort((a, b) => a - b);
      const med = s[Math.floor(s.length / 2)]!;
      const p90 = s[Math.floor(s.length * 0.9)]!;
      const clear = (100 * ds.filter((d) => d <= 8).length) / ds.length;
      const cov = (100 * ds.filter((d) => d > 16).length) / ds.length;
      console.log(
        `     ${ch.padEnd(20)} ${String(ds.length).padStart(5)}  ${String(med).padStart(6)}  ${String(p90).padStart(5)}` +
          `   ${clear.toFixed(0).padStart(8)}%   ${cov.toFixed(0).padStart(10)}%`,
      );
    }
  }
  console.log('');
}

/** The sides the nameplate reader could never read. Does their HUD carry the
 *  cluster at all? If it does, the portrait tier reaches them; if the corner is
 *  empty they are review-permanent, and either way it is a measurement. */
if (process.argv.includes('--zero')) {
  const chrome = CELLS.find((c) => c.name === 'centre-chrome')!;
  const refs: Record<'L' | 'R', string> = { L: '', R: '' };
  for (const side of ['L', 'R'] as const) {
    const s = await bustSamples(side, 4);
    refs[side] = majorityHash(s.map((x) => hashBoxRaw(x.data, x.W, x.H, cellBox(chrome, side))));
  }
  console.log('  sides that produced ZERO resolved plate reads, and what their corner holds\n');
  console.log('     video        channel            hud  frames  side  chrome-dist  verdict');
  for (const [id, e] of Object.entries(extracted)) {
    for (const side of ['L', 'R'] as const) {
      const reads = side === 'L' ? e.left : e.right;
      if (!reads.length || reads.some((r) => r.id)) continue;
      if (e.hud < 10) continue; // too few HUD frames to be a category
      const secs = reads.slice(0, 8).map((r) => r.sec);
      const ds: number[] = [];
      for (const sec of secs) {
        try {
          const { data, info } = await sharp(frameFile(id, sec))
            .greyscale()
            .raw()
            .toBuffer({ resolveWithObject: true });
          if (info.width !== 1280) continue;
          ds.push(
            hamming(hashBoxRaw(data, info.width, info.height, cellBox(chrome, side)), refs[side]),
          );
        } catch {
          /* skip */
        }
      }
      const med = ds.length ? ds.slice().sort((a, b) => a - b)[Math.floor(ds.length / 2)]! : -1;
      console.log(
        `     ${id.padEnd(12)} ${(channelOf.get(id) ?? '?').padEnd(18)} ${String(e.hud).padStart(4)}` +
          `  ${String(e.frames).padStart(6)}  ${side}     ${String(med).padStart(9)}  ` +
          `${med < 0 ? 'no frames' : med <= 10 ? 'STANDARD cluster present' : 'different/occluded'}`,
      );
    }
  }
  console.log('');
}

/**
 * Montage: candidate boxes (columns) x videos (rows), so what is actually inside
 * a box can be checked against what the statistics claim about it. Every silent
 * defect in this project was caught this way.
 */
if (process.argv.includes('--montage')) {
  mkdirSync(OUT, { recursive: true });
  const BOXES = CELLS.map((c) => ({ name: c.name, px: c.px, py: c.py, S: CELL_S }));
  const Z = 4;
  const rows: string[] = [];
  const tiles: OverlayOptions[] = [];
  let r = 0;
  for (const [id, e] of Object.entries(extracted)) {
    if (!e.geom || r >= 5) continue;
    const hit = e.left.find((x) => x.id && x.dist === 0);
    if (!hit) continue;
    let c = 0;
    for (const b of BOXES) {
      const buf = await sharp(frameFile(id, hit.sec))
        .extract({
          left: Math.round(b.px - b.S / 2),
          top: Math.round(b.py - b.S / 2),
          width: b.S,
          height: b.S,
        })
        .resize({ width: b.S * Z, kernel: 'nearest' })
        .png()
        .toBuffer();
      tiles.push({ input: buf, left: c * 44 * Z + 8, top: r * 44 * Z + 8 });
      c++;
    }
    rows.push(`row ${r}: ${id} @${hit.sec}s point=${hit.id}`);
    r++;
  }
  await sharp({
    create: { width: BOXES.length * 44 * Z + 16, height: r * 44 * Z + 16, channels: 3, background: '#101014' },
  })
    .composite(tiles)
    .png()
    .toFile(join(OUT, 'montage.png'));
  console.log(`  columns: ${BOXES.map((b) => b.name).join('  ')}`);
  for (const l of rows) console.log(`  ${l}`);
  console.log(`\n✔ ${join(OUT, 'montage.png')}\n`);
}

/** Connected components of `score > t`, reported numerically — an ASCII map is
 *  for seeing that something is there, not for writing geometry down from. */
function components(score: Float64Array, w: number, h: number, t: number) {
  const seen = new Uint8Array(w * h);
  const out: { n: number; cx: number; cy: number; x0: number; x1: number; y0: number; y1: number }[] =
    [];
  for (let i = 0; i < score.length; i++) {
    if (seen[i] || score[i]! <= t) continue;
    const stack = [i];
    seen[i] = 1;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      n++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as [number, number][]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (seen[k] || score[k]! <= t) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    if (n >= 60) out.push({ n, cx: sx / n, cy: sy / n, x0, x1, y0, y1 });
  }
  return out.sort((a, b) => b.n - a.n);
}

if (process.argv.includes('--comp')) {
  for (const side of ['L', 'R'] as const) {
    const { score, w, h, nVid } = await cellScore(side);
    const sorted = Array.from(score).sort((a, b) => a - b);
    console.log(`\n  ${side} corner — components of the between/within score (${nVid} videos)`);
    for (const q of [0.97, 0.98, 0.99]) {
      const t = sorted[Math.floor(sorted.length * q)]!;
      const comps = components(score, w, h, t);
      console.log(`   t=p${(q * 100).toFixed(0)}=${t.toFixed(2)}  ->  ${comps.length} component(s)`);
      for (const c of comps.slice(0, 6)) {
        console.log(
          `      n=${String(c.n).padStart(4)}  centre (${c.cx.toFixed(0)},${c.cy.toFixed(0)})  ` +
            `bbox x ${c.x0}..${c.x1}  y ${c.y0}..${c.y1}  ` +
            `(${(c.x1 - c.x0 + 1)}x${c.y1 - c.y0 + 1} px)`,
        );
      }
    }
  }
  console.log('');
}

if (process.argv.includes('--cells')) {
  const RAMP = ' .:-=+*#%@';
  for (const side of ['L', 'R'] as const) {
    const { score, w, h, nVid } = await cellScore(side);
    const sorted = Array.from(score).sort((a, b) => a - b);
    const hi = sorted[Math.floor(sorted.length * 0.995)]!;
    console.log(
      `\n  ${side} corner — between/within score over ${nVid} videos ` +
        `(x0=${side === 'L' ? 0 : 0.86}, ${w}x${h} px, p99.5=${hi.toFixed(2)})`,
    );
    let hdr = '      ';
    for (let x = 0; x < w; x += 3) hdr += x % 30 === 0 ? String(x / 10).padEnd(1) : ' ';
    console.log(`${hdr}   (col labels = x/10 in frame px)`);
    for (let y = 0; y < h; y += 3) {
      let row = '';
      for (let x = 0; x < w; x += 3) {
        const v = Math.min(1, score[y * w + x]! / hi);
        row += RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
      }
      console.log(`  ${String(y).padStart(3)} ${row}`);
    }
  }
  console.log('');
}

if (process.argv.includes('--map')) {
  // The nameplate shares the window and is axis-aligned, so it smears broad
  // ridges through both diagonal accumulators and the peak list stops being a
  // lattice (measured: u spacings 61 14 34 10 15). Reading the averaged image
  // off a labelled grid is exact where the peak-finder was not.
  const RAMP = ' .:-=+*#%@';
  for (const side of ['L', 'R'] as const) {
    const { edge, w, h, n } = await meanCorner(side);
    let hi = 0;
    for (const v of edge) if (v > hi) hi = v;
    console.log(`\n  ${side} corner — mean edge mask over ${n} frames (x0=${side === 'L' ? 0 : 0.86}, ${w}x${h} px)`);
    let hdr = '      ';
    for (let x = 0; x < w; x += 3) hdr += x % 30 === 0 ? String(x / 10).padEnd(1) : ' ';
    console.log(`${hdr}   (col labels = x/10 in frame px)`);
    for (let y = 0; y < h; y += 3) {
      let row = '';
      for (let x = 0; x < w; x += 3) {
        const v = edge[y * w + x]! / hi;
        row += RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
      }
      console.log(`  ${String(y).padStart(3)} ${row}`);
    }
  }
  console.log('');
}

if (process.argv.includes('--geom')) {
  console.log('lattice lines from the MEAN corner (frame px; u = x+y, v = x-y+h)\n');
  for (const side of ['L', 'R'] as const) {
    const { edge, w, h, n } = await meanCorner(side);
    const { u, v } = latticeOf(edge, w, h);
    const up = topPeaks(u);
    const vp = topPeaks(v);
    console.log(`  ${side}  (${n} frames, window ${w}x${h} px, x0=${side === 'L' ? 0 : 0.86})`);
    console.log(`     u lines: ${up.map((p) => `${p.at}(${p.val.toFixed(2)})`).join('  ')}`);
    console.log(`     v lines: ${vp.map((p) => `${p.at}(${p.val.toFixed(2)})`).join('  ')}`);
    // consecutive spacings say whether this is a regular lattice and its pitch
    const sp = (ps: { at: number }[]) => ps.slice(1).map((p, i) => p.at - ps[i]!.at);
    console.log(`     u spacing: ${sp(up).join(' ')}    v spacing: ${sp(vp).join(' ')}`);
  }
  console.log('');
}

if (DUMP) {
  mkdirSync(OUT, { recursive: true });
  const Z = 6; // nearest-neighbour upscale, so pixel edges stay visible
  for (const p of picks()) {
    const f = frameFile(p.id, p.sec);
    const m = await sharp(f).metadata();
    const W = m.width!;
    const H = m.height!;
    for (const [side, x0, x1] of [
      ['L', 0.0, 0.14],
      ['R', 0.86, 1.0],
    ] as [string, number, number][]) {
      const left = Math.round(W * x0);
      const width = Math.round(W * (x1 - x0));
      await sharp(f)
        .extract({ left, top: 0, width, height: Math.round(H * 0.21) })
        .resize({ width: width * Z, kernel: 'nearest' })
        .png()
        .toFile(join(OUT, `corner-${p.ch}-${side}.png`));
    }
    console.log(
      `${p.ch.padEnd(18)} ${p.id} @${String(p.sec).padStart(4)}s  ` +
        `plate-left=${p.plate.padEnd(14)} rx=${extracted[p.id]!.geom!.rightX1.toFixed(4)}`,
    );
  }
  console.log(`\n✔ ${OUT} — ${picks().length * 2} crops\n`);
}

export {};
