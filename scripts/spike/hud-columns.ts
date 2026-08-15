/**
 * WHERE THE INK ACTUALLY IS across the nameplate band — every run, not the
 * longest one.
 *
 * `measure()` takes the LONGEST column run in each half as the nameplate. That
 * is wrong at the frame corners: Tōkon draws a four-icon bench-portrait diamond
 * cluster in each top corner, and the cluster is dense hard-edged art sitting
 * inside the same band as the names. Whenever a fighter's name is short the
 * cluster wins the "longest" test, and on three ground-truth videos it did —
 * rightX1 came back 0.973-0.990 against a healthy 0.900-0.912. Because the
 * production anchor derives leftX0 = 1 - rightX1, one plate's error then
 * destroyed the other, and both sides of WA9jEF9ddt4 read nothing across 71 HUD
 * frames.
 *
 * This dumps every run so the window bounds are MEASURED rather than eyeballed
 * off two screenshots.
 *
 * Run: npx tsx scripts/spike/hud-columns.ts [--videos N] [--frames N]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CACHE, framesOf } from '../hud-frames';
import { grey, measure } from '../hud-read';

const argv = process.argv.slice(2);
const VIDEOS = Number(argv[argv.indexOf('--videos') + 1]) || 12;
const FRAMES = Number(argv[argv.indexOf('--frames') + 1]) || 6;

const RANGE_MIN = 70;
const COL_INK_MIN = 0.22;
const COL_GAP = 10;

/** Every column run across the FULL width of the measured band. */
function allRuns(d: Buffer, W: number, H: number, by0: number, by1: number): [number, number][] {
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
  const runs: [number, number][] = [];
  let cur: [number, number] | null = null;
  let gap = 0;
  for (let x = 0; x < W; x++) {
    let b = 0;
    for (let y = by0; y <= by1; y++) if (rng(x, y) > RANGE_MIN) b++;
    if (b / (by1 - by0 + 1) >= COL_INK_MIN) {
      if (!cur) cur = [x, x];
      else cur[1] = x;
      gap = 0;
    } else if (cur && ++gap > COL_GAP) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

const store = JSON.parse(readFileSync(join(CACHE, 'extracted.json'), 'utf8')) as Record<
  string,
  { hud: number; left: { sec: number }[] }
>;
const ids = Object.keys(store)
  .filter((k) => store[k]!.hud > 0)
  .slice(0, VIDEOS);

interface Run {
  x0: number;
  x1: number;
  w: number;
}
const byBucket = new Map<string, number>();
const leftBlockEnds: number[] = [];
const rightBlockStarts: number[] = [];
const nameRuns: Run[] = [];

console.log(`scanning ${ids.length} videos × ${FRAMES} frames\n`);
for (const id of ids) {
  const files = framesOf(id);
  const secs = new Set(store[id]!.left.map((r) => r.sec));
  const hud = files.filter((f) => secs.has(Number(f.split('/').pop()!.replace('.png', ''))));
  const step = Math.max(1, Math.floor(hud.length / FRAMES));
  const picks = hud.filter((_, i) => i % step === 0).slice(0, FRAMES);

  const perVideo: Run[][] = [];
  for (const f of picks) {
    const { d, W, H } = await grey(f);
    const m = measure(d, W, H);
    if (!m.hud) continue;
    const runs = allRuns(d, W, H, Math.round(m.band!.y0 * H), Math.round(m.band!.y1 * H)).map(
      ([a, b]) => ({ x0: a / W, x1: b / W, w: (b - a) / W }),
    );
    perVideo.push(runs);
    for (const r of runs) {
      const k = `${(Math.floor(r.x0 * 20) / 20).toFixed(2)}`;
      byBucket.set(k, (byBucket.get(k) ?? 0) + 1);
    }
    // the run touching the LEFT frame edge is the portrait cluster
    const lead = runs.find((r) => r.x0 <= 0.02);
    if (lead) leftBlockEnds.push(lead.x1);
    // the run touching the RIGHT frame edge likewise
    const trail = [...runs].reverse().find((r) => r.x1 >= 0.98);
    if (trail) rightBlockStarts.push(trail.x0);
    // everything not touching an edge, in the outer thirds, is a name candidate
    for (const r of runs) {
      if (r.x0 > 0.02 && r.x1 < 0.98 && (r.x1 < 0.5 || r.x0 > 0.5)) nameRuns.push(r);
    }
  }
  const flat = perVideo.flat();
  console.log(
    `  ${id}  ${perVideo.length} frames · runs/frame ${(flat.length / Math.max(1, perVideo.length)).toFixed(1)}`,
  );
}

const stat = (xs: number[], label: string) => {
  if (!xs.length) return console.log(`  ${label}: none`);
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  console.log(
    `  ${label.padEnd(28)} n=${String(s.length).padStart(4)}  min ${s[0]!.toFixed(3)}  p50 ${q(0.5).toFixed(3)}  p95 ${q(0.95).toFixed(3)}  max ${s[s.length - 1]!.toFixed(3)}`,
  );
};

console.log('\n── the corner portrait clusters ─────────────────────────────────────');
stat(leftBlockEnds, 'LEFT block ends at x');
stat(rightBlockStarts, 'RIGHT block starts at x');

console.log('\n── runs that are NOT touching a frame edge (name candidates) ────────');
const leftNames = nameRuns.filter((r) => r.x1 < 0.5);
const rightNames = nameRuns.filter((r) => r.x0 > 0.5);
stat(leftNames.map((r) => r.x0), 'left name starts at x');
stat(leftNames.map((r) => r.x1), 'left name ends at x');
stat(rightNames.map((r) => r.x0), 'right name starts at x');
stat(rightNames.map((r) => r.x1), 'right name ends at x');

console.log('\n── run start histogram (0.05 buckets) ───────────────────────────────');
for (const [k, n] of [...byBucket].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  x ${k}  ${'█'.repeat(Math.ceil(n / 3))} ${n}`);
}

console.log(
  '\n  Proposed windows exclude the corner clusters and keep the whole name.\n' +
    '  Left  window: [ LEFT block p95 end , 0.46 ]\n' +
    '  Right window: [ 0.54 , RIGHT block p05 start ]\n',
);
