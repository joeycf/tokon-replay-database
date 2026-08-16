/**
 * Draw the frame sample a human will read, stratified by what the READER did.
 *
 * The reader's claim is per-plate: *this crop says STORM*. Asking a human the
 * same question about the same crop compares like with like — no union
 * arithmetic, no coverage confound, and nothing on screen to copy. The previous
 * pass asked for a union over 8 frames while the reader had read 70, which was
 * unfair to the reader before contamination was even considered.
 *
 * TWO STRATA, AND THE SECOND IS WHERE THE VALUE IS.
 *
 *   resolved  the reader returned an id  -> measures PRECISION
 *   rejected  the reader returned null   -> measures HEADROOM
 *
 * Rejected plates are 16% of the population (918 of 5754). Only a human can say
 * whether those were genuinely illegible or whether a readable name was thrown
 * away by an alias gap or the radius cap, and that is the number deciding
 * whether the reader is at its ceiling or has recall left on the table. So they
 * are OVER-SAMPLED to roughly half the plate set — which biases the raw rates,
 * which is why the sample records its strata and the scorer weights back to the
 * population.
 *
 * Frames with NO HUD at all are included at ~10% as a POSITIVE CONTROL on the
 * HUD gate. If the human marks them unreadable the gate is doing its job; if the
 * human reads a plate on one, the gate is discarding real frames. A gate nobody
 * tests is a gate nobody can trust.
 *
 * A frame with exactly one rejected plate is the efficient unit — it yields one
 * of each stratum per screen — so those carry the sample.
 *
 * THE STRATA NEVER REACH THE PAGE. They live here, in cache/, and the endpoint
 * serves only the frame. Telling the labeller which plates the machine failed on
 * would be a subtler version of the leak this whole pass exists to undo.
 *
 * Run: npx tsx scripts/spike/build-plate-sample.ts [--frames N] [--seed N]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CACHE, framesOf } from '../hud-frames';

const argv = process.argv.slice(2);
const WANT = Number(argv[argv.indexOf('--frames') + 1]) || 120;
const SEED = Number(argv[argv.indexOf('--seed') + 1]) || 20260816;

/** mulberry32 — a recorded seed makes the sample reproducible, which matters
 *  because a labelling session is expensive and may need to be resumed or
 *  audited months later. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

interface Extraction {
  id: string;
  channel?: string;
  hud: number;
  left: { sec: number; id: string | null }[];
  right: { sec: number; id: string | null }[];
}

export type Stratum = 'one-rejected' | 'both-rejected' | 'both-resolved' | 'no-hud';

export interface SampleEntry {
  videoId: string;
  sec: number;
  stratum: Stratum;
  /** what the reader said, for the scorer. NEVER served to the page. */
  readerLeft: string | null;
  readerRight: string | null;
}

const store = JSON.parse(
  readFileSync(join(CACHE, 'extracted.json'), 'utf8'),
) as Record<string, Extraction>;
const videos = JSON.parse(readFileSync(join(CACHE, '..', '..', 'data/videos.json'), 'utf8')) as {
  id: string;
  intake: string;
}[];
const channelOf = new Map(videos.map((v) => [v.id, v.intake]));

// ── pool every frame, tagged by what the reader did ──────────────────────────
const pools: Record<Stratum, SampleEntry[]> = {
  'one-rejected': [],
  'both-rejected': [],
  'both-resolved': [],
  'no-hud': [],
};

for (const [vid, v] of Object.entries(store)) {
  if (!v.hud) continue;
  const right = new Map(v.right.map((r) => [r.sec, r.id]));
  const hudSecs = new Set<number>();
  for (const l of v.left) {
    hudSecs.add(l.sec);
    const r = right.get(l.sec) ?? null;
    const misses = (l.id === null ? 1 : 0) + (r === null ? 1 : 0);
    const stratum: Stratum =
      misses === 2 ? 'both-rejected' : misses === 1 ? 'one-rejected' : 'both-resolved';
    pools[stratum].push({ videoId: vid, sec: l.sec, stratum, readerLeft: l.id, readerRight: r });
  }
  // frames on disk the HUD detector rejected outright
  for (const f of framesOf(vid)) {
    const sec = Number(f.split('/').pop()!.replace('.png', ''));
    if (hudSecs.has(sec)) continue;
    pools['no-hud'].push({ videoId: vid, sec, stratum: 'no-hud', readerLeft: null, readerRight: null });
  }
}

/** Take from a pool, round-robin across CHANNELS first and videos within each.
 *
 *  Spreading by video alone tracks the corpus, and the corpus is lopsided: 34 of
 *  48 cached videos are highLevelReplays, so a video-proportional draw gave the
 *  other four channels 4-6 frames each — too thin to say anything about the very
 *  variance that has been the open question all phase (fightingStationX read 71%
 *  where highLevelReplays read 96%).
 *
 *  So channels are drawn evenly and the SCORER weights by channel population for
 *  any global figure, exactly as it does for the resolved/rejected strata. A
 *  sample shaped for the question, with the reweighting written down. */
function spread(pool: SampleEntry[], n: number): SampleEntry[] {
  const byChannel = new Map<string, Map<string, SampleEntry[]>>();
  for (const e of shuffle(pool)) {
    const ch = channelOf.get(e.videoId) ?? '?';
    const vids = byChannel.get(ch) ?? new Map<string, SampleEntry[]>();
    vids.set(e.videoId, [...(vids.get(e.videoId) ?? []), e]);
    byChannel.set(ch, vids);
  }
  const channels = shuffle([...byChannel.values()]).map((vids) => shuffle([...vids.values()]));
  const out: SampleEntry[] = [];
  let c = 0;
  const cursor = new Map<number, number>();
  while (out.length < n && channels.some((qs) => qs.some((q) => q.length))) {
    const qs = channels[c % channels.length]!;
    if (qs.some((q) => q.length)) {
      const k = cursor.get(c % channels.length) ?? 0;
      // advance within the channel to the next video that still has frames
      for (let step = 0; step < qs.length; step++) {
        const q = qs[(k + step) % qs.length]!;
        if (q.length) {
          out.push(q.shift()!);
          cursor.set(c % channels.length, (k + step + 1) % qs.length);
          break;
        }
      }
    }
    c++;
  }
  return out;
}

// Budget: `one-rejected` carries the sample because it yields one plate of each
// stratum per screen. The rest top up the tails.
const nOneRej = Math.round(WANT * 0.76);
const nBothRej = Math.round(WANT * 0.07);
const nBothRes = Math.round(WANT * 0.07);
const nNoHud = WANT - nOneRej - nBothRej - nBothRes;

const picked = [
  ...spread(pools['one-rejected'], nOneRej),
  ...spread(pools['both-rejected'], nBothRej),
  ...spread(pools['both-resolved'], nBothRes),
  ...spread(pools['no-hud'], nNoHud),
];
const sample = shuffle(picked);

writeFileSync(join(CACHE, 'plate-sample.json'), `${JSON.stringify({ seed: SEED, sample }, null, 1)}\n`);

// ── report ──────────────────────────────────────────────────────────────────
const popResolved = Object.values(store).reduce(
  (a, v) => a + v.left.filter((x) => x.id).length + v.right.filter((x) => x.id).length,
  0,
);
const popRejected = Object.values(store).reduce(
  (a, v) => a + v.left.filter((x) => !x.id).length + v.right.filter((x) => !x.id).length,
  0,
);
const sResolved = sample.filter((e) => e.stratum !== 'no-hud').reduce(
  (a, e) => a + (e.readerLeft ? 1 : 0) + (e.readerRight ? 1 : 0),
  0,
);
const sRejected =
  sample.filter((e) => e.stratum !== 'no-hud').length * 2 - sResolved;

console.log(`plate sample — seed ${SEED}\n`);
console.log(`  population: ${popResolved + popRejected} plates · resolved ${popResolved} (${((100 * popResolved) / (popResolved + popRejected)).toFixed(1)}%) · rejected ${popRejected} (${((100 * popRejected) / (popResolved + popRejected)).toFixed(1)}%)`);
console.log(`  sample:     ${sample.length} frames`);
for (const s of ['one-rejected', 'both-rejected', 'both-resolved', 'no-hud'] as Stratum[]) {
  const n = sample.filter((e) => e.stratum === s).length;
  console.log(`    ${s.padEnd(15)} ${String(n).padStart(4)}  (pool ${pools[s].length})`);
}
console.log(
  `\n  plate judgements: ${sResolved + sRejected} from HUD frames — resolved ${sResolved}, rejected ${sRejected}`,
);
console.log(
  `  rejected plates are ${((100 * popRejected) / (popResolved + popRejected)).toFixed(1)}% of the population and ` +
    `${((100 * sRejected) / (sResolved + sRejected)).toFixed(1)}% of the sample — OVER-SAMPLED ON PURPOSE.\n` +
    '  plate-accuracy.ts weights back; never quote a raw rate from this sample.\n',
);
const byCh = new Map<string, number>();
for (const e of sample) {
  const c = channelOf.get(e.videoId) ?? '?';
  byCh.set(c, (byCh.get(c) ?? 0) + 1);
}
console.log('  per channel:');
for (const [c, n] of [...byCh].sort((a, b) => b[1] - a[1])) console.log(`    ${c.padEnd(20)} ${n}`);
console.log(
  `  distinct videos: ${new Set(sample.map((e) => e.videoId)).size}/${Object.keys(store).length}\n`,
);
if (!existsSync(join(CACHE, 'plate-sample.json'))) process.exit(1);
