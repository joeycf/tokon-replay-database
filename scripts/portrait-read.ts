/**
 * Reading the Tōkon HUD's bench-portrait cluster: lattice geometry and hashing.
 *
 * Sibling to hud-read.ts, and split out for the same reason: the spikes and the
 * production reader must agree on WHERE A CELL IS. scripts/spike/portrait.ts
 * derived all of this and now imports it rather than keeping a second copy.
 *
 * WHAT STEP 0 SETTLED. Each top corner holds a 2x2 grid of squares ROTATED 45°.
 * The centre — where all four cells meet — sits at (80, 73) px on a 1280x720
 * frame, with a cell half-diagonal of 36 px. The TOP cell is not a framed icon:
 * the point fighter is drawn there as a large unframed bust that overflows it.
 * The other three hold the bench, one per fighter, so a side shows all four of its
 * fighters at once. That is the 36% of bench slots the nameplate can never reach.
 *
 * Geometry is stored as FRAME FRACTIONS, not pixels, so the same constants read a
 * 720p cache and a 1080p one. Frames are 16:9 throughout, so a single scale factor
 * off the width is uniform.
 */

import { hamming } from './hud-read';

export { hamming };

/** Lattice centre and cell half-diagonal, as fractions of frame WIDTH/HEIGHT.
 *  Derived at 1280x720: centre (80, 73), half-diagonal 36. */
export const LATTICE_CX = 80 / 1280;
export const LATTICE_CY = 73 / 720;
export const CELL_HALF = 36 / 1280;

/** The fitted crop half-diagonal. Smaller than the cell's own 36 px: the refit
 *  preferred a tighter crop, trading a little discrimination for stability
 *  against the cell's noisy periphery. Provisional — it was fitted before the
 *  presence gate existed and is expected to move once that confound is removed. */
export const CROP_HALF = 22 / 1280;

export interface Cell {
  name: string;
  /** offset from the lattice centre, in fractions of width / height */
  dx: number;
  dy: number;
}

const OFF_X = 36 / 1280;
const OFF_Y = 36 / 720;

export const CELLS: Cell[] = [
  { name: 'top', dx: 0, dy: -OFF_Y }, // the point fighter's bust, not a framed icon
  { name: 'left', dx: -OFF_X, dy: 0 },
  { name: 'right', dx: OFF_X, dy: 0 },
  { name: 'bottom', dx: 0, dy: OFF_Y },
];

/** The three framed bench diamonds — everything except the point fighter's bust. */
export const ASSIST_CELLS = CELLS.filter((c) => c.name !== 'top');
export const BUST_CELL = CELLS.find((c) => c.name === 'top')!;

/** Cell centre in pixels for a frame of this size, on the given screen side. */
export function cellCentre(cell: Cell, side: 'L' | 'R', W: number, H: number) {
  const cx = (LATTICE_CX + cell.dx) * W;
  return { cx: side === 'L' ? cx : W - cx, cy: (LATTICE_CY + cell.dy) * H };
}

/**
 * 8x8 edge-density hash of a cell, sampled in the diamond's OWN coordinates.
 *
 * The cells are squares rotated 45°, so an axis-aligned box around one uses only
 * its inscribed square — about half the icon — and starts eating neighbouring
 * cells on a few pixels of centre error. Substituting
 *
 *     x = cx + (a + b)      y = cy + (a - b)
 *
 * turns |x-cx| + |y-cy| <= d into max(|a|,|b|) <= d/2, so sweeping a and b over
 * [-d/2, d/2] covers exactly the cell and nothing outside it.
 *
 * `mirror` flips about the cell's vertical axis, and the RIGHT corner always needs
 * it. The two corners are mirror images: same fighter, different match, a left
 * crop against an unflipped right crop scores 29.14 bits — the DIFFERENT-fighter
 * level — while flipping brings it to 15.16 against L-L's 11.92. Pooling the sides
 * without this makes every cross-side comparison noise.
 *
 * Local range uses the same 5-tap window and the same absolute threshold of 70 as
 * `hud-read.dhash`, and returns 64 characters of '0'/'1' for the same reason: a
 * packed number was once compared through `parseInt` and silently lost its low
 * bits. A bit string cannot round.
 */
export function hashCell(
  d: Buffer,
  W: number,
  H: number,
  cx: number,
  cy: number,
  halfDiagPx: number,
  mirror: boolean,
): string {
  const N = Math.max(16, Math.round(halfDiagPx * Math.SQRT2));
  const cells = new Float64Array(64);
  const counts = new Float64Array(64);
  for (let i = 0; i < N; i++) {
    const a = (i / (N - 1) - 0.5) * halfDiagPx;
    for (let j = 0; j < N; j++) {
      const b = (j / (N - 1) - 0.5) * halfDiagPx;
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

/** Hash one named cell in CANONICAL (left-corner) orientation, at any resolution. */
export function cellHash(
  d: Buffer,
  W: number,
  H: number,
  side: 'L' | 'R',
  cell: Cell,
  halfDiag = CROP_HALF,
): string {
  const { cx, cy } = cellCentre(cell, side, W, H);
  return hashCell(d, W, H, cx, cy, halfDiag * W, side === 'R');
}

/** Mean luminance of a cell — the render-state signal.
 *
 *  Two of the three bench diamonds render desaturated and one is highlighted in
 *  the side's own hue, and the highlight MOVES. Measured across 486 frames, the
 *  brightest and dimmest of a frame's three cells differ by a median 100 levels of
 *  255, so the brightest is a reliable tag for the lit one. It matters because
 *  pooling both renderings leaves six groups where a side has three fighters;
 *  splitting them lifts top-3 cluster coverage from 61% to 78%. */
export function cellLuma(
  d: Buffer,
  W: number,
  H: number,
  side: 'L' | 'R',
  cell: Cell,
  halfDiag = CROP_HALF,
): number {
  const { cx, cy } = cellCentre(cell, side, W, H);
  const hd = halfDiag * W;
  const N = Math.max(16, Math.round(hd * Math.SQRT2));
  const mirror = side === 'R';
  let sum = 0;
  let n = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / (N - 1) - 0.5) * hd;
    for (let j = 0; j < N; j++) {
      const b = (j / (N - 1) - 0.5) * hd;
      const x = Math.round(mirror ? cx - (a + b) : cx + a + b);
      const y = Math.round(cy + a - b);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      sum += d[y * W + x]!;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Mean saturation of a cell — the render-state signal, and NOT luminance.
 *
 * Two of a side's three diamonds render pale and ghosted while the third is vivid,
 * and the pale ones are what a template must not be built from blindly. Luminance
 * looked like the tag and is not: measured on one labelled frame, Captain America
 * and Wolverine both ghosted at 169 and 158 against a vivid Ms. Marvel at 179 — a
 * 21-level spread, because a ghosted portrait is pale (bright) while a vivid one
 * can be dark. The earlier "median gap of 100 levels" was largely the characters'
 * own palettes, Doctor Doom's grey armour against Magneto's red, rather than state.
 *
 * Saturation separates what luminance confuses: ghosting desaturates toward white
 * regardless of the character, and vividness is saturation by definition.
 */
export function cellSat(
  rgb: Buffer,
  W: number,
  H: number,
  channels: number,
  side: 'L' | 'R',
  cell: Cell,
  halfDiag = CROP_HALF,
): number {
  const { cx, cy } = cellCentre(cell, side, W, H);
  const hd = halfDiag * W;
  const N = Math.max(16, Math.round(hd * Math.SQRT2));
  const mirror = side === 'R';
  let sum = 0;
  let n = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / (N - 1) - 0.5) * hd;
    for (let j = 0; j < N; j++) {
      const b = (j / (N - 1) - 0.5) * hd;
      const x = Math.round(mirror ? cx - (a + b) : cx + a + b);
      const y = Math.round(cy + a - b);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const o = (y * W + x) * channels;
      const r = rgb[o]!;
      const g = rgb[o + 1]!;
      const bl = rgb[o + 2]!;
      const mx = Math.max(r, g, bl);
      sum += mx === 0 ? 0 : (mx - Math.min(r, g, bl)) / mx;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Per-bit majority over a set of hashes — a template far cleaner than any crop. */
export function majorityHash(hs: string[]): string {
  let out = '';
  for (let i = 0; i < 64; i++) {
    let ones = 0;
    for (const h of hs) if (h[i] === '1') ones++;
    out += ones * 2 >= hs.length ? '1' : '0';
  }
  return out;
}

/** Agglomerate hashes: a crop joins the first group within `t`, else starts one.
 *  Same rule as `distinct()` in hud-read.ts. Groups come back largest-first with
 *  their representative recomputed as the members' majority. */
export function group(hs: string[], t: number): { rep: string; members: string[] }[] {
  const gs: { rep: string; members: string[] }[] = [];
  for (const h of hs) {
    const g = gs.find((x) => hamming(h, x.rep) <= t);
    if (g) g.members.push(h);
    else gs.push({ rep: h, members: [h] });
  }
  for (const g of gs) g.rep = majorityHash(g.members);
  return gs.sort((a, b) => b.members.length - a.members.length);
}
