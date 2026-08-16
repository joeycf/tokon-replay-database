/**
 * Reading the Tōkon HUD: frame geometry, plate boxes, perceptual hashing.
 *
 * These primitives were derived in scripts/spike/sweep.ts and moved here when a
 * production reader needed them. The spike now imports FROM this file rather
 * than the other way round, so there is one definition of where a plate is.
 *
 * WHAT THE SWEEP SETTLED (10 VODs, 5 channels, committed in 4473680):
 * one box serves every channel — band y0 spread 0.006, y1 spread 0.001, right
 * anchor spread 0.015 — so the crop config does NOT key by ChannelKey. UI is
 * Latin on all ten. Uploaders trim the pre-match screens, so no text list of all
 * eight fighters is present IN THESE UPLOADS (not a claim about the game).
 */

import { readdirSync } from 'node:fs';

import sharp from 'sharp';

// ── the local-range filter ──────────────────────────────────────────────────
// The glyphs are a heavy condensed face with a hard outline, so they sustain
// high local contrast in a way live art does not. Raw brightness does NOT
// separate them (measured: 1.3% bright pixels inside the plate vs 0.9% just
// above it).
const RANGE_MIN = 70;
const ROW_INK_MIN = 0.1;
// The row window is narrow and left-anchored on purpose. Too wide and a SHORT
// name falls under the threshold: "LOKI" is a third the width of "BLACK
// PANTHER", so over a wide window its edge density reads as background and the
// detector drops to the player-handle row below — which looks exactly like
// framing variance and is not.
const ROW_X0 = 0.1;
const ROW_X1 = 0.26;
const COL_INK_MIN = 0.22;
const COL_GAP = 10; // px gap tolerated inside one run (inter-word space)

/** The column scan is bounded to exclude the CORNER BENCH-PORTRAIT CLUSTERS.
 *
 *  Tōkon draws a four-icon diamond cluster of the side's bench in each top
 *  corner, inside the same band as the nameplate. `run()` returns the LONGEST
 *  ink run in its window, and that cluster is dense hard-edged art — so whenever
 *  a fighter's name is short the cluster outruns it and becomes "the nameplate".
 *  Three ground-truth videos read NOTHING across 59-71 HUD frames because of it,
 *  and since the production anchor derives leftX0 = 1 - rightX1, one plate's
 *  error destroyed the other too.
 *
 *  THE RIGHT NAMEPLATE IS RIGHT-ALIGNED AT A FIXED FRACTION. Dumping every run
 *  rather than the winner shows the name ending at 0.8977 over and over, with
 *  the cluster a SEPARATE run starting ~0.911. So the bound goes just past the
 *  name, not into the gap between the two clusters:
 *
 *      name run ends      0.8969 .. 0.9148   (48 videos)
 *      cluster run starts 0.9109 .. 0.9234   (observed)
 *
 *  0.91 excludes the cluster while keeping every observed name. A wider bound
 *  does not work: at 0.94 the cluster is merely CLIPPED rather than excluded,
 *  and a clipped cluster still won the longest-run test on three videos
 *  (measured rightX1 0.9383-0.9398, i.e. pressed flat against the bound).
 *
 *  Rejecting runs that touch a window boundary was tried and is worse: COL_GAP
 *  merges the nameplate with the health bar beside it, so real names touch the
 *  inner edge routinely and the detector fell through to health-bar segments
 *  (rightX1 collapsed to 0.61, leftX0 rose to 0.39). Reverted.
 *
 *  The LEFT bound is cosmetic — production reads only `rightX1` and derives the
 *  left anchor from it. The left cluster ABUTS its name with no usable gap, so
 *  the left run is the two merged and pins to whatever the window start is. That
 *  is also why there is no symmetry gate below: a check needs two independent
 *  opinions and the left one is not independent. */
const NAME_X_MIN = 0.085;
const NAME_X_MAX = 0.91;

/** Trust band on the measured right anchor.
 *
 *  A SANITY GATE NEEDS A MEASURED GAP, NOT A PLAUSIBLE RULE. The obvious check
 *  — "leftX0 and 1-rightX1 should agree" — was tried and rejected: it flagged
 *  five videos whose rightX1 was perfectly healthy and whose leftX0 was merely
 *  portrait-contaminated, i.e. whose derived geometry was already correct. A
 *  gate that fires on good input teaches you to ignore it.
 *
 *  This one keys on the quantity production actually uses. Across 48 cached
 *  videos the real anchor sits in 0.8969-0.9148; the three failures sat at
 *  0.9727-0.9898, a 0.058-wide gap away. [0.88, 0.92] holds every real
 *  measurement with room and excludes every failure seen so far. Outside it the
 *  geometry is not trusted and the video routes to review rather than being read
 *  through a box that is somewhere else. */
export const RIGHT_ANCHOR_MIN = 0.88;
export const RIGHT_ANCHOR_MAX = 0.92;

/** Is this video's measured geometry trustworthy enough to read through? */
export const geometryOk = (g: PlateGeom | null): boolean =>
  g !== null && g.rightX1 >= RIGHT_ANCHOR_MIN && g.rightX1 <= RIGHT_ANCHOR_MAX;

/** Plate width as a frame fraction — generous enough for CAPTAIN AMERICA. */
export const PLATE_W = 0.145;
/** Vertical slack around the measured band, so a descender is not clipped. */
export const PAD_Y = 0.006;

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface FrameMeasure {
  hud: boolean;
  band?: { y0: number; y1: number };
  left?: Box;
  right?: Box;
  letterbox: { top: number; bottom: number };
}

export async function grey(file: string) {
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

/** Minimum span, in rows, of the band the nameplate occupies. */
export const BAND_MIN_SPAN = 8;

/**
 * The TOPMOST band tall enough to be the nameplate, or null.
 *
 * Topmost, not densest: the nameplate is always the first text below the frame
 * top, while the densest band is the player-handle row plus the health-bar
 * segments under it, which wins whenever the fighter's name is short. Picking by
 * density silently measured the wrong row on one channel and read as framing
 * variance.
 *
 * ONE THRESHOLD, AND IT KEEPS SCANNING. The first version accepted a band at a
 * span of 6, `break`, and then rejected it for spanning under 8 — so any frame
 * whose topmost band was 6 or 7 rows was discarded outright and the real
 * nameplate below it was never reached. Measured on ZKFk4K20cG4/26: the topmost
 * band is seven rows of faint 0.10-0.15 ink at the very top of the frame, the
 * actual nameplate sits at rows 18-34 with ink of 0.46, and the frame was
 * dropped with SPIDER-MAN and GREEN GOBLIN plainly rendered in it.
 *
 * Using the stricter of the two constants keeps this STRICTLY ADDITIVE: a frame
 * that passed before had a first-span-6 band that also spanned 8, so this finds
 * the same band first. Only rejected frames can become admitted — verified
 * across the corpus, not assumed.
 *
 * Exported so the gate can be driven by a synthetic profile rather than only by
 * whatever the corpus happens to contain (scripts/spike/fold-cases.ts).
 */
export function bandOf(rows: number[]): [number, number] | null {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]! < ROW_INK_MIN) continue;
    let j = i;
    while (j + 1 < rows.length && rows[j + 1]! >= ROW_INK_MIN) j++;
    if (j - i >= BAND_MIN_SPAN) return [i, j];
    i = j;
  }
  return null;
}

/** Locate the nameplate band and both ink runs. `hud: false` means this frame
 *  carries no nameplate at all — a K.O. card, a round banner, a replay cut. */
export function measure(d: Buffer, W: number, H: number): FrameMeasure {
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
  const best = bandOf(rows);
  if (!best) return { hud: false, letterbox: lb };
  const by0 = y0 + best[0];
  const by1 = y0 + best[1];

  const run = (xa: number, xb: number) => {
    const lo = Math.round(W * xa);
    const hi = Math.ceil(W * xb) - 1;
    const cols: [number, number][] = [];
    for (let x = lo; x <= hi; x++) {
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

  const l = run(NAME_X_MIN, 0.46);
  const r = run(0.54, NAME_X_MAX);
  if (!l || !r) return { hud: false, letterbox: lb };
  return {
    hud: true,
    band: { y0: by0 / H, y1: by1 / H },
    left: { x0: l[0] / W, x1: l[1] / W, y0: by0 / H, y1: by1 / H },
    right: { x0: r[0] / W, x1: r[1] / W, y0: by0 / H, y1: by1 / H },
    letterbox: lb,
  };
}

/** Which end of each plate is trusted as the anchor.
 *
 *  'measured' takes each side's own ink-start/ink-end, which is what the sweep
 *  reported. It is sound on the RIGHT (spread 0.015 across ten VODs) and NOT on
 *  the LEFT (0.054–0.108): the bench portraits sit left of the name and drag the
 *  left ink-start by a variable amount, so the box wanders with the art rather
 *  than with the frame.
 *
 *  'symmetric' derives the left anchor from the clean right one, `x0 = 1 - x1`.
 *  That is a hypothesis about HUD symmetry, tested in scripts/spike/anchor.ts
 *  rather than assumed. */
export type Anchor = 'measured' | 'symmetric';

export interface PlateGeom {
  bandY0: number;
  bandY1: number;
  leftX0: number;
  rightX1: number;
}

/** The two plate crops for a video, from its per-video median geometry.
 *
 *  ONE BOX PER VIDEO, not one per frame. Re-measuring per frame does not
 *  cluster: the box width tracks the NAME, so the crop geometry changes with the
 *  content it is trying to identify and every frame hashes differently. */
export function platesOf(g: PlateGeom, anchor: Anchor = 'symmetric'): { left: Box; right: Box } {
  const y0 = g.bandY0 - PAD_Y;
  const y1 = g.bandY1 + PAD_Y;
  const lx = anchor === 'symmetric' ? 1 - g.rightX1 : g.leftX0;
  return {
    left: { x0: lx, x1: lx + PLATE_W, y0, y1 },
    right: { x0: g.rightX1 - PLATE_W, x1: g.rightX1, y0, y1 },
  };
}

/**
 * 8×8 hash of the crop's EDGE MASK — distinct plates without reading them.
 *
 * Hashing greyscale directly does not work here: the plate is drawn over live
 * gameplay, so the hash tracks the background and reports ~20 distinct images
 * for a side that can field at most five fighters. The glyph EDGES are the part
 * that belongs to the name, so the mask is what gets hashed.
 *
 * RETURNS 64 CHARACTERS OF '0'/'1', NOT A PACKED NUMBER. The first version
 * returned base-36 and compared it with `BigInt(parseInt(h, 36))`; `parseInt`
 * returns a double, so a 64-bit hash lost its low ~11 bits before the Hamming
 * compare and distinct plates were UNDER-counted. The reported "median 4.0
 * distinct plates per side" then landed exactly on the number the four-fighter
 * prior predicted — a number that confirms a prior via a precision bug. A bit
 * string cannot round.
 */
export async function dhash(file: string, b: Box): Promise<string> {
  const m = await sharp(file).metadata();
  const W = m.width!;
  const H = m.height!;
  const cw = Math.max(8, Math.round(W * (b.x1 - b.x0)));
  const chh = Math.max(8, Math.round(H * (b.y1 - b.y0)));
  const { data, info } = await sharp(file)
    .extract({
      left: Math.max(0, Math.round(W * b.x0)),
      top: Math.max(0, Math.round(H * b.y0)),
      width: Math.min(cw, W - Math.max(0, Math.round(W * b.x0))),
      height: Math.min(chh, H - Math.max(0, Math.round(H * b.y0))),
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cW = info.width;
  const cH = info.height;
  const at = (x: number, y: number) => data[y * cW + x]!;
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
  return dens.map((v) => (v > mean ? '1' : '0')).join('');
}

/** Hamming distance over two 64-bit strings. Exact by construction. */
export function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * Cluster plate hashes; distinct clusters ≈ distinct fighters seen on that side.
 *
 * The threshold is 18 of 64 bits because that is the middle of a measured
 * PLATEAU, not a tuned peak. A knife-edge threshold would mean the signal was
 * noise; a plateau two steps wide means the clusters are real. Re-swept after
 * the hash fix — see scripts/spike/README.md for the corrected table.
 */
export const HAMMING_MAX = 18;

export function distinct(hashes: string[], maxDist = HAMMING_MAX): number {
  const reps: string[] = [];
  for (const h of hashes) {
    if (!reps.some((r) => hamming(h, r) <= maxDist)) reps.push(h);
  }
  return reps.length;
}

// ── OCR preparation ─────────────────────────────────────────────────────────

// `WHITELIST` and `norm` live in roster.ts beside the plate keys they have to
// agree with — the whitelist, the normalise class and the keys are one contract,
// and splitting them across files is how they drift.
export { norm, WHITELIST } from './roster';

const UPSCALE = 4;

/** One preprocessing variant of one plate crop.
 *
 *  `threshold: 0` means normalise instead of hard-threshold. Both POLARITIES are
 *  tried because Tōkon's glyphs are a mid-dark fill inside a bright outline —
 *  the opposite of the sibling whose near-white-on-dark plates justified its
 *  unconditional negate. */
export async function prep(
  file: string,
  b: Box,
  threshold: number,
  negate: boolean,
): Promise<Buffer> {
  const m = await sharp(file).metadata();
  const W = m.width!;
  const H = m.height!;
  const left = Math.max(0, Math.round(b.x0 * W));
  const top = Math.max(0, Math.round(b.y0 * H));
  const base = sharp(file)
    .extract({
      left,
      top,
      width: Math.min(Math.round((b.x1 - b.x0) * W), W - left),
      height: Math.min(Math.round((b.y1 - b.y0) * H), H - top),
    })
    .resize({ width: Math.round((b.x1 - b.x0) * W * UPSCALE), kernel: 'lanczos3' })
    .greyscale();
  const toned = threshold > 0 ? base.threshold(threshold) : base.normalise();
  return (negate ? toned.negate() : toned).png().toBuffer();
}

/** Every cached frame for an id whose second is listed, in timestamp order. */
export function framesAt(dir: string, secs: number[]): string[] {
  const want = new Set(secs.map((s) => `${String(Math.round(s)).padStart(6, '0')}.png`));
  try {
    return readdirSync(dir)
      .filter((f) => want.has(f))
      .sort()
      .map((f) => `${dir}/${f}`);
  } catch {
    return [];
  }
}

// ── the fold ────────────────────────────────────────────────────────────────
//
// THE SIBLINGS' FOLD DOES NOT PORT, AND NOT ONLY FOR THE REASON IT LOOKS LIKE.
//
// In SF6, Tekken and 2XKO a side's character is CONSTANT within a game, so a set
// is a few long segments and contiguity separates real play from noise: "real
// play occupies a contiguous stretch of the timeline, noise is isolated."
//
// Here the plate CYCLES BY DESIGN. A side fields four fighters and tags between
// them constantly, so a genuine tag-in can occupy a single sampled frame and the
// contiguity prior inverts — run-length would drop exactly the members this
// reader exists to find. That much was clear before any code.
//
// Working the arithmetic showed the rest of the formula fails with it:
//
//   · `min(1, frames / MIN_FRAMES)` is DEAD CODE behind its own membership gate.
//     Members are filtered at `frames >= MIN_FRAMES`, so the factor is 1 for
//     every member that survives. (It is dead in SF6 too, where `min(1, run /
//     MIN_RUN)` sits behind `run >= MIN_RUN`.) A member's score therefore has no
//     dependence at all on how much evidence supports it.
//   · `1 - mean(dist)/3` CONVERGES TO A CONSTANT rather than to 1. As reads
//     accumulate the mean tends to E[dist | legible], a number set by the OCR
//     error mix, so more evidence makes a middling score more certain instead of
//     making a good one better. A confidence should concentrate with evidence.
//   · `min` over members then STRUCTURALLY PREFERS INCOMPLETE ANSWERS: the same
//     evidence budget split four ways clears a fixed threshold far less often
//     than the same budget on one member, so the gate rewards under-reading.
//   · `dropped ? confidence / 2` fires HARDEST ON NEAR-COMPLETE SIDES, because
//     the fourth fighter — smallest share of point time — is precisely the one
//     that lands in one frame and gets dropped.
//   · `coverage = min(1, read / 8)` is INERT where it matters: four members at
//     two frames each means `read >= 8` on every complete union, so the term is
//     1 exactly when it was meant to discriminate and a flat penalty otherwise.
//
// So: score and gate a member on ONE axis, so `min` is bounded below by the gate
// and cannot fall as the union grows. What survives from the siblings is the
// shape of the evidence — edit distance, min-over-members, first-appearance
// order, and the prudence constant AUTO_ACCEPT.

/** P(this read is right | it landed `d` edits from a plate key).
 *
 *  EXACTNESS IS THE DISCRIMINATOR A PHANTOM CANNOT FAKE, and it is what replaces
 *  contiguity. A phantom is minted by corruption, so it is d>=1 by construction;
 *  an exact phantom would require OCR to print another fighter's whole canonical
 *  name, and the two plate crops are 0.145 wide at opposite ends of the frame so
 *  they cannot see each other. A real member with two legible reads yields at
 *  least one exact read the large majority of the time.
 *
 *  Parameterised as Q0 * DECAY^d rather than three free constants, so it stays
 *  monotone by construction and extends to whatever budget the radius cap
 *  allows. Both are FITTED in scripts/spike/accuracy.ts, never asserted. */
export const Q0 = 0.55;
export const DECAY = 0.8;
export const q = (d: number): number => Q0 * DECAY ** d;

/** Floor on the ensemble-agreement factor. A read that only one preprocessing
 *  variant produced still counts, but for less than one every variant agreed on.
 *  The siblings compute `votes`/`of` and then never use them; here it is the
 *  cheapest signal available and it costs nothing. */
export const VOTE_FLOOR = 0.6;

/** A member must reach this to be part of the union. Gate and score share an
 *  axis on purpose — see the block comment above.
 *
 *  Q0, DECAY and MEMBER_MIN are not independent. Four structural constraints tie
 *  them together, all asserted in scripts/spike/fold-cases.ts:
 *
 *    (a) one exact read alone is NOT a member          Q0 < MEMBER_MIN
 *    (b) two exact reads in separate bursts ARE        1−(1−Q0)² ≥ MEMBER_MIN
 *    (c) two correlated one-edit reads in ONE burst    q(1)·(1+β(1−q(1))) < MEMBER_MIN
 *        are NOT
 *    (d) two one-edit reads in SEPARATE bursts ARE     1−(1−q(1))² ≥ MEMBER_MIN
 *
 *  (a) and (b) are decision #2's "≥2 evidence" rule, expressed on the score axis
 *  instead of as a frame count. (c) and (d) are the correlated-phantom pair, and
 *  they are the reason β cannot be 1: at full independence the two are the SAME
 *  arithmetic and no choice of the other constants separates them.
 *
 *  These values satisfy all four with margin. They are still PLACEHOLDERS —
 *  step 6 refits them against 80 ground-truth sides, with these four as the
 *  constraints the fit must respect. */
export const MEMBER_MIN = 0.6;

/** How independent two reads inside one burst are treated as being.
 *
 *  NOISY-OR ASSUMES INDEPENDENCE AND BURST FRAMES ARE NOT INDEPENDENT. Same
 *  fighter, same face, same crop, same background one second apart: the
 *  realistic phantom is the SAME misread twice in one burst, not two independent
 *  errors, and plain noisy-OR would multiply that straight into confidence.
 *
 *  1 = frames combine as if independent (the frame-level fold).
 *  0 = a burst counts once however many frames it holds.
 *  Between, confidence still accumulates within a burst but at a discount.
 *
 *  It cannot be 1. Constraints (c) and (d) on MEMBER_MIN below become the same
 *  expression at full independence, so no choice of the other constants tells a
 *  correlated phantom from a genuine repeat. Measured in
 *  scripts/spike/fold-cases.ts: at β=1 the pair is inseparable; at β=0.5 the
 *  phantom lands 0.04 below the gate and the genuine repeat 0.09 above it. */
export const BURST_INDEP = 0.5;

/** Frames this close together are one burst. The sampler pulls contiguous
 *  windows, so this is the window's own frame spacing plus slack. */
export const BURST_GAP = 3;

/** Prudence margin for unseen footage, not a filter for observed ones.
 *
 *  FITTED, AND THE SIBLINGS' 0.90 DOES NOT SURVIVE. Tōkon's curve over 82
 *  ground-truth sides (scripts/spike/accuracy.ts) is degenerate — member
 *  precision is 99.5% at 0.01 and 100.0% from 0.75 up, and never falls again:
 *
 *      thresh   accepted   precision   both-exact   coverage
 *      0.01      38/41       99.5%       17.1%       92.7%
 *      0.75      30/41      100.0%       16.7%       73.2%
 *      0.90      14/41      100.0%        0.0%       34.1%
 *
 *  Precision is already carried by MEMBER_MIN, which gates every member before
 *  `min` ever sees it, so the threshold buys nothing above 0.75 and costs 39
 *  points of coverage to reach 0.90.
 *
 *  Worse, it ANTI-SELECTS FOR COMPLETENESS. Both-sides-exact goes 17.1% → 0.0%
 *  as the threshold rises, because a side read at confidence 1.00 is typically a
 *  side with ONE member witnessed many times, and a one-member union is never
 *  right about a four-fighter bench. Raising the gate does not buy caution here;
 *  it selects for under-reading. 0.75 is the last point that is free. */
export const AUTO_ACCEPT = 0.75;

/** Below this saturation, the side has not stopped discovering new fighters and
 *  a denser sample is worth paying for. */
export const RESAMPLE_BELOW = 0.9;

export interface FrameRead {
  /** absolute second in the video — also the burst key */
  sec: number;
  /** roster id, or null when nothing resolved inside the radius cap */
  id: string | null;
  /** edit distance of the winning read (0 = exact) */
  dist: number;
  /** distance to the runner-up id; large means unambiguous */
  margin: number;
  /** ensemble variants that produced this id, out of those that read anything */
  votes: number;
  of: number;
}

export interface Member {
  char: string;
  /** frames that read it */
  frames: number;
  /** DISTINCT bursts that read it — the evidence unit under correlation */
  bursts: number;
  /** longest run of consecutive legible frames. REPORTED, ZERO WEIGHT: the
   *  plate cycles, so this measures tag length, not truth. Kept because burst
   *  sampling makes within-burst adjacency meaningful again, and only a
   *  measurement should decide whether it earns weight back. */
  run: number;
  /** index of the first frame that read it — the ordering key */
  firstAt: number;
  /** best (lowest) distance seen for it */
  dist: number;
  confidence: number;
}

export interface SideResult {
  /** every character this side played, first-appearance order */
  characters: string[];
  /** PRECISION of the claim: min over members. Says nothing about completeness. */
  confidence: number;
  /** Good-Turing: P(the next legible read names a fighter already in the union).
   *  Drives re-sampling. Blind to a fighter who never enters — that residue is
   *  what the bench queue and a future portrait tier are for. */
  saturation: number;
  /** the union reached the format's four. A SEPARATE FACT from confidence:
   *  a trustworthy 2-of-4 is true, publishable data, and collapsing the two
   *  would route it to the wrong queue. */
  complete: boolean;
  members: Member[];
  /** candidates that failed MEMBER_MIN — reported, never a penalty on the rest */
  dropped: { char: string; frames: number; bursts: number; confidence: number }[];
  /** frames that produced a usable read */
  read: number;
  /** frames sampled */
  sampled: number;
}

/** Weight of one read: exactness × ensemble agreement. */
const weigh = (r: FrameRead): number =>
  q(r.dist) * (VOTE_FLOOR + (1 - VOTE_FLOOR) * (r.of > 0 ? r.votes / r.of : 1));

/** Fold one side's frame reads (timestamp order) into an ordered union.
 *
 *    w(r)     = q(dist) × agreement
 *    w(b)     = max_b + BURST_INDEP × (fullOR_b − max_b)     per burst
 *    member_c = 1 − Π_b (1 − w(b))                            noisy-OR, monotone
 *    members  = { c : member_c ≥ MEMBER_MIN }
 *    conf     = min over members                              ≥ MEMBER_MIN by construction
 */
export function foldSide(reads: FrameRead[]): SideResult {
  const usable = reads.filter((r) => r.id);

  // burst id from the timestamps — frames inside BURST_GAP share one
  const burstOf = new Map<number, number>();
  let b = -1;
  let prevSec = -Infinity;
  for (const r of [...reads].sort((x, y) => x.sec - y.sec)) {
    if (r.sec - prevSec > BURST_GAP) b++;
    burstOf.set(r.sec, b);
    prevSec = r.sec;
  }

  interface Tally {
    frames: number;
    firstAt: number;
    dist: number;
    run: number;
    /** read weights, grouped by burst */
    byBurst: Map<number, number[]>;
  }
  const tally = new Map<string, Tally>();
  // A blank frame is NEUTRAL — absence of evidence, not evidence of absence — so
  // it does not break a run. Runs are measured over the subsequence of frames
  // that read something.
  let prev: string | null = null;
  let runLen = 0;
  for (const [i, r] of reads.entries()) {
    if (!r.id) continue;
    runLen = r.id === prev ? runLen + 1 : 1;
    prev = r.id;
    const t = tally.get(r.id) ?? {
      frames: 0,
      firstAt: i,
      dist: r.dist,
      run: 0,
      byBurst: new Map<number, number[]>(),
    };
    t.frames++;
    t.dist = Math.min(t.dist, r.dist);
    t.run = Math.max(t.run, runLen);
    const bid = burstOf.get(r.sec) ?? 0;
    t.byBurst.set(bid, [...(t.byBurst.get(bid) ?? []), weigh(r)]);
    tally.set(r.id, t);
  }

  const all: Member[] = [...tally.entries()]
    .map(([char, t]) => {
      let miss = 1; // Π over bursts of (1 − w(b))
      for (const ws of t.byBurst.values()) {
        const fullOr = 1 - ws.reduce((acc, w) => acc * (1 - w), 1);
        const best = Math.max(...ws);
        const wb = best + BURST_INDEP * (fullOr - best);
        miss *= 1 - wb;
      }
      return {
        char,
        frames: t.frames,
        bursts: t.byBurst.size,
        run: t.run,
        firstAt: t.firstAt,
        dist: t.dist,
        confidence: Number((1 - miss).toFixed(3)),
      };
    })
    .sort((a, z) => a.firstAt - z.firstAt);

  const members = all.filter((m) => m.confidence >= MEMBER_MIN);
  const dropped = all
    .filter((m) => m.confidence < MEMBER_MIN)
    .map((m) => ({ char: m.char, frames: m.frames, bursts: m.bursts, confidence: m.confidence }));

  // Good-Turing, over BURSTS rather than frames: the sampling opportunity is the
  // burst, and counting correlated frames as independent observations would make
  // the estimator as over-confident as the fold it is meant to check.
  const totalBurstObs = all.reduce((a, m) => a + m.bursts, 0);
  const singletons = all.filter((m) => m.bursts === 1).length;
  const saturation = totalBurstObs ? Number((1 - singletons / totalBurstObs).toFixed(3)) : 0;

  return {
    characters: members.map((m) => m.char),
    confidence: members.length
      ? Number(Math.min(...members.map((m) => m.confidence)).toFixed(3))
      : 0,
    saturation,
    complete: members.length >= 4,
    members,
    dropped,
    read: usable.length,
    sampled: reads.length,
  };
}

// ── side attribution ────────────────────────────────────────────────────────

export interface SideResolution {
  /** true when the title's FIRST-named player sat on the screen-left */
  leftIsFirst: boolean;
  /** signed frame-count margin; 0 means the footage could not say */
  votes: number;
  decided: boolean;
}

/**
 * Which screen side belongs to which player, anchored on the fighter the TITLE
 * already names — never on title order.
 *
 * NEVER TITLE ORDER: hadoukenReplays reverses its second title slot on 27 of 34
 * uploads, so assuming the title's order is the screen's order would compound one
 * order error with another.
 *
 * The anchor costs nothing. Every queue item already knows one fighter per side
 * from its title, and this reads the votes off the SAME per-frame reads the fold
 * consumed — no handle-plate crop, no second OCR worker of the kind the siblings
 * needed for their broadcast overlays.
 *
 * A mirror — both players' title-named fighters identical — cancels to zero and
 * routes to review, which is the correct answer rather than a coin flip.
 */
export function resolveSide(
  left: FrameRead[],
  right: FrameRead[],
  titleChars: [string, string],
): SideResolution {
  const [a, z] = titleChars;
  const rightBySec = new Map(right.map((r) => [r.sec, r]));
  let votes = 0;
  for (const l of left) {
    const r = rightBySec.get(l.sec);
    let first = 0; // evidence that candidates are in title order
    let second = 0; // evidence that they are reversed
    if (l.id === a) first++;
    if (l.id === z) second++;
    if (r?.id === z) first++;
    if (r?.id === a) second++;
    if (first === second) continue; // no evidence, or perfectly balanced
    votes += first > second ? 1 : -1;
  }
  return { leftIsFirst: votes > 0, votes, decided: votes !== 0 };
}

/** The free per-record positive control: the title already states one fighter
 *  per side, so a union that does not contain it is wrong somewhere — either the
 *  reader or the attribution — and either way the record belongs in review.
 *
 *  A gate that cannot fail is indistinguishable from one that passes; this one
 *  fails on every record whose reader has drifted, at zero cost. */
export const titleOk = (union: string[], known: string[]): boolean =>
  known.every((k) => union.includes(k));
