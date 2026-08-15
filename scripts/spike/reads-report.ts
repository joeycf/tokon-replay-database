/**
 * Score the PERSISTED reads through the shipped matcher — no OCR, no downloads.
 *
 * This is what persisting per-variant reads bought: changing the alias set, the
 * radius cap or the end-trim costs a re-fold of a JSON file instead of half an
 * hour of tesseract. Every number below moves when scripts/roster.ts moves.
 *
 * Run: npx tsx scripts/spike/reads-report.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CACHE } from '../hud-frames';
import { buildPlateRoster, loadCharacters, osa, norm } from '../roster';

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
  anchor: string;
  reads: PlateRead[];
}

const all = JSON.parse(readFileSync(join(CACHE, 'reads.json'), 'utf8')) as VideoReads[];
const roster = buildPlateRoster(await loadCharacters());
const keys = roster.keys;

/** Raw whole-string distance to the nearest key — the pre-matcher view. */
function rawDist(text: string): number {
  let d = Infinity;
  for (const k of keys) d = Math.min(d, osa(norm(text), k.key));
  return d;
}

/** The ensemble's answer for one plate: the best match across variants, with
 *  agreement counted over the variants that produced ANY text. */
function resolve(p: PlateRead) {
  let best: { id: string; dist: number; margin: number } | null = null;
  for (const v of p.variants) {
    const m = roster.match(v.text);
    if (m && (!best || m.dist < best.dist || (m.dist === best.dist && m.margin > best.margin))) {
      best = m;
    }
  }
  if (!best) return null;
  const votes = p.variants.filter((v) => roster.match(v.text)?.id === best!.id).length;
  return { ...best, votes, of: p.variants.length };
}

const plates = all.flatMap((v) => v.reads.map((r) => ({ ...r, channel: v.channel, vid: v.id })));
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');

// ── what the end-trim bought ────────────────────────────────────────────────
console.log('── the end-trim, measured ───────────────────────────────────────────\n');
let rawOk = 0;
let matched = 0;
for (const p of plates) {
  const bestRaw = Math.min(...p.variants.map((v) => rawDist(v.text)), Infinity);
  if (bestRaw === 0) rawOk++;
  if (resolve(p)) matched++;
}
console.log(`  plates                       ${plates.length}`);
console.log(`  whole-string exact hits      ${rawOk}  ${pct(rawOk, plates.length)}`);
console.log(`  resolved by the matcher      ${matched}  ${pct(matched, plates.length)}`);
console.log(
  `  recovered by end-trim + cap  ${matched - rawOk}  (+${((100 * (matched - rawOk)) / plates.length).toFixed(0)}pp)\n`,
);

// ── per channel and side ────────────────────────────────────────────────────
console.log('── resolved rate, per channel and side ──────────────────────────────\n');
console.log('  channel              left           right          both');
const byCh = new Map<string, { L: [number, number]; R: [number, number] }>();
for (const p of plates) {
  const e = byCh.get(p.channel) ?? { L: [0, 0], R: [0, 0] };
  e[p.side][1]++;
  if (resolve(p)) e[p.side][0]++;
  byCh.set(p.channel, e);
}
let tL = 0;
let tLn = 0;
let tR = 0;
let tRn = 0;
for (const [ch, e] of byCh) {
  tL += e.L[0];
  tLn += e.L[1];
  tR += e.R[0];
  tRn += e.R[1];
  const f = ([a, b]: [number, number]) => `${pct(a, b)} (${a}/${b})`.padEnd(14);
  console.log(
    `  ${ch.padEnd(20)} ${f(e.L)} ${f(e.R)} ${pct(e.L[0] + e.R[0], e.L[1] + e.R[1])}`,
  );
}
console.log(
  `  ${'ALL'.padEnd(20)} ${`${pct(tL, tLn)} (${tL}/${tLn})`.padEnd(14)} ` +
    `${`${pct(tR, tRn)} (${tR}/${tRn})`.padEnd(14)} ${pct(tL + tR, tLn + tRn)}\n`,
);

// ── distance histogram, after the matcher ───────────────────────────────────
console.log('── accepted reads by distance ───────────────────────────────────────\n');
const hist = new Map<number, number>();
for (const p of plates) {
  const m = resolve(p);
  if (m) hist.set(m.dist, (hist.get(m.dist) ?? 0) + 1);
}
for (const [d, c] of [...hist].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${d} edit(s)   ${String(c).padStart(5)}  ${pct(c, plates.length)}`);
}
console.log(`  rejected    ${String(plates.length - matched).padStart(5)}  ${pct(plates.length - matched, plates.length)}\n`);

// ── ensemble trim, re-selected through the fixed matcher ────────────────────
//
// The first selection ran before the end-trim existed and picked a subset tuned
// to whole-string scoring. Re-selecting is free because the reads are persisted:
// the subset that survives here is the one the production reader ships.
console.log('── ensemble trim: smallest variant subset worth paying for ──────────\n');
const VARIANTS = [...new Set(plates.flatMap((p) => p.variants.map((v) => `${v.t}:${v.neg}`)))].sort();
const rateOf = (keep: Set<string>) => {
  let ok = 0;
  for (const p of plates) {
    const sub = { ...p, variants: p.variants.filter((v) => keep.has(`${v.t}:${v.neg}`)) };
    if (resolve(sub)) ok++;
  }
  return ok / plates.length;
};
const full = rateOf(new Set(VARIANTS));
console.log(`  full ensemble (${VARIANTS.length}): ${(100 * full).toFixed(1)}%`);
const label = (k: string) => {
  const [t, neg] = k.split(':');
  return `${t === '0' ? 'norm' : t}${neg === 'true' ? '−' : '+'}`;
};
let chosen: string[] | null = null;
for (let size = 1; size <= 5 && !chosen; size++) {
  let bestSub: string[] = [];
  let bestRate = -1;
  const combos = (start: number, acc: string[]): void => {
    if (acc.length === size) {
      const r = rateOf(new Set(acc));
      if (r > bestRate) {
        bestRate = r;
        bestSub = [...acc];
      }
      return;
    }
    for (let k = start; k < VARIANTS.length; k++) combos(k + 1, [...acc, VARIANTS[k]!]);
  };
  combos(0, []);
  console.log(
    `  best ${size}: ${(100 * bestRate).toFixed(1)}%  (${((bestRate - full) * 100).toFixed(1)}pp)  ` +
      bestSub.map(label).join(' '),
  );
  if (full - bestRate <= 0.02) chosen = bestSub;
}
console.log(
  chosen
    ? `\n  ⇒ ship ${chosen.length} variants (${chosen.map(label).join(' ')}) — within 2pp of ${VARIANTS.length}, ` +
        `${(VARIANTS.length / chosen.length).toFixed(1)}× cheaper per plate\n`
    : `\n  ⇒ no subset of ≤5 lands within 2pp — keep all ${VARIANTS.length}\n`,
);

// ── which fighters the corpus has actually SHOWN ────────────────────────────
console.log('── plate renderings confirmed by an exact hit ───────────────────────\n');
const seen = new Map<string, number>();
for (const p of plates) {
  const m = resolve(p);
  if (m && m.dist === 0) seen.set(m.id, (seen.get(m.id) ?? 0) + 1);
}
const confirmed = keys.filter((k) => seen.has(k.id));
const unconfirmed = keys.filter((k) => !seen.has(k.id));
console.log(`  confirmed  ${confirmed.length}/${keys.length}: ${confirmed.map((k) => k.key).join(', ')}`);
console.log(
  `  UNOBSERVED ${unconfirmed.length}/${keys.length}: ${unconfirmed.map((k) => k.key).join(', ') || '—'}`,
);
console.log(
  '\n  An unobserved fighter keeps its canonical name on the assumption the plate\n' +
    '  renders it the same way as the confirmed ones. That is an assumption, and it\n' +
    '  is why the union is checked against the title-known fighter on every record.\n',
);
