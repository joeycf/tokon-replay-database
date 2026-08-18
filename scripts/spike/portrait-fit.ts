/**
 * Build bench-diamond templates from HAND LABELS and score the reader.
 *
 * WHY HAND LABELS. Everything inferred hit a ceiling: transfer from the bust ranked
 * worse than a pixel-blind popularity prior (16.7% vs 36.7% top-1), a colour
 * descriptor measured worse than greyscale on a known-answer control, and
 * co-occurrence reached 46.9% top-3 recall as an UPPER bound with four fighters
 * getting no template at all. The cap is information: only 82 sides have a
 * description-derived bench to learn from. A person reading an upscaled corner is
 * fast and exact, so ~60 sides of hand labels is more truth than any of it produced.
 *
 * Templates are per fighter, built as the per-bit majority over that fighter's
 * labelled crops — far cleaner than any single crop. Coverage is EXPLICIT and the
 * reader refuses outside it: an icon matching no template ABSTAINS, because an
 * absent class cannot abstain on its own behalf and gets absorbed by its nearest
 * neighbour instead (the lesson fuses.ts paid for).
 *
 * Run: npx tsx scripts/spike/portrait-fit.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { CACHE, stamp } from '../hud-frames';
import { ASSIST_CELLS, cellHash, hamming, majorityHash } from '../portrait-read';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const read = <T>(p: string, d: T): T =>
  existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : d;

const labels = read<Record<string, { char: string; sat: number; satRank: number }>>(
  join(ROOT, 'data/portrait-labels.json'),
  {},
);
const roster = read<{ id: string; name: string }[]>(join(ROOT, 'data/characters.json'), []);

if (!Object.keys(labels).length) {
  console.log('\n  data/portrait-labels.json is empty — label at /dev/portrait-review first.\n');
  process.exit(0);
}

// ── crops for every hand label ──────────────────────────────────────────────
interface Labelled {
  video: string;
  side: 'L' | 'R';
  char: string;
  satRank: number;
  h: string;
}
const cellOf = new Map(ASSIST_CELLS.map((c) => [c.name, c]));
const labelled: Labelled[] = [];
for (const [key, v] of Object.entries(labels)) {
  const [video, secStr, side, cellName] = key.split('/');
  const cell = cellOf.get(cellName ?? '');
  if (!video || !secStr || !cell || (side !== 'L' && side !== 'R')) continue;
  const f = join(CACHE, 'frames', video, `${stamp(Number(secStr))}.png`);
  if (!existsSync(f)) continue;
  const { data, info } = await sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true });
  labelled.push({
    video,
    side,
    char: v.char,
    satRank: v.satRank,
    h: cellHash(data, info.width, info.height, side, cell),
  });
}

const nameOf = new Map(roster.map((c) => [c.id, c.name]));
console.log(`\n  ${labelled.length} hand-labelled diamond crops over ${new Set(labelled.map((l) => l.video)).size} videos\n`);

// ── templates, and a per-fighter accept radius ──────────────────────────────
/**
 * PER-FIGHTER RADIUS, mirroring roster.ts's per-key unique-decoding radius.
 *
 * The plate matcher accepts a read within `floor((distance to the nearest other
 * key - 1) / 2)`, so a name with a close neighbour is held to a stricter bar than
 * an isolated one. The same logic applies here, and one thing more: a template
 * built from three crops is not as trustworthy as one built from forty, so a thin
 * class is tightened further rather than being allowed to claim a thick one's
 * confidence.
 */
const CAP = 16;
const build = (rows: Labelled[]) => {
  const by = new Map<string, string[]>();
  for (const l of rows) by.set(l.char, [...(by.get(l.char) ?? []), l.h]);
  const tpl = new Map<string, { h: string; n: number }>();
  for (const [f, hs] of by) tpl.set(f, { h: majorityHash(hs), n: hs.length });
  const radius = new Map<string, number>();
  for (const [f, t] of tpl) {
    let nearest = 64;
    for (const [g, u] of tpl) if (g !== f) nearest = Math.min(nearest, hamming(t.h, u.h));
    const unique = Math.max(0, Math.floor((nearest - 1) / 2));
    const thin = t.n >= 12 ? CAP : t.n >= 6 ? CAP - 4 : CAP - 8;
    radius.set(f, Math.min(CAP, unique, thin));
  }
  return { tpl, radius };
};

const { tpl, radius } = build(labelled);
console.log('  fighter            crops   radius   nearest other template');
for (const [f, t] of [...tpl].sort((a, b) => b[1].n - a[1].n)) {
  let nearest = 64;
  for (const [g, u] of tpl) if (g !== f) nearest = Math.min(nearest, hamming(t.h, u.h));
  console.log(
    `  ${(nameOf.get(f) ?? f).padEnd(18)} ${String(t.n).padStart(5)}   ${String(radius.get(f)).padStart(6)}   ${String(nearest).padStart(6)}`,
  );
}
const missing = roster.filter((c) => !tpl.has(c.id));
if (missing.length) {
  console.log(`\n  NO TEMPLATE (reader will ABSTAIN, never guess): ${missing.map((c) => c.name).join(', ')}`);
}

// ── leave-one-video-out: the honest number ──────────────────────────────────
let hit = 0;
let want = 0;
let abstain = 0;
let wrong = 0;
const bySide = new Map<string, Labelled[]>();
for (const l of labelled) bySide.set(`${l.video}/${l.side}`, [...(bySide.get(`${l.video}/${l.side}`) ?? []), l]);

for (const [key, rows] of bySide) {
  const video = key.split('/')[0]!;
  // TEMPLATES MUST NOT HAVE SEEN THIS VIDEO. A template built partly from the very
  // crop being scored is matching a frame against itself.
  const { tpl: t2, radius: r2 } = build(labelled.filter((l) => l.video !== video));
  for (const row of rows) {
    want++;
    let best: { f: string; d: number } | null = null;
    for (const [f, u] of t2) {
      const d = hamming(row.h, u.h);
      if (d <= (r2.get(f) ?? 0) && (!best || d < best.d)) best = { f, d };
    }
    if (!best) abstain++;
    else if (best.f === row.char) hit++;
    else wrong++;
  }
}
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
console.log(
  `\n  LEAVE-ONE-VIDEO-OUT over ${want} crops:  correct ${hit} (${pct(hit, want)})  ` +
    `wrong ${wrong} (${pct(wrong, want)})  abstained ${abstain} (${pct(abstain, want)})`,
);
console.log(
  `  precision on non-abstentions: ${pct(hit, hit + wrong)}  ` +
    '— a wrong fighter is PUBLISHED, a missing one only waits in the bench queue.\n',
);

// ── radius sweep, with the completeness column ──────────────────────────────
console.log('  radius sweep — precision is the constraint, completeness is the point\n');
console.log('     cap   accepted   precision   coverage');
for (const cap of [6, 8, 10, 12, 14, 16, 20, 24]) {
  let h2 = 0;
  let w2 = 0;
  let n2 = 0;
  for (const [key, rows] of bySide) {
    const video = key.split('/')[0]!;
    const { tpl: t2 } = build(labelled.filter((l) => l.video !== video));
    for (const row of rows) {
      n2++;
      let best: { f: string; d: number } | null = null;
      for (const [f, u] of t2) {
        const d = hamming(row.h, u.h);
        if (d <= cap && (!best || d < best.d)) best = { f, d };
      }
      if (!best) continue;
      if (best.f === row.char) h2++;
      else w2++;
    }
  }
  console.log(
    `     ${String(cap).padStart(3)}   ${String(h2 + w2).padStart(5)}/${n2}   ${pct(h2, h2 + w2).padStart(9)}   ${pct(h2 + w2, n2).padStart(8)}`,
  );
}
console.log(
  '\n  A cap that raises precision while collapsing coverage is the AUTO_ACCEPT\n' +
    '  anti-selection trap wearing a different hat — read both columns.\n',
);
export {};

// ── the diagnostic that decides whether any threshold can work ──────────────
/**
 * WITHIN-CLASS VERSUS BETWEEN-CLASS, and a proper crop-size fit.
 *
 * The per-fighter radii came out tiny (Blade 4, Storm 3, Star-Lord 3) because the
 * nearest OTHER template sits only 8-10 bits away. If a fighter's own crops vary by
 * more than that, then no accept radius exists that admits the fighter without also
 * admitting its neighbour, and the descriptor is finished regardless of thresholds.
 *
 * The crop size is also refitted here, properly, for the first time. `CROP_HALF`
 * was chosen by a sweep that could not separate a stable crop from an available
 * one, and it was chosen before the mirror bug was found — so it was fitted through
 * a fog on both counts. With exact labels the fit is direct: sweep the half-diagonal
 * and read the margin between classes.
 */
const { readFileSync: rf } = await import('node:fs');
void rf;
console.log('  crop-size fit against the hand labels — the margin is what matters\n');
console.log('     halfDiag   within-class   between-class   margin   best precision @ coverage');
for (const hd of [14, 18, 22, 26, 30, 36]) {
  const rows: Labelled[] = [];
  for (const [key, v] of Object.entries(labels)) {
    const [video, secStr, side, cellName] = key.split('/');
    const cell = cellOf.get(cellName ?? '');
    if (!video || !secStr || !cell || (side !== 'L' && side !== 'R')) continue;
    const f = join(CACHE, 'frames', video, `${stamp(Number(secStr))}.png`);
    if (!existsSync(f)) continue;
    const { data, info } = await sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true });
    rows.push({
      video,
      side,
      char: v.char,
      satRank: v.satRank,
      h: cellHash(data, info.width, info.height, side, cell, hd / 1280),
    });
  }
  let wSum = 0;
  let wN = 0;
  let bSum = 0;
  let bN = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i]!.video === rows[j]!.video) continue; // cross-video only
      const d = hamming(rows[i]!.h, rows[j]!.h);
      if (rows[i]!.char === rows[j]!.char) {
        wSum += d;
        wN++;
      } else {
        bSum += d;
        bN++;
      }
    }
  }
  const within = wSum / (wN || 1);
  const between = bSum / (bN || 1);
  // best achievable precision over any flat cap, with its coverage
  let bestP = 0;
  let bestC = 0;
  for (let cap = 4; cap <= 28; cap += 2) {
    let h2 = 0;
    let w2 = 0;
    const byV = new Map<string, Labelled[]>();
    for (const r of rows) byV.set(r.video, [...(byV.get(r.video) ?? []), r]);
    for (const [video, rs] of byV) {
      const { tpl: t2 } = build(rows.filter((l) => l.video !== video));
      for (const r of rs) {
        let best: { f: string; d: number } | null = null;
        for (const [f, u] of t2) {
          const d = hamming(r.h, u.h);
          if (d <= cap && (!best || d < best.d)) best = { f, d };
        }
        if (!best) continue;
        if (best.f === r.char) h2++;
        else w2++;
      }
    }
    const p = h2 + w2 ? h2 / (h2 + w2) : 0;
    if (p > bestP) {
      bestP = p;
      bestC = (h2 + w2) / rows.length;
    }
  }
  console.log(
    `     ${String(hd).padStart(8)}   ${within.toFixed(2).padStart(12)}   ${between.toFixed(2).padStart(13)}   ` +
      `${(between - within).toFixed(2).padStart(6)}   ${(100 * bestP).toFixed(1).padStart(8)}% @ ${(100 * bestC).toFixed(0)}%`,
  );
}
console.log(
  '\n  A margin near zero means a fighter varies more across matches than fighters\n' +
    '  differ from each other, and no accept radius can separate them.\n',
);
