/**
 * FRAME RECON — step one of the extraction track, and the gate on all of it.
 *
 * This script downloads frames and does nothing else. It draws no boxes, reads
 * no text, and produces no numbers about accuracy. Its only job is to put real
 * pixels on disk so a human can answer four questions:
 *
 *   1. WHERE DO EIGHT IDENTITIES LIVE? Point-character nameplate as text? A
 *      portrait-only bench strip? A team-select or VS card showing all eight at
 *      once? This decides whether the reader is OCR, a portrait matcher, or
 *      both on different slots — and nothing can be built before it is answered.
 *   2. WHEN is the bench legible, and where in the clip? A bench visible only on
 *      a VS card is event-locked, not sampled, which is a different extractor.
 *   3. Does the bench GREY OR RECOLOUR on KO? That is the measured hazard for
 *      hue-gated portrait matching; hue cannot be trusted before it is checked.
 *   4. Is FRAMING STABLE across channels? A sibling needed per-video framing
 *      normalisation because a broadcast overlay moved. These are in-game
 *      replay captures, so it may not be needed — but that is a measurement.
 *
 * WHY IT SAMPLES THE WAY IT DOES. Uniform sampling cannot find a VS screen: a
 * versus card is event-locked to a game boundary and lasts seconds, so a dozen
 * samples spread over a ~12-minute set hit it around a tenth of the time. So
 * `reconPlan` takes a dense low-fps window over the match START, another over a
 * MID-SET boundary, and only then the siblings' in-match sweep.
 *
 * WHY MULTIPLE CHANNELS. These are four different uploaders re-encoding the
 * same in-game replay system. A reader tuned on one that silently fails on
 * another only shows up much later, at the accuracy table. A sibling met the
 * same problem across three years of a re-skinned event overlay and its recon
 * header makes the same point.
 *
 * Run: npx tsx scripts/spike/recon.ts [--videos N]
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHE, framesOf, pruneClips, reconPlan } from '../hud-frames';
import type { BenchQueueItem } from '../../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const PER_CHANNEL = Number(argv[argv.indexOf('--videos') + 1]) || 0;

const bench = JSON.parse(
  await readFile(join(ROOT, 'data/bench-queue.json'), 'utf8'),
) as BenchQueueItem[];

/**
 * One video per bench-queue channel, then a second from the two largest.
 *
 * Picked by DURATION rather than at random: a longer set contains more game
 * boundaries, and a game boundary is where a VS card lives. Short clips are the
 * worst possible recon sample for question 1.
 */
const byChannel = new Map<string, BenchQueueItem[]>();
for (const b of bench) byChannel.set(b.channel, [...(byChannel.get(b.channel) ?? []), b]);

const picks: BenchQueueItem[] = [];
for (const [, list] of byChannel) {
  const sorted = [...list].sort((a, b) => b.durationSec - a.durationSec);
  const n = PER_CHANNEL || (list.length >= 30 ? 2 : 1);
  picks.push(...sorted.slice(0, n));
}

console.log(`Recon: ${picks.length} VOD(s) across ${byChannel.size} channel(s)\n`);
for (const p of picks) {
  console.log(
    `  ${p.id}  ${p.channel.padEnd(18)} ${Math.round(p.durationSec / 60)}min  ${p.title.slice(0, 62)}`,
  );
}
console.log(
  `\nPlan per video: a dense window over the match start, one over a mid-set\n` +
    `boundary, then an in-match sweep. ~14 requests each, paced 3-6s.\n`,
);

let total = 0;
for (const [i, p] of picks.entries()) {
  console.log(`[${i + 1}/${picks.length}] ${p.id} (${p.channel})`);
  await reconPlan(p.id, p.durationSec);
  pruneClips(p.id);
  const frames = framesOf(p.id);
  total += frames.length;
  console.log(`   ${frames.length} frames cached\n`);
}

console.log(`✔ ${total} frames under ${CACHE}/frames/<id>/`);
console.log('\nNow LOOK at them. Answer the four questions in writing before any');
console.log('reader code exists — a crop ported without this read 0/60 on a sibling');
console.log('where the derived box read 48/60, three separate times.');
