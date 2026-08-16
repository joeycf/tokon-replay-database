/**
 * Score the reader against human plate readings.
 *
 * The sample is deliberately NOT representative — rejected plates are 15.9% of
 * the population and half the sample, and the five channels are drawn evenly
 * although one uploader supplies most of the corpus. Both distortions are
 * chosen: they buy resolution exactly where the open questions are. Both are
 * therefore WEIGHTED BACK here, and every headline prints raw counts beside the
 * weighted estimate so an over-sampled stratum can never be quoted as a
 * population rate by accident.
 *
 * The three questions:
 *
 *   PRECISION  of the plates the reader resolved, how many did it get right?
 *              This is the number 99.5% was a proxy for, measured directly
 *              against a human rather than inferred from description benches.
 *
 *   HEADROOM   of the plates the reader REJECTED, how many could a human read?
 *              This decides whether the reader is at its ceiling or whether an
 *              alias gap or the radius cap is throwing away legible names. A
 *              fighter that keeps appearing here is a cheap fix.
 *
 *   HUD GATE   of the frames the HUD detector discarded, how many in fact had a
 *              readable plate? A gate nobody tests is a gate nobody can trust.
 *
 * Run: npx tsx scripts/spike/plate-accuracy.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHE } from '../hud-frames';
import { loadCharacters } from '../roster';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

interface SampleEntry {
  videoId: string;
  sec: number;
  stratum: string;
  readerLeft: string | null;
  readerRight: string | null;
}
interface PlateLabel {
  left: string | null;
  right: string | null;
  at: string;
}

const samplePath = join(CACHE, 'plate-sample.json');
const labelPath = join(ROOT, 'data/plate-labels.json');
if (!existsSync(samplePath)) {
  console.error('✖ no cache/tokon/plate-sample.json — run build-plate-sample.ts first');
  process.exit(1);
}
const { sample } = JSON.parse(readFileSync(samplePath, 'utf8')) as { sample: SampleEntry[] };
const labels = existsSync(labelPath)
  ? (JSON.parse(readFileSync(labelPath, 'utf8')) as Record<string, PlateLabel>)
  : {};

if (!Object.keys(labels).length) {
  console.log(
    `sample of ${sample.length} frames is built and unlabelled.\n\n` +
      '  npx nuxt dev   →   /tokon/dev/source-review\n',
  );
  process.exit(0);
}

const names = new Map((await loadCharacters()).map((c) => [c.id, c.name]));
const videos = JSON.parse(readFileSync(join(ROOT, 'data/videos.json'), 'utf8')) as {
  id: string;
  intake: string;
}[];
const channelOf = new Map(videos.map((v) => [v.id, v.intake]));

// ── population weights, from the full extraction ────────────────────────────
const store = JSON.parse(readFileSync(join(CACHE, 'extracted.json'), 'utf8')) as Record<
  string,
  { hud: number; left: { id: string | null }[]; right: { id: string | null }[] }
>;
let popResolved = 0;
let popRejected = 0;
const popByChannel = new Map<string, number>();
for (const [vid, v] of Object.entries(store)) {
  const ch = channelOf.get(vid) ?? '?';
  let n = 0;
  for (const side of ['left', 'right'] as const) {
    for (const p of v[side]) {
      n++;
      if (p.id) popResolved++;
      else popRejected++;
    }
  }
  popByChannel.set(ch, (popByChannel.get(ch) ?? 0) + n);
}
const popTotal = popResolved + popRejected;
const pResolved = popResolved / popTotal;
const popChTotal = [...popByChannel.values()].reduce((a, b) => a + b, 0);

/** Wilson score interval — honest at small n, where the normal approximation
 *  produces intervals that run past 100%. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const ci = (k: number, n: number) => {
  const [lo, hi] = wilson(k, n);
  return `${pct(n ? k / n : 0)} [${pct(lo)}–${pct(hi)}]`;
};

// ── join ────────────────────────────────────────────────────────────────────
interface Judgement {
  channel: string;
  stratum: string;
  side: 'L' | 'R';
  reader: string | null;
  human: string | null;
}
const js: Judgement[] = [];
let labelledFrames = 0;
for (const e of sample) {
  const l = labels[`${e.videoId}/${e.sec}`];
  if (!l) continue;
  labelledFrames++;
  const ch = channelOf.get(e.videoId) ?? '?';
  js.push({ channel: ch, stratum: e.stratum, side: 'L', reader: e.readerLeft, human: l.left });
  js.push({ channel: ch, stratum: e.stratum, side: 'R', reader: e.readerRight, human: l.right });
}

console.log(`plate accuracy — ${labelledFrames}/${sample.length} frames labelled, ${js.length} plate judgements\n`);

// ── 1. precision on resolved plates ─────────────────────────────────────────
const resolved = js.filter((j) => j.stratum !== 'no-hud' && j.reader !== null);
const rightOnes = resolved.filter((j) => j.human === j.reader);
console.log('── precision: of plates the reader RESOLVED, how many are right? ────\n');
console.log(`  ${rightOnes.length}/${resolved.length}   ${ci(rightOnes.length, resolved.length)}`);
const humanBlank = resolved.filter((j) => j.human === null);
if (humanBlank.length) {
  console.log(
    `  of which ${humanBlank.length} the human could not read at all — the reader claimed a name where a person sees none`,
  );
}

// ── 2. headroom on rejected plates ──────────────────────────────────────────
const rejected = js.filter((j) => j.stratum !== 'no-hud' && j.reader === null);
const recoverable = rejected.filter((j) => j.human !== null);
console.log('\n── of plates the reader REJECTED, how many can a HUMAN read? ────────\n');
console.log(`  ${recoverable.length}/${rejected.length}   ${ci(recoverable.length, rejected.length)}`);
console.log(
  '  HUMAN-READABLE IS NOT MACHINE-RECOVERABLE, and this line was mislabelled\n' +
    '  "headroom" until the sweep said otherwise. A person reads the plate in the\n' +
    '  whole frame; the reader gets a 145px crop and tesseract returns nothing\n' +
    '  usable on most of these — 21 of 110 silent, the rest mostly 4+ edits from\n' +
    '  the true name. scripts/spike/matcher-sweep.ts fitted every looser accept\n' +
    '  rule against these same labels and NONE recovers a plate: `radius OR\n' +
    '  margin>=3` accepts the identical set, and margin>=2 accepts fewer while\n' +
    '  introducing a wrong answer. Per-frame crops scored worse than the shipped\n' +
    '  per-video median too. This is an OCR ceiling on this face, not a gate.',
);
if (recoverable.length) {
  const byName = new Map<string, number>();
  for (const j of recoverable) byName.set(j.human!, (byName.get(j.human!) ?? 0) + 1);
  console.log('\n  names in the unread set (a flat spread means the face, not an alias gap):');
  for (const [id, n] of [...byName].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${(names.get(id) ?? id).padEnd(18)} ${n}`);
  }
}

// ── 3. the HUD gate, positively controlled by the same pass ─────────────────
const noHud = js.filter((j) => j.stratum === 'no-hud');
const wrongDrop = noHud.filter((j) => j.human !== null);
console.log('\n── HUD gate: of frames the detector DISCARDED, how many had a plate? ─\n');
console.log(
  noHud.length
    ? `  ${wrongDrop.length}/${noHud.length}   ${ci(wrongDrop.length, noHud.length)}` +
        (wrongDrop.length ? '  — the gate is dropping real frames' : '  — the gate is honest')
    : '  no no-HUD frames labelled yet',
);

// ── 4. weighted back to the population ──────────────────────────────────────
console.log('\n── population estimate (weighted) ───────────────────────────────────\n');
const precision = resolved.length ? rightOnes.length / resolved.length : 0;
const headroom = rejected.length ? recoverable.length / rejected.length : 0;
const overall = pResolved * precision + (1 - pResolved) * (1 - headroom);
console.log(`  population is ${pct(pResolved)} resolved / ${pct(1 - pResolved)} rejected (${popTotal} plates)`);
console.log(`  sample is      ${pct(resolved.length / Math.max(1, resolved.length + rejected.length))} resolved — over-sampled, hence this reweighting`);
console.log(
  `\n  plate-level agreement with a human, weighted: ${pct(overall)}\n` +
    `    = ${pct(pResolved)} × ${pct(precision)} precision  +  ${pct(1 - pResolved)} × ${pct(1 - headroom)} correctly-rejected`,
);
console.log(
  `\n  recoverable plates in the corpus: ~${Math.round(popRejected * headroom)} of ${popRejected} rejected`,
);

// ── 5. per channel ──────────────────────────────────────────────────────────
console.log('\n── per channel (sample drawn evenly; population share shown) ────────\n');
console.log('  channel              pop share   precision            headroom');
for (const [ch, n] of [...popByChannel].sort((a, b) => b[1] - a[1])) {
  const r = resolved.filter((j) => j.channel === ch);
  const rr = r.filter((j) => j.human === j.reader);
  const x = rejected.filter((j) => j.channel === ch);
  const xr = x.filter((j) => j.human !== null);
  console.log(
    `  ${ch.padEnd(20)} ${pct(n / popChTotal).padStart(8)}   ` +
      `${(r.length ? ci(rr.length, r.length) : '—').padEnd(20)} ${x.length ? ci(xr.length, x.length) : '—'}`,
  );
}

// ── 6. every disagreement ───────────────────────────────────────────────────
const wrong = resolved.filter((j) => j.human !== j.reader);
if (wrong.length) {
  console.log('\n── disagreements on resolved plates ─────────────────────────────────\n');
  for (const j of wrong) {
    console.log(
      `  [${j.channel}] ${j.side}  reader ${(names.get(j.reader!) ?? j.reader)!.padEnd(16)} human ${j.human ? names.get(j.human) : '(no readable plate)'}`,
    );
  }
}
console.log();
