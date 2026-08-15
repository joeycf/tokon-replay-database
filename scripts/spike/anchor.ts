/**
 * STEP 1 — fix the left-plate anchor, then persist every read.
 *
 * THE CAVEAT THIS EXISTS TO SETTLE. The sweep reported the right plate's anchor
 * tight (spread 0.015 across ten VODs) and the left's loose (0.054–0.108), and
 * called the difference bench-portrait contamination rather than framing
 * variance: the portraits sit left of the name and drag the left ink-start by a
 * variable amount, so a box anchored there wanders with the ART instead of with
 * the FRAME. If that reading is right, some share of the 35% of plates the probe
 * could not resolve is crop pollution, not letterforms — and the fix is geometry,
 * not a better reader.
 *
 * The proposed fix is to derive the noisy anchor from the clean one, `leftX0 =
 * 1 - rightX1`. That is a HYPOTHESIS ABOUT HUD SYMMETRY. It gets A/B'd against
 * the measured anchor over the same frames rather than asserted, and the loser
 * is reported alongside the winner.
 *
 * Three other things ride along, because they are the same pass over the same
 * cached frames and each one is owed:
 *
 *   · THE HASH FIX. `distinct()` compared hashes as `BigInt(parseInt(h, 36))`.
 *     parseInt returns a double, so a 64-bit hash lost its low ~11 bits and
 *     distinct plates were UNDER-counted. Re-reported here at both densities.
 *
 *   · DENSITY. The sweep's "median 4.0 distinct plates" came from recon's dense
 *     burst windows — 76-91% of its HUD frames sit within 3s of a neighbour. A
 *     spread sampler sees a different world, so both counts are printed and only
 *     the spread one may be quoted about a spread sampler.
 *
 *   · PERSISTED READS. Every variant string for every plate lands in
 *     cache/tokon/reads.json, so changing the fold, the alias set or the radius
 *     cap costs a re-fold rather than a re-read. The sweep plan promised this
 *     and the probe only printed to stdout.
 *
 * Nothing here downloads. It reads frames already cached by the sweep.
 *
 * Run: npx tsx scripts/spike/anchor.ts [--report]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorker } from 'tesseract.js';

import { CACHE } from '../hud-frames';
import {
  dhash,
  distinct,
  norm,
  platesOf,
  prep,
  WHITELIST,
  type Anchor,
  type Box,
} from '../hud-read';
import type { CharacterRecord } from '../../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REPORT_ONLY = process.argv.includes('--report');

/** The full ensemble the probe ran. Trimming it is one of this script's jobs:
 *  at ten variants a full-corpus pass is ~5h, at three it is ~1.5h, and that
 *  difference is the frame budget the fold needs to find a fourth fighter. */
const THRESHOLDS = [0, 150, 175, 200, 225]; // 0 = normalise instead of threshold
const POLARITIES = [true, false];
/** A/B the anchor on this many frames per video before committing to one. */
const AB_FRAMES = 8;

interface SweepRow {
  id: string;
  channel: string;
  bandY0: number;
  bandY1: number;
  leftX0: number;
  rightX1: number;
  hudFrames: number;
  hudSecs: number[];
}

interface Variant {
  t: number;
  neg: boolean;
  text: string;
}
interface PlateRead {
  sec: number;
  side: 'L' | 'R';
  variants: Variant[];
}
interface VideoReads {
  id: string;
  channel: string;
  anchor: Anchor;
  plates: { left: Box; right: Box };
  reads: PlateRead[];
}

// ── optimal string alignment ────────────────────────────────────────────────
function osa(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array<number>(n).fill(0)]);
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

const sweep = JSON.parse(readFileSync(join(CACHE, 'sweep.json'), 'utf8')) as SweepRow[];
const characters = JSON.parse(
  readFileSync(join(ROOT, 'data/characters.json'), 'utf8'),
) as CharacterRecord[];

/** THE READER'S KEY SET IS THE CANONICAL 21, NOT THE 54 PROSE ALIASES.
 *  The HUD prints exactly one string per fighter; `DOOM`, `SPIDEY` and `STROM`
 *  exist because UPLOADERS write them in titles. Feeding the prose table to a
 *  pixel reader adds four-letter mint targets and creates every cheap
 *  cross-character transition in the roster (DOOM/LOKI/PENI/STORM sit at
 *  distance 3), which the radius cap would then spend its whole budget on.
 *  Step 2 formalises this split; step 1 only needs the distances to be measured
 *  against the strings the plate can actually show. */
const plateKeys = characters.map((c) => ({ id: c.id, key: norm(c.name) }));

/** Best roster hit for one OCR string, over the canonical set. No radius cap
 *  here on purpose — the cap is step 2, and the point of this pass is the raw
 *  distance HISTOGRAM the cap will later be applied to. */
function best(text: string): { id: string; dist: number } | null {
  if (text.length < 2) return null;
  let b: { id: string; dist: number } | null = null;
  for (const k of plateKeys) {
    const d = osa(text, k.key);
    if (!b || d < b.dist) b = { id: k.id, dist: d };
  }
  return b;
}

/** Best hit across a SET of variant readings — the ensemble's answer. */
function bestOf(variants: Variant[]): { id: string; dist: number } | null {
  let b: { id: string; dist: number } | null = null;
  for (const v of variants) {
    const m = best(v.text);
    if (m && (!b || m.dist < b.dist)) b = m;
  }
  return b;
}

const framePath = (id: string, sec: number) =>
  join(CACHE, 'frames', id, `${String(sec).padStart(6, '0')}.png`);

const READS = join(CACHE, 'reads.json');

// ── part A: the hash fix, at both densities ─────────────────────────────────
async function partA(): Promise<void> {
  console.log('── A. distinct plates per side, exact hash, both densities ──────────\n');
  console.log('  channel              video         burst  L/R      spread  L/R');
  const rows: { burst: number[]; spread: number[] }[] = [];
  for (const v of sweep.filter((s) => s.hudFrames > 0)) {
    const boxes = platesOf(v, 'symmetric');
    const hl: string[] = [];
    const hr: string[] = [];
    for (const sec of v.hudSecs) {
      const f = framePath(v.id, sec);
      if (!existsSync(f)) continue;
      hl.push(await dhash(f, boxes.left));
      hr.push(await dhash(f, boxes.right));
    }
    // one frame per burst — what a 12-singleton spread plan would have landed on
    const keep: number[] = [];
    for (let k = 0; k < v.hudSecs.length; k++) {
      if (k === 0 || v.hudSecs[k]! - v.hudSecs[keep[keep.length - 1]!]! > 3) keep.push(k);
    }
    const bL = distinct(hl);
    const bR = distinct(hr);
    const sL = distinct(keep.map((k) => hl[k]!).filter(Boolean));
    const sR = distinct(keep.map((k) => hr[k]!).filter(Boolean));
    rows.push({ burst: [bL, bR], spread: [sL, sR] });
    console.log(
      `  ${v.channel.padEnd(20)} ${v.id.padEnd(12)} ${String(hl.length).padStart(4)}  ${bL}/${bR}` +
        `      ${String(keep.length).padStart(4)}  ${sL}/${sR}`,
    );
  }
  const all = (f: (r: (typeof rows)[number]) => number[]) => rows.flatMap(f).sort((a, b) => a - b);
  const med = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? 0;
  const burst = all((r) => r.burst);
  const spread = all((r) => r.spread);
  console.log(
    `\n  burst  density: median ${med(burst).toFixed(1)}  ·  >=3 on ${burst.filter((x) => x >= 3).length}/${burst.length}  ·  >=4 on ${burst.filter((x) => x >= 4).length}/${burst.length}`,
  );
  console.log(
    `  spread density: median ${med(spread).toFixed(1)}  ·  >=3 on ${spread.filter((x) => x >= 3).length}/${spread.length}  ·  >=4 on ${spread.filter((x) => x >= 4).length}/${spread.length}`,
  );
  console.log(
    '\n  Only the SPREAD row may be quoted about a spread sampler. The burst row is\n' +
      '  an upper bound produced by recon’s dense windows.\n',
  );
}

// ── part B: the anchor A/B ──────────────────────────────────────────────────
async function partB(
  worker: Awaited<ReturnType<typeof createWorker>>,
): Promise<{ winner: Anchor; table: string }> {
  console.log('── B. left-plate anchor: measured ink-start vs derived from the right ──\n');
  const score: Record<Anchor, Record<'L' | 'R', { hit: number; near: number; n: number }>> = {
    measured: { L: { hit: 0, near: 0, n: 0 }, R: { hit: 0, near: 0, n: 0 } },
    symmetric: { L: { hit: 0, near: 0, n: 0 }, R: { hit: 0, near: 0, n: 0 } },
  };

  for (const v of sweep.filter((s) => s.hudFrames > 0)) {
    const step = Math.max(1, Math.floor(v.hudSecs.length / AB_FRAMES));
    const picks = v.hudSecs.filter((_, i) => i % step === 0).slice(0, AB_FRAMES);
    for (const anchor of ['measured', 'symmetric'] as Anchor[]) {
      const boxes = platesOf(v, anchor);
      for (const sec of picks) {
        const f = framePath(v.id, sec);
        if (!existsSync(f)) continue;
        for (const [side, box] of [
          ['L', boxes.left],
          ['R', boxes.right],
        ] as ['L' | 'R', Box][]) {
          const variants: Variant[] = [];
          for (const t of THRESHOLDS) {
            for (const neg of POLARITIES) {
              const { data } = await worker.recognize(await prep(f, box, t, neg));
              const text = norm(data.text);
              if (text) variants.push({ t, neg, text });
            }
          }
          const b = bestOf(variants);
          const s = score[anchor][side];
          s.n++;
          if (b && b.dist === 0) s.hit++;
          else if (b && b.dist <= 2) s.near++;
        }
      }
    }
  }

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
  const lines = ['  anchor      side   plates   exact   <=2 edits   resolved'];
  for (const anchor of ['measured', 'symmetric'] as Anchor[]) {
    for (const side of ['L', 'R'] as const) {
      const s = score[anchor][side];
      lines.push(
        `  ${anchor.padEnd(11)} ${side}    ${String(s.n).padStart(5)}   ${pct(s.hit, s.n).padStart(5)}   ` +
          `${pct(s.near, s.n).padStart(9)}   ${pct(s.hit + s.near, s.n).padStart(8)}`,
      );
    }
  }
  const table = lines.join('\n');
  console.log(table);

  const rate = (a: Anchor, side: 'L' | 'R') => {
    const s = score[a][side];
    return s.n ? (s.hit + s.near) / s.n : 0;
  };
  // The RIGHT plate is identical under both anchors by construction, so it is the
  // control: if it moves, the harness is wrong, not the anchor.
  const drift = Math.abs(rate('measured', 'R') - rate('symmetric', 'R'));
  console.log(
    `\n  right-plate control drift: ${(100 * drift).toFixed(1)}pp  ` +
      `(identical box under both anchors — anything above ~0 means the harness moved, not the anchor)`,
  );
  const winner: Anchor = rate('symmetric', 'L') >= rate('measured', 'L') ? 'symmetric' : 'measured';
  console.log(
    `\n  LEFT plate: measured ${(100 * rate('measured', 'L')).toFixed(0)}%  vs  ` +
      `symmetric ${(100 * rate('symmetric', 'L')).toFixed(0)}%  →  ${winner.toUpperCase()}\n`,
  );
  return { winner, table };
}

// ── part C: persist every read at the winning anchor ────────────────────────
async function partC(
  worker: Awaited<ReturnType<typeof createWorker>>,
  anchor: Anchor,
): Promise<VideoReads[]> {
  console.log(`── C. persisting all variant reads at the ${anchor} anchor ──────────\n`);
  const out: VideoReads[] = [];
  for (const [i, v] of sweep.filter((s) => s.hudFrames > 0).entries()) {
    const boxes = platesOf(v, anchor);
    const reads: PlateRead[] = [];
    for (const sec of v.hudSecs) {
      const f = framePath(v.id, sec);
      if (!existsSync(f)) continue;
      for (const [side, box] of [
        ['L', boxes.left],
        ['R', boxes.right],
      ] as ['L' | 'R', Box][]) {
        const variants: Variant[] = [];
        for (const t of THRESHOLDS) {
          for (const neg of POLARITIES) {
            const { data } = await worker.recognize(await prep(f, box, t, neg));
            const text = norm(data.text);
            if (text) variants.push({ t, neg, text });
          }
        }
        reads.push({ sec, side, variants });
      }
    }
    out.push({ id: v.id, channel: v.channel, anchor, plates: boxes, reads });
    writeFileSync(READS, JSON.stringify(out, null, 1));
    console.log(`  [${i + 1}] ${v.id} (${v.channel}) — ${reads.length} plates`);
  }
  console.log(`\n  ✔ ${READS}\n`);
  return out;
}

// ── reporting off the persisted reads ───────────────────────────────────────
function report(all: VideoReads[]): void {
  const plates = all.flatMap((v) => v.reads.map((r) => ({ ...r, channel: v.channel })));

  console.log('── D. distance histogram (the number the radius cap acts on) ────────\n');
  const hist = new Map<number | 'none', number>();
  for (const p of plates) {
    const b = bestOf(p.variants);
    const k = b ? Math.min(b.dist, 5) : ('none' as const);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const n = plates.length;
  const pct = (c: number) => `${((100 * c) / n).toFixed(0)}%`;
  for (const k of [0, 1, 2, 3, 4, 5, 'none' as const]) {
    const c = hist.get(k) ?? 0;
    const label = k === 'none' ? 'no text at all' : k === 5 ? '5+ edits' : `${k} edit(s)`;
    console.log(`  ${label.padEnd(16)} ${String(c).padStart(5)}  ${pct(c).padStart(5)}`);
  }
  const within1 = (hist.get(0) ?? 0) + (hist.get(1) ?? 0);
  console.log(
    `\n  The sweep quoted "39% exact + 26% within 2 = 65%". A cap of 1 binds on 8 of\n` +
      `  21 names, so the honest per-plate number for those is the <=1 band:\n` +
      `  exact ${pct(hist.get(0) ?? 0)} · within 1 ${pct(within1)} · within 2 ` +
      `${pct(within1 + (hist.get(2) ?? 0))}\n`,
  );

  console.log('── E. ensemble trim: smallest variant subset worth paying for ───────\n');
  const idx = THRESHOLDS.flatMap((t) => POLARITIES.map((neg) => ({ t, neg })));
  const keyOf = (v: Variant) => `${v.t}:${v.neg}`;
  const scoreSubset = (subset: { t: number; neg: boolean }[]) => {
    const keys = new Set(subset.map((s) => `${s.t}:${s.neg}`));
    let hit = 0;
    let near = 0;
    for (const p of plates) {
      const b = bestOf(p.variants.filter((v) => keys.has(keyOf(v))));
      if (b && b.dist === 0) hit++;
      else if (b && b.dist <= 1) near++;
    }
    return (hit + near) / n;
  };
  const full = scoreSubset(idx);
  const bestBySize: { size: number; subset: typeof idx; rate: number }[] = [];
  for (let size = 1; size <= 4; size++) {
    let bestSub: typeof idx = [];
    let bestRate = -1;
    const combos = (start: number, acc: typeof idx) => {
      if (acc.length === size) {
        const r = scoreSubset(acc);
        if (r > bestRate) {
          bestRate = r;
          bestSub = [...acc];
        }
        return;
      }
      for (let k = start; k < idx.length; k++) combos(k + 1, [...acc, idx[k]!]);
    };
    combos(0, []);
    bestBySize.push({ size, subset: bestSub, rate: bestRate });
  }
  console.log(`  full ensemble (${idx.length} variants): ${(100 * full).toFixed(1)}% resolved <=1`);
  for (const b of bestBySize) {
    const desc = b.subset
      .map((s) => `${s.t === 0 ? 'norm' : s.t}${s.neg ? '−' : '+'}`)
      .join(' ');
    console.log(
      `  best ${b.size}: ${(100 * b.rate).toFixed(1)}%  (${(100 * (b.rate - full)).toFixed(1)}pp)  ${desc}`,
    );
  }
  const pick = bestBySize.find((b) => full - b.rate <= 0.02);
  console.log(
    pick
      ? `\n  ⇒ ${pick.size} variants land within 2pp of ten. Cost per plate drops ${(idx.length / pick.size).toFixed(1)}×.\n`
      : `\n  ⇒ no subset of <=4 lands within 2pp of the full ensemble — keep all ${idx.length}.\n`,
  );

  console.log('── F. per-channel resolved rate at the chosen anchor ────────────────\n');
  const byCh = new Map<string, { L: [number, number]; R: [number, number] }>();
  for (const p of plates) {
    const e = byCh.get(p.channel) ?? { L: [0, 0], R: [0, 0] };
    const b = bestOf(p.variants);
    e[p.side][1]++;
    if (b && b.dist <= 1) e[p.side][0]++;
    byCh.set(p.channel, e);
  }
  console.log('  channel              left        right');
  for (const [ch, e] of byCh) {
    const f = ([a, b]: [number, number]) => (b ? `${((100 * a) / b).toFixed(0)}% (${a}/${b})` : '—');
    console.log(`  ${ch.padEnd(20)} ${f(e.L).padEnd(11)} ${f(e.R)}`);
  }
  console.log();
}

// ── main ────────────────────────────────────────────────────────────────────
mkdirSync(CACHE, { recursive: true });

if (REPORT_ONLY) {
  if (!existsSync(READS)) {
    console.error(`✖ ${READS} does not exist — run without --report first.`);
    process.exit(1);
  }
  report(JSON.parse(readFileSync(READS, 'utf8')) as VideoReads[]);
} else {
  await partA();
  const worker = await createWorker('eng', undefined, { logger: () => {} });
  await worker.setParameters({
    tessedit_char_whitelist: WHITELIST,
    tessedit_pageseg_mode: '7' as never, // single text line
  });
  const { winner } = await partB(worker);
  const all = await partC(worker, winner);
  await worker.terminate();
  report(all);
}
