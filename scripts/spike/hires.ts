/**
 * Does 1080p make the bench diamonds readable? A bounded test before paying.
 *
 * Step 0 concluded no re-download was justified, and that conclusion was drawn on
 * the BUST — a large, unframed portrait that hashes cleanly at 720p (same fighter
 * across channels, 12.9 bits). It never covered the DIAMONDS, which are the actual
 * payload and are roughly 31x31 effective pixels at 720p. At 1080p they are ~47x47,
 * 2.25x the pixels, and the 8x8 hash grid goes from ~4x4 px per cell to ~6x6.
 *
 * That is the one remaining lever that adds INFORMATION rather than rearranging it:
 * co-occurrence tops out at 46.9% top-3 recall as an upper bound, transfer is dead,
 * and a colour descriptor measured worse than greyscale on a known-answer control.
 *
 * Bounded on purpose — ~10 videos, the same burst windows already cached at 720p,
 * so the two resolutions are compared on the SAME SECONDS rather than on two
 * different samples of footage. LOCAL ONLY; YouTube blocks datacenter IPs.
 *
 * Run: npx tsx scripts/spike/hires.ts [--videos N] [--windows N] [--measure-only]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { burstPlan, CACHE, grabWindow, pruneClips, stamp } from '../hud-frames';
import type { FrameRead, PlateGeom } from '../hud-read';
import { ASSIST_CELLS, cellHash, group, hamming } from '../portrait-read';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HI = join(CACHE, 'frames1080');
const LO = join(CACHE, 'frames');
const argv = process.argv.slice(2);
const num = (f: string, d: number) => Number(argv[argv.indexOf(f) + 1]) || d;
const N_VIDEOS = num('--videos', 10);
const N_WINDOWS = num('--windows', 8);
const MEASURE_ONLY = argv.includes('--measure-only');

interface Extracted {
  left: FrameRead[];
  right: FrameRead[];
  hud: number;
  geom: PlateGeom | null;
}
const extracted = JSON.parse(
  readFileSync(join(CACHE, 'extracted.json'), 'utf8'),
) as Record<string, Extracted>;
const videos = JSON.parse(readFileSync(join(ROOT, 'data/videos.json'), 'utf8')) as {
  id: string;
  intake: string;
  durationSec: number;
  sides: { provenance: { fromDescription?: string[] } }[];
}[];

/** Truth is the DESCRIPTION's bench, never `characters.length === 4` — that
 *  predicate now admits sides the footage tier itself completed. */
const truth = new Map<string, [string[], string[]]>();
for (const v of videos) {
  if (v.sides.length !== 2) continue;
  const a = v.sides[0]!.provenance.fromDescription ?? [];
  const b = v.sides[1]!.provenance.fromDescription ?? [];
  if (a.length === 4 && b.length === 4) truth.set(v.id, [a, b]);
}

// pick videos with a known bench, cached frames, and plenty of resolved reads —
// spread across channels so this is not one uploader's encoder
const picks = videos
  .filter((v) => truth.has(v.id) && extracted[v.id]?.geom && existsSync(join(LO, v.id)))
  .sort((a, b) => (extracted[b.id]!.hud ?? 0) - (extracted[a.id]!.hud ?? 0))
  .slice(0, N_VIDEOS);

if (!MEASURE_ONLY) {
  console.log(`fetching ${picks.length} videos at 1080p — ${N_WINDOWS} windows each\n`);
  for (const [i, v] of picks.entries()) {
    const starts = burstPlan(v.durationSec, 12).slice(0, N_WINDOWS);
    let got = 0;
    for (const s of starts) {
      got += (await grabWindow(v.id, s, 6, 1, { maxHeight: 1080, framesDir: HI })).length;
    }
    pruneClips(v.id);
    const dir = join(HI, v.id);
    const n = existsSync(dir) ? readdirSync(dir).length : 0;
    console.log(`  [${i + 1}/${picks.length}] ${v.id} (${v.intake}) — ${n} frames on disk (${got} requested)`);
  }
  console.log();
}

// ── measure both resolutions on the SAME seconds ────────────────────────────
interface Rec {
  video: string;
  expected: string[];
  hs: string[];
}
async function collect(dir: string, label: string) {
  const recs: Rec[] = [];
  const perSide = new Map<string, string[]>();
  let frames = 0;
  let w = 0;
  for (const v of picks) {
    const benches = truth.get(v.id)!;
    const e = extracted[v.id]!;
    for (const side of ['L', 'R'] as const) {
      const reads = (side === 'L' ? e.left : e.right).filter((r) => r.id && r.dist === 0);
      const picked: FrameRead[] = [];
      for (const r of reads) {
        if (picked.length >= 20) break;
        if (picked.every((p) => Math.abs(p.sec - r.sec) > 4)) picked.push(r);
      }
      for (const r of picked) {
        const f = join(dir, v.id, `${stamp(r.sec)}.png`);
        // the SAME second must exist in both caches or the comparison is between
        // two different samples of footage rather than between two resolutions
        if (!existsSync(f) || !existsSync(join(LO, v.id, `${stamp(r.sec)}.png`))) continue;
        if (!existsSync(join(HI, v.id, `${stamp(r.sec)}.png`))) continue;
        const owning = benches.filter((b) => b.includes(r.id!));
        if (owning.length !== 1) continue;
        let raw;
        try {
          raw = await sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true });
        } catch {
          continue;
        }
        const { data, info } = raw;
        w = info.width;
        const hs = ASSIST_CELLS.map((c) => cellHash(data, info.width, info.height, side, c));
        recs.push({ video: v.id, expected: owning[0]!.filter((c) => c !== r.id), hs });
        const k = `${v.id}/${side}`;
        perSide.set(k, [...(perSide.get(k) ?? []), ...hs]);
        frames++;
      }
    }
  }
  console.log(`\n  ${label}  —  ${frames} frames, ${perSide.size} sides, frame width ${w}px`);

  const byK = new Map<number, number[]>();
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      if (recs[i]!.video === recs[j]!.video) continue;
      const k = recs[i]!.expected.filter((e) => recs[j]!.expected.includes(e)).length;
      let min = 64;
      for (const a of recs[i]!.hs) for (const b of recs[j]!.hs) min = Math.min(min, hamming(a, b));
      byK.set(k, [...(byK.get(k) ?? []), min]);
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  console.log('     shared (k)   side-pairs   mean best distance');
  const ks = [...byK.keys()].sort();
  for (const k of ks) {
    console.log(
      `     ${String(k).padStart(6)}       ${String(byK.get(k)!.length).padStart(6)}       ${mean(byK.get(k)!).toFixed(2).padStart(10)}`,
    );
  }
  const spread = ks.length > 1 ? mean(byK.get(ks[0]!)!) - mean(byK.get(ks[ks.length - 1]!)!) : 0;
  console.log(`     separation k=${ks[0]} to k=${ks[ks.length - 1]}: ${spread.toFixed(2)} bits`);

  let gTot = 0;
  let top3 = 0;
  let n = 0;
  for (const hs of perSide.values()) {
    if (hs.length < 12) continue;
    const gs = group(hs, 10);
    gTot += gs.length;
    top3 += gs.slice(0, 3).reduce((a, g) => a + g.members.length, 0) / hs.length;
    n++;
  }
  console.log(
    `     clustering (t=10): ${(gTot / n).toFixed(1)} groups per side, top-3 cover ${((100 * top3) / n).toFixed(0)}% of crops`,
  );
  return { spread, groups: gTot / n, cover: (100 * top3) / n };
}

const lo = await collect(LO, '720p  (~31x31 px per diamond)');
const hi = await collect(HI, '1080p (~47x47 px per diamond)');
console.log(
  `\n  VERDICT  separation ${lo.spread.toFixed(2)} -> ${hi.spread.toFixed(2)} bits · ` +
    `groups/side ${lo.groups.toFixed(1)} -> ${hi.groups.toFixed(1)} · top-3 cover ${lo.cover.toFixed(0)}% -> ${hi.cover.toFixed(0)}%`,
);
console.log('  A side fields THREE assists, so groups/side approaching 3 with high');
console.log('  cover is what "readable" looks like. If 1080p does not move these,');
console.log('  resolution is not the constraint and we stop asking.\n');
export {};
