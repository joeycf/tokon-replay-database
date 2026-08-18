/**
 * Drain the bench queue by reading footage. LOCAL ONLY — never in CI.
 *
 * YouTube blocks datacenter IPs, so this needs a logged-in session's cookies
 * from a residential address. `secrets/yt-cookies.txt`, gitignored, chmod 600,
 * five-path preflight. The cron never calls it.
 *
 * THE WORKLIST IS data/bench-queue.json, which is the pipeline's own statement
 * of what is still incomplete. Not the extractor's output: keying off what the
 * machine happened to run would make a video the extractor never touched vanish
 * from the work, and would put the machine structurally upstream of the thing it
 * is supposed to be draining.
 *
 * WHAT IT WRITES, AND WHAT IT REFUSES TO. Four clauses gate every resolution:
 * both unions non-empty, min confidence at or above AUTO_ACCEPT, side attribution
 * `decided`, and `titleOk` — the union must contain the fighter its own title
 * names. Anything short goes to review rather than to the site. A read that is
 * confident but SHORT of four is still written: a trustworthy 2-of-4 beats the
 * 1-of-4 the record had, `Side.characters` is 1..N by contract, and the record
 * simply stays in the bench queue for a later, denser pass.
 *
 * Run: npm run data:extract [-- --limit N] [--dry]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorker } from 'tesseract.js';

import { readCached, readVideo, type VideoRead } from './extract';
import { CACHE, grabBursts, pruneClips } from './hud-frames';
import {
  AUTO_ACCEPT,
  foldSide,
  resolveSide,
  RESAMPLE_BELOW,
  titleOk,
  WHITELIST,
  type SideResult,
} from './hud-read';
import { buildPlateRoster, loadCharacters } from './roster';
import type { BenchQueueItem, MatchVideo, VideoOverride } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const argv = process.argv.slice(2);
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || Infinity;
const DRY = argv.includes('--dry');

const read = <T>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
const queue = read<BenchQueueItem[]>('bench-queue.json').slice(0, LIMIT);
const videos = new Map(read<MatchVideo[]>('videos.json').map((v) => [v.id, v]));
const overrides = read<Record<string, VideoOverride>>('overrides.json');
const roster = buildPlateRoster(await loadCharacters());

/**
 * Per-video reads are PERSISTED, not discarded.
 *
 * This loop already computes a full `VideoRead` per video — every frame's plate,
 * its edit distance and its ensemble votes — and used to throw all of it away the
 * moment the fold had run. That cost more than it looked like:
 *
 *   · A side that read NOTHING left no trace, so "four sides read zero across
 *     59-71 HUD frames" could be observed once and then never reproduced. A record
 *     with `geom` set and empty reads is a REJECTED CROP; one with `hud: 0` is a
 *     video carrying no nameplate at all. Undistinguishable without the store,
 *     obvious with it.
 *   · The reads are also LABELS. Each resolved frame names the fighter on point at
 *     that second, which is the free training signal the portrait tier's templates
 *     and its team-minus-point candidate sets are built from. Discarding them meant
 *     re-OCRing footage already on disk to recover something already known.
 *
 * Same store `scripts/spike/read-cached.ts` owns, same incremental write, so the
 * two paths accumulate into one file rather than disagreeing. It lives in the
 * gitignored frame cache and is written even under `--dry`: it records work that
 * was genuinely performed, and `--dry`'s promise is about `data/`, not about
 * throwing away evidence.
 */
const STORE = join(CACHE, 'extracted.json');
const reads: Record<string, VideoRead> = existsSync(STORE)
  ? (JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, VideoRead>)
  : {};
const persist = (id: string, r: VideoRead): void => {
  reads[id] = r;
  writeFileSync(STORE, JSON.stringify(reads, null, 1));
};

const worker = await createWorker('eng', undefined, { logger: () => {} });
await worker.setParameters({
  tessedit_char_whitelist: WHITELIST,
  tessedit_pageseg_mode: '7' as never,
});

console.log(`bench queue: ${queue.length} record(s)${DRY ? '  [dry run]' : ''}\n`);

let resolved = 0;
let deferred = 0;
let tail = 0;

for (const [i, item] of queue.entries()) {
  const v = videos.get(item.id);
  if (!v) continue;

  let r = await readVideo(worker, item.id, v.durationSec, roster);
  let left = foldSide(r.left);
  let right = foldSide(r.right);
  let resampled = false;

  // A side still DISCOVERING new fighters is worth more frames; a side whose
  // reader is simply beaten is not. Saturation separates the two — it is low
  // exactly when singletons keep arriving — and the HUD count guards against
  // paying for a second pass on a video that had almost no nameplate to read.
  const starved = Math.min(left.saturation, right.saturation) < RESAMPLE_BELOW;
  if (starved && r.hud >= 12) {
    await grabBursts(item.id, v.durationSec, 24);
    pruneClips(item.id);
    r = await readCached(worker, item.id, roster);
    left = foldSide(r.left);
    right = foldSide(r.right);
    resampled = true;
  }
  // AFTER any re-sample, so the store holds the densest read of this video rather
  // than a first pass that a second pass has already superseded.
  persist(item.id, r);

  const known = v.sides.map((s) => s.provenance.fromTitle[0] ?? '') as [string, string];
  const side = resolveSide(r.left, r.right, known);
  // sides[0] is the record's first-named player, so the screen unions are
  // swapped into record order — never the other way round.
  const forFirst = side.leftIsFirst ? left : right;
  const forSecond = side.leftIsFirst ? right : left;

  const confidence = Math.min(left.confidence, right.confidence);
  const controls =
    titleOk(forFirst.characters, [known[0]!]) && titleOk(forSecond.characters, [known[1]!]);
  const ok =
    forFirst.characters.length > 0 &&
    forSecond.characters.length > 0 &&
    confidence >= AUTO_ACCEPT &&
    side.decided &&
    controls;

  const show = (s: SideResult) =>
    `${s.characters.join('+') || '—'} ${s.confidence.toFixed(2)}${s.complete ? '' : `/${s.characters.length}`}`;
  console.log(
    `  [${i + 1}/${queue.length}] ${item.id}  ${show(forFirst)}  vs  ${show(forSecond)}  ` +
      `side ${side.decided ? (side.leftIsFirst ? 'title-order' : 'REVERSED') : 'UNDECIDED'}` +
      `${controls ? '' : ' titleOk:FAIL'}${resampled ? ' (re-sampled)' : ''} → ${ok ? 'RESOLVE' : 'review'}`,
  );

  if (!ok) {
    deferred++;
    continue;
  }
  resolved++;
  if (!forFirst.complete || !forSecond.complete) tail++;

  // Footage order wins for a footage-tier read, with anything the text tiers
  // knew but the footage never showed appended rather than dropped.
  const merge = (fold: SideResult, prior: string[]) => [
    ...fold.characters,
    ...prior.filter((c) => !fold.characters.includes(c)),
  ];

  if (!DRY) {
    overrides[item.id] = {
      ...overrides[item.id],
      '//': `bench-completion: read from footage [data:extract ${new Date().toISOString().slice(0, 10)}]`,
      sides: v.sides.map((s, k) => {
        const fold = k === 0 ? forFirst : forSecond;
        const characters = merge(fold, s.characters);
        return {
          ...s,
          characters,
          provenance: {
            ...s.provenance,
            tier: 'footage' as const,
            tiers: [...s.provenance.tiers, 'footage' as const],
            fromFootage: fold.characters,
            confidence: fold.confidence,
            complete: characters.length >= 4,
          },
        };
      }) as VideoOverride['sides'],
      resolvedBy: 'extractor',
      confidence,
      sideVotes: side.votes,
    };
    writeFileSync(join(DATA, 'overrides.json'), `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
  }
}

await worker.terminate();

console.log(
  `\n  resolved ${resolved} · deferred to review ${deferred}` +
    `${DRY ? '  (nothing written)' : ''}`,
);
// DECISION #4'S TRIGGER, COUNTED RATHER THAN GUESSED. A side read confidently
// and still short of four is a fighter who never took point — the case a
// portrait tier would exist to cover. Build it when this exceeds ~10 a week.
console.log(
  `  never-enters tail: ${tail} record(s) resolved but short of four —\n` +
    `  the portrait tier's trigger is ~10 sides/week sustained.\n`,
);
if (!DRY && resolved) console.log('  run `npm run data:parse` to fold these into data/\n');
export {};
