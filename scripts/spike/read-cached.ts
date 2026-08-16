/**
 * Read any video whose frames are already cached, into cache/tokon/extracted.json.
 *
 * Exists because the ground-truth corpus is 34 highLevelReplays + 7 proReplays —
 * those are the only channels whose descriptions state full teams — so a sample
 * drawn from it is blind to the other three uploaders. The crop sweep cached ten
 * videos spanning all five, and per-channel variance has been a live question all
 * phase (fightingStationX read 71% where highLevelReplays read 96%). Reading them
 * with the CURRENT geometry and ensemble costs no downloads and turns a
 * two-channel measurement into a five-channel one.
 *
 * Downloads nothing. Skips anything already in the store unless --force.
 *
 * Run: npx tsx scripts/spike/read-cached.ts [--force]
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createWorker } from 'tesseract.js';

import { readCached } from '../extract';
import { CACHE } from '../hud-frames';
import { WHITELIST } from '../hud-read';
import { buildPlateRoster, loadCharacters } from '../roster';

const FORCE = process.argv.includes('--force');
const STORE = join(CACHE, 'extracted.json');
const FRAMES = join(CACHE, 'frames');

const store = existsSync(STORE)
  ? (JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, { hud: number }>)
  : {};

const cached = existsSync(FRAMES)
  ? readdirSync(FRAMES).filter((d) => existsSync(join(FRAMES, d)))
  : [];
const todo = cached.filter((id) => FORCE || !store[id]?.hud);

const videos = JSON.parse(readFileSync(join(CACHE, '..', '..', 'data/videos.json'), 'utf8')) as {
  id: string;
  intake: string;
}[];
const channelOf = new Map(videos.map((v) => [v.id, v.intake]));

console.log(`${cached.length} videos have cached frames · ${todo.length} to read\n`);
if (!todo.length) process.exit(0);

const roster = buildPlateRoster(await loadCharacters());
const worker = await createWorker('eng', undefined, { logger: () => {} });
await worker.setParameters({
  tessedit_char_whitelist: WHITELIST,
  tessedit_pageseg_mode: '7' as never,
});

for (const [i, id] of todo.entries()) {
  const r = await readCached(worker, id, roster);
  (store as Record<string, unknown>)[id] = r;
  writeFileSync(STORE, JSON.stringify(store, null, 1));
  console.log(
    `  [${i + 1}/${todo.length}] ${id} (${channelOf.get(id) ?? '?'}) — ${r.hud}/${r.frames} HUD frames`,
  );
}
await worker.terminate();
console.log(`\n✔ ${Object.keys(store).length} videos in the store\n`);
