/**
 * THE TESSERACT TEST — can this face be read at all?
 *
 * Runs the siblings' four-threshold ensemble against the box the sweep measured,
 * over frames spanning fighters and channels, and reports what comes back.
 *
 * THE VERDICT RULE, AGREED BEFORE THE NUMBERS EXIST. A plate that is legible to
 * a human and unreadable to the ensemble is the FONT-TEMPLATE TRIGGER — not a
 * reason to push OCR harder. A sibling spent four thresholds, four page-seg
 * modes, whitelist on and off, ink-trim, glyph-height normalisation and six
 * shear angles establishing that specific letterforms, not preprocessing, were
 * the problem. This face (heavy, condensed, hard-outlined, over animated art) is
 * the likeliest customer that hatch has ever had.
 *
 * ONE INHERITED ASSUMPTION IS DELIBERATELY NOT INHERITED. The sibling negates
 * before reading because its glyphs are near-white on dark art. Tōkon's are the
 * other polarity — a mid-dark fill inside a bright outline — so both are tried
 * and the result is reported per variant rather than assumed.
 *
 * Tesseract's own confidence is not a signal (it returned 0 on a correct read
 * and 95 on a wrong one on a sibling). What counts is agreement across variants
 * and edit distance to a roster alias.
 *
 * NORMALISATION AGREEMENT — settled here, before any radius cap is computed.
 * The whitelist below, the normalise class in `norm()`, and the alias keys in
 * data/characters.json must agree on `.`, `-` and space. Ms. Marvel, Doctor
 * Doom, Spider-Man and Star-Lord each pick up a phantom edit otherwise, and
 * every distance in the cap's table would be measured against the wrong string.
 *
 * Run: npx tsx scripts/spike/ocr-probe.ts [--frames N]
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

import type { CharacterRecord } from '../../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('--frames') + 1]) || 12;

/** The three must agree — see the header. */
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.- ';
const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z.\- ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const UPSCALE = 4;
const THRESHOLDS = [0, 150, 175, 200, 225]; // 0 = normalise instead of threshold

/** Optimal string alignment distance. */
function osa(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

async function prep(file: string, box: number[], threshold: number, negate: boolean) {
  const m = await sharp(file).metadata();
  const W = m.width!;
  const H = m.height!;
  const base = sharp(file)
    .extract({
      left: Math.round(box[0]! * W),
      top: Math.round(box[1]! * H),
      width: Math.round(box[2]! * W),
      height: Math.round(box[3]! * H),
    })
    .resize({ width: Math.round(box[2]! * W * UPSCALE), kernel: 'lanczos3' })
    .greyscale();
  const toned = threshold > 0 ? base.threshold(threshold) : base.normalise();
  return (negate ? toned.negate() : toned).png().toBuffer();
}

const sweep = JSON.parse(readFileSync(join(ROOT, 'cache/tokon/sweep.json'), 'utf8')) as {
  id: string;
  channel: string;
  bandY0: number;
  bandY1: number;
  leftX0: number;
  rightX1: number;
  hudFrames: number;
  hudSecs: number[];
}[];
const characters = JSON.parse(
  readFileSync(join(ROOT, 'data/characters.json'), 'utf8'),
) as CharacterRecord[];
const aliases = characters.flatMap((c) =>
  (c.extra?.aliases ?? []).map((a) => ({ id: c.id, key: norm(a) })),
);

const PAD_Y = 0.006;
const PLATE_W = 0.145;

const worker = await createWorker('eng', undefined, { logger: () => {} });
await worker.setParameters({
  tessedit_char_whitelist: WHITELIST,
  tessedit_pageseg_mode: '7' as never, // single text line
});

console.log(
  `Tesseract probe — ${WHITELIST.trim().length} char whitelist, psm 7, ${THRESHOLDS.length} tones × 2 polarities\n`,
);

interface Row {
  channel: string;
  side: string;
  frame: string;
  reads: string[];
  best: { id: string; dist: number } | null;
}
const rows: Row[] = [];

for (const v of sweep.filter((s) => s.hudFrames > 0)) {
  const dir = join(ROOT, 'cache/tokon/frames', v.id);
  // HUD-BEARING FRAMES ONLY. A frame showing a K.O. card, a round banner or the
  // pre-match VS art has no nameplate in it; asking a reader to read one and
  // scoring the silence as a miss measures the sampler, not the reader. An
  // earlier run of this probe sampled by stride across every cached frame and
  // reported 38%, which read as "this face is unreadable" when the plates it
  // actually saw came back as STAR-LORD, SPIDER-MAN and MAGNETO, exact.
  const files = v.hudSecs.map((s) => `${String(s).padStart(6, '0')}.png`);
  // spread across the set so the sample spans tag-ins, not one fighter
  const want = Math.ceil(N / sweep.length);
  const step = Math.max(1, Math.floor(files.length / want));
  const picks = files.filter((_, i) => i % step === 0).slice(0, want);

  for (const f of picks) {
    const file = join(dir, f);
    for (const [side, box] of [
      ['L', [v.leftX0 - 0.004, v.bandY0 - PAD_Y, PLATE_W, v.bandY1 - v.bandY0 + PAD_Y * 2]],
      [
        'R',
        [v.rightX1 - PLATE_W + 0.004, v.bandY0 - PAD_Y, PLATE_W, v.bandY1 - v.bandY0 + PAD_Y * 2],
      ],
    ] as [string, number[]][]) {
      const reads: string[] = [];
      for (const t of THRESHOLDS) {
        for (const neg of [true, false]) {
          const buf = await prep(file, box, t, neg);
          const { data } = await worker.recognize(buf);
          const txt = norm(data.text);
          if (txt) reads.push(txt);
        }
      }
      let best: { id: string; dist: number } | null = null;
      for (const r of reads) {
        for (const a of aliases) {
          const d = osa(r, a.key);
          if (!best || d < best.dist) best = { id: a.id, dist: d };
        }
      }
      rows.push({ channel: v.channel, side, frame: `${v.id}/${f}`, reads, best });
    }
  }
}
await worker.terminate();

// ── report ──────────────────────────────────────────────────────────────────
const clean = rows.filter((r) => r.best && r.best.dist === 0);
const near = rows.filter((r) => r.best && r.best.dist > 0 && r.best.dist <= 2);
const blank = rows.filter((r) => r.reads.length === 0);

console.log('sample of raw reads (all variants, per plate):\n');
for (const r of rows.slice(0, 10)) {
  const uniq = [...new Set(r.reads)].slice(0, 6);
  console.log(
    `  ${r.channel.padEnd(18)} ${r.side}  ${uniq.map((u) => JSON.stringify(u)).join(' ') || '(nothing)'}`,
  );
  console.log(`      best alias: ${r.best ? `${r.best.id} @ osa ${r.best.dist}` : '—'}`);
}

console.log(`\n  plates probed:      ${rows.length}`);
console.log(
  `  exact alias hit:    ${clean.length}  (${((100 * clean.length) / rows.length).toFixed(0)}%)`,
);
console.log(
  `  within 2 edits:     ${near.length}  (${((100 * near.length) / rows.length).toFixed(0)}%)`,
);
console.log(
  `  returned nothing:   ${blank.length}  (${((100 * blank.length) / rows.length).toFixed(0)}%)`,
);

const rate = (clean.length + near.length) / rows.length;
console.log(
  `\n  VERDICT: ${
    rate >= 0.6
      ? 'OCR is viable — proceed to the fold and the radius cap.'
      : 'OCR CANNOT READ THIS FACE. The plates are legible to a human, so per the\n' +
        '           pre-agreed rule this is the FONT-TEMPLATE TRIGGER, not a cue to keep\n' +
        '           tuning preprocessing. Render the 21 roster names in the game face,\n' +
        '           dHash the rendered strip, match over the closed set.'
  }`,
);
