/**
 * Re-measure plate geometry across every cached video, and set the sanity gate's
 * tolerance from the result rather than from a guess.
 *
 * ORDER MATTERS HERE. The obvious gate — "leftX0 and 1-rightX1 should agree, so
 * flag the video when they don't" — is a false-positive generator BEFORE the
 * column windows are fixed. Measured pre-fix, 8 of 51 videos breached a 0.04
 * residual, but five of them had a perfectly healthy rightX1 and merely a
 * portrait-contaminated leftX0; since production derives leftX0 = 1 - rightX1,
 * their geometry was already correct. Setting a tolerance on that distribution
 * would have flagged five good videos and taught the gate to cry wolf.
 *
 * So: fix the windows first, re-measure, then read the tolerance off the
 * post-fix residual.
 *
 * No OCR and no downloads — this only runs `measure()` over cached frames.
 *
 * Run: npx tsx scripts/spike/geom-check.ts [--frames N]
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CACHE, framesOf } from '../hud-frames';
import { grey, measure } from '../hud-read';

const argv = process.argv.slice(2);
const FRAMES = Number(argv[argv.indexOf('--frames') + 1]) || 10;

const ids = new Set<string>();
const ext = join(CACHE, 'extracted.json');
if (existsSync(ext)) {
  for (const [k, v] of Object.entries(
    JSON.parse(readFileSync(ext, 'utf8')) as Record<string, { hud: number }>,
  )) {
    if (v.hud > 0) ids.add(k);
  }
}
const sw = join(CACHE, 'sweep.json');
if (existsSync(sw)) {
  for (const v of JSON.parse(readFileSync(sw, 'utf8')) as { id: string; hudFrames: number }[]) {
    if (v.hudFrames > 0) ids.add(v.id);
  }
}

const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

interface Row {
  id: string;
  leftX0: number;
  rightX1: number;
  residual: number;
  hud: number;
  of: number;
}
const rows: Row[] = [];

for (const id of ids) {
  const files = framesOf(id);
  const step = Math.max(1, Math.floor(files.length / FRAMES));
  const picks = files.filter((_, i) => i % step === 0).slice(0, FRAMES);
  const lx: number[] = [];
  const rx: number[] = [];
  for (const f of picks) {
    const { d, W, H } = await grey(f);
    const m = measure(d, W, H);
    if (!m.hud) continue;
    lx.push(m.left!.x0);
    rx.push(m.right!.x1);
  }
  if (!lx.length) continue;
  const leftX0 = med(lx);
  const rightX1 = med(rx);
  rows.push({
    id,
    leftX0,
    rightX1,
    residual: Math.abs(leftX0 - (1 - rightX1)),
    hud: lx.length,
    of: picks.length,
  });
}

rows.sort((a, b) => a.residual - b.residual);
const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const res = rows.map((r) => r.residual).sort((a, b) => a - b);
const rx = rows.map((r) => r.rightX1).sort((a, b) => a - b);
const lx = rows.map((r) => r.leftX0).sort((a, b) => a - b);

console.log(`geometry re-measured over ${rows.length} cached videos, ${FRAMES} frames each\n`);
console.log(
  `  rightX1   min ${rx[0]!.toFixed(4)}  p50 ${q(rx, 0.5).toFixed(4)}  p95 ${q(rx, 0.95).toFixed(4)}  max ${rx[rx.length - 1]!.toFixed(4)}`,
);
console.log(
  `  leftX0    min ${lx[0]!.toFixed(4)}  p50 ${q(lx, 0.5).toFixed(4)}  p95 ${q(lx, 0.95).toFixed(4)}  max ${lx[lx.length - 1]!.toFixed(4)}`,
);
console.log(
  `  residual  min ${res[0]!.toFixed(4)}  p50 ${q(res, 0.5).toFixed(4)}  p95 ${q(res, 0.95).toFixed(4)}  max ${res[res.length - 1]!.toFixed(4)}`,
);

console.log('\n  worst residuals:');
for (const r of rows.slice(-6)) {
  console.log(
    `    ${r.id.padEnd(14)} leftX0 ${r.leftX0.toFixed(4)}  rightX1 ${r.rightX1.toFixed(4)}  ` +
      `residual ${r.residual.toFixed(4)}  hud ${r.hud}/${r.of}`,
  );
}

// the three that read nothing before the fix
const KNOWN_BAD = ['TdUH0obiI3Q', 'WA9jEF9ddt4', 'u9BACdqvTqw'];
console.log('\n  the three videos that read NOTHING before the window fix:');
for (const id of KNOWN_BAD) {
  const r = rows.find((x) => x.id === id);
  console.log(
    r
      ? `    ${id}  leftX0 ${r.leftX0.toFixed(4)}  rightX1 ${r.rightX1.toFixed(4)}  residual ${r.residual.toFixed(4)}`
      : `    ${id}  (not cached)`,
  );
}

const TOL = 0.04;
const over = rows.filter((r) => r.residual > TOL);
console.log(
  `\n  at tolerance ${TOL}: ${over.length}/${rows.length} flagged` +
    (over.length ? ` — ${over.map((r) => r.id).join(', ')}` : ' — none'),
);
console.log(
  '\n  A tolerance is only trustworthy if the distribution has a gap. Read the\n' +
    '  p95 and max above: if they sit far below the tolerance, the gate is a real\n' +
    '  safety net; if they crowd it, it will cry wolf and get ignored.\n',
);
