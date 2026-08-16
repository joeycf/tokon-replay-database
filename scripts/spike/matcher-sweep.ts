/**
 * What should the matcher's accept rule be? Fitted against human plate labels.
 *
 * The human pass says the reader is NOT at its ceiling: of the plates it
 * rejected, 93% are readable by a person, and 71% of those had OCR text that the
 * MATCHER refused. So the bottleneck is the accept rule, not the letterforms and
 * not the crop.
 *
 * The current rule is the ported per-alias radius cap: accept when the edit
 * distance is within `min(lengthScaled(text), radius)` where
 * `radius = floor((distance to the nearest other plate key - 1) / 2)`. Eight of
 * 21 names have radius 1, so a 2-edit read of BLADE or STORM is thrown away
 * however unambiguous it is — and the step-1 histogram put 30% of all plates at
 * distance 2 or 3.
 *
 * `PlateMatch.margin` — the gap to the runner-up id — was built in step 2 and
 * never used in the accept decision. A read 3 edits from STORM and 9 from
 * everything else is not ambiguous; it is just noisy. This sweeps rules that use
 * it against 236 human-labelled plates and reports what each buys and costs.
 *
 * PRECISION IS THE CONSTRAINT, NOT THE OBJECTIVE. The reader currently scores
 * 118/118 on resolved plates. A rule that recovers a hundred plates and breaks
 * precision is a worse reader, because a wrong fighter is published and a
 * missing one merely stays in the bench queue.
 *
 * Re-OCRs the 132 sample frames (~1 min, no downloads) and caches the raw
 * variant strings, so re-sweeping the rule afterwards is free.
 *
 * Run: npx tsx scripts/spike/matcher-sweep.ts [--reread]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorker } from 'tesseract.js';

import { VARIANTS } from '../extract';
import { CACHE, framesOf } from '../hud-frames';
import { grey, measure, platesOf, prep, WHITELIST, type Box } from '../hud-read';
import { loadCharacters, norm, osa } from '../roster';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REREAD = process.argv.includes('--reread');
const PER_FRAME = process.argv.includes('--per-frame');
/** Per-video median geometry (production) vs each frame's own measurement.
 *  The sweep found no matcher win, and the misses are OCR producing garbage on
 *  a crop a human reads fine — which points at the CROP, not the accept rule.
 *  This is the A/B that settles it. */
const RAW = join(CACHE, PER_FRAME ? 'plate-raw-perframe.json' : 'plate-raw.json');

interface SampleEntry {
  videoId: string;
  sec: number;
  stratum: string;
}
const { sample } = JSON.parse(readFileSync(join(CACHE, 'plate-sample.json'), 'utf8')) as {
  sample: SampleEntry[];
};
const labels = JSON.parse(readFileSync(join(ROOT, 'data/plate-labels.json'), 'utf8')) as Record<
  string,
  { left: string | null; right: string | null }
>;
const videos = JSON.parse(readFileSync(join(ROOT, 'data/videos.json'), 'utf8')) as {
  id: string;
  intake: string;
}[];
const channelOf = new Map(videos.map((v) => [v.id, v.intake]));

// ── raw OCR for every sampled plate, cached ─────────────────────────────────
interface RawPlate {
  key: string;
  channel: string;
  side: 'L' | 'R';
  texts: string[];
  human: string | null;
}

const raws: RawPlate[] =
  existsSync(RAW) && !REREAD ? (JSON.parse(readFileSync(RAW, 'utf8')) as RawPlate[]) : [];

if (!raws.length) {
  const worker = await createWorker('eng', undefined, { logger: () => {} });
  await worker.setParameters({
    tessedit_char_whitelist: WHITELIST,
    tessedit_pageseg_mode: '7' as never,
  });
  // THE CROP MUST BE PRODUCTION'S, OR THIS MEASURES A DIFFERENT READER.
  // `readCached` derives ONE geometry per video — the median over its HUD frames
  // — and crops every frame of that video through it. An earlier version of this
  // script re-measured each frame individually, which produced exact reads on
  // plates production had rejected and made the whole comparison meaningless:
  // it was scoring a reader that does not exist. Rebuild the per-video median
  // the same way `hudFramesOf` does.
  const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const geomOf = new Map<string, { bandY0: number; bandY1: number; leftX0: number; rightX1: number }>();
  for (const vid of new Set(sample.map((e) => e.videoId))) {
    const rows: { y0: number; y1: number; lx: number; rx: number }[] = [];
    for (const f of framesOf(vid)) {
      const { d, W, H } = await grey(f);
      const m = measure(d, W, H);
      if (!m.hud) continue;
      rows.push({ y0: m.band!.y0, y1: m.band!.y1, lx: m.left!.x0, rx: m.right!.x1 });
    }
    if (rows.length) {
      geomOf.set(vid, {
        bandY0: med(rows.map((r) => r.y0)),
        bandY1: med(rows.map((r) => r.y1)),
        leftX0: med(rows.map((r) => r.lx)),
        rightX1: med(rows.map((r) => r.rx)),
      });
    }
  }

  console.log(`re-reading ${sample.length} sampled frames for their raw OCR strings…\n`);
  for (const [i, e] of sample.entries()) {
    const key = `${e.videoId}/${e.sec}`;
    const lab = labels[key];
    if (!lab) continue;
    const file = join(CACHE, 'frames', e.videoId, `${String(e.sec).padStart(6, '0')}.png`);
    if (!existsSync(file)) continue;
    let geom = geomOf.get(e.videoId);
    if (PER_FRAME) {
      const { d, W, H } = await grey(file);
      const m = measure(d, W, H);
      if (m.hud) geom = { bandY0: m.band!.y0, bandY1: m.band!.y1, leftX0: m.left!.x0, rightX1: m.right!.x1 };
    }
    if (!geom) continue;
    const boxes = platesOf(geom, 'symmetric');
    for (const [side, box] of [
      ['L', boxes.left],
      ['R', boxes.right],
    ] as ['L' | 'R', Box][]) {
      const texts: string[] = [];
      for (const v of VARIANTS) {
        const { data } = await worker.recognize(await prep(file, box, v.t, v.neg));
        const t = norm(data.text);
        if (t) texts.push(t);
      }
      raws.push({
        key,
        channel: channelOf.get(e.videoId) ?? '?',
        side,
        texts,
        human: side === 'L' ? lab.left : lab.right,
      });
    }
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${sample.length}`);
  }
  await worker.terminate();
  writeFileSync(RAW, JSON.stringify(raws, null, 1));
  console.log(`\n✔ ${RAW} — ${raws.length} plates\n`);
}

// ── the candidate rules ─────────────────────────────────────────────────────
const chars = await loadCharacters();
const keys = chars.map((c) => ({ id: c.id, key: norm(c.name) }));
const nearest = new Map(
  keys.map((k) => [k.id, Math.min(...keys.filter((o) => o.id !== k.id).map((o) => osa(k.key, o.key)))]),
);
const radius = new Map([...nearest].map(([id, n]) => [id, Math.max(0, Math.floor((n - 1) / 2))]));

const MAX_LEAD = 3;
const MAX_TRAIL = 4;
function trims(text: string): string[] {
  const out: string[] = [];
  for (let lead = 0; lead <= MAX_LEAD; lead++) {
    for (let trail = 0; trail <= MAX_TRAIL; trail++) {
      const c = text.slice(lead, text.length - trail).trim();
      if (c.length >= 3) out.push(c);
    }
  }
  return [...new Set(out)];
}

/** Best (distance, margin, length) per key for one OCR string. */
function score(text: string) {
  const cands = trims(text);
  if (!cands.length) return null;
  const scored = keys
    .map((k) => {
      let d = Infinity;
      let len = text.length;
      for (const c of cands) {
        const e = osa(c, k.key);
        if (e < d) {
          d = e;
          len = c.length;
        }
      }
      return { k, d, len };
    })
    .sort((a, b) => a.d - b.d);
  const top = scored[0]!;
  const runner = scored.find((s) => s.k.id !== top.k.id);
  return { id: top.k.id, dist: top.d, len: top.len, margin: runner ? runner.d - top.d : Infinity };
}

const lengthScaled = (len: number) => Math.max(1, Math.round(len / 4));

interface Rule {
  name: string;
  accept: (m: NonNullable<ReturnType<typeof score>>) => boolean;
}
const RULES: Rule[] = [
  {
    name: 'radius cap (shipping)',
    accept: (m) => m.dist <= Math.min(lengthScaled(m.len), radius.get(m.id) ?? 0),
  },
  { name: 'margin >= 2', accept: (m) => m.margin >= 2 },
  { name: 'margin >= 3', accept: (m) => m.margin >= 3 },
  { name: 'margin >= 4', accept: (m) => m.margin >= 4 },
  {
    name: 'radius OR margin >= 3',
    accept: (m) =>
      m.dist <= Math.min(lengthScaled(m.len), radius.get(m.id) ?? 0) || m.margin >= 3,
  },
  {
    name: 'radius OR margin >= 4',
    accept: (m) =>
      m.dist <= Math.min(lengthScaled(m.len), radius.get(m.id) ?? 0) || m.margin >= 4,
  },
  {
    name: 'margin >= 3 AND dist <= 4',
    accept: (m) => m.margin >= 3 && m.dist <= 4,
  },
  {
    name: 'margin >= 3 AND dist <= 5',
    accept: (m) => m.margin >= 3 && m.dist <= 5,
  },
];

/** Apply a rule across a plate's variant strings; best accepted wins. */
function decide(p: RawPlate, rule: Rule): string | null {
  let best: { id: string; dist: number; margin: number } | null = null;
  for (const t of p.texts) {
    const m = score(t);
    if (!m || !rule.accept(m)) continue;
    if (!best || m.dist < best.dist || (m.dist === best.dist && m.margin > best.margin)) best = m;
  }
  return best?.id ?? null;
}

console.log(`matcher sweep — ${raws.length} human-labelled plates\n`);
console.log('  rule                       accepted   CORRECT   WRONG   missed   plate accuracy');
for (const rule of RULES) {
  let accepted = 0;
  let correct = 0;
  let wrong = 0;
  let missed = 0;
  let agree = 0;
  for (const p of raws) {
    const got = decide(p, rule);
    if (got) {
      accepted++;
      if (got === p.human) correct++;
      else wrong++;
    } else if (p.human) missed++;
    if (got === p.human) agree++;
  }
  console.log(
    `  ${rule.name.padEnd(26)} ${String(accepted).padStart(5)}   ${String(correct).padStart(7)}   ` +
      `${String(wrong).padStart(5)}   ${String(missed).padStart(6)}   ${((100 * agree) / raws.length).toFixed(1)}%`,
  );
}
console.log(
  '\n  WRONG is the column that matters. A wrong fighter is published; a missed one\n' +
    '  stays in the bench queue and costs nothing but another pass.\n',
);
