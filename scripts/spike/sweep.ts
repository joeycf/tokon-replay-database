/**
 * CROP SWEEP — per-channel geometry, measured, before any reader exists.
 *
 * Every prior extraction on this platform ran against ONE capture pipeline. This
 * corpus spans FIVE uploader channels with five capture paths, so "the HUD sits
 * at a fixed fraction" holds PER SOURCE until measured otherwise. If the channels
 * disagree, the crop config keys by ChannelKey; if they agree, that is a
 * measurement to state with numbers, not an assumption to inherit.
 *
 * Everything here is OCR-INDEPENDENT on purpose. Whether tesseract can read this
 * face is the next question, and geometry derived from a reader that might not
 * work would be geometry built on sand.
 *
 * The geometry primitives it measures WITH now live in scripts/hud-read.ts, so
 * the production reader and this sweep cannot drift apart on where a plate is.
 *
 * WHAT IT MEASURES, per video:
 *   · letterboxing — a padded frame shifts every fraction
 *   · the nameplate band and both ink runs, via a local-range filter
 *   · the right plate is RIGHT-ALIGNED, so it is reported as an xEnd anchor plus
 *     a width — a left-anchored box clips the first glyph off a long name
 *   · UI language — Latin vs katakana glyph run, per channel
 *   · round-1 start — see below
 *   · distinct nameplate images per side, by perceptual hash
 *
 * TWO CONCLUSIONS THIS IS ALLOWED TO DRAW, AND TWO IT IS NOT:
 *
 * 1. ROUND-1 START. If round 1 begins at t≈0 the uploader TRIMMED the pre-match
 *    screens. Then "no text list of all eight" is a fact about THIS CHANNEL'S
 *    EDITING, and must be reported as "not present in these uploads" — never as
 *    "the game has no such screen". An absence caused by trimming is not
 *    evidence about the UI.
 *
 * 2. DISTINCT FIGHTERS PER SIDE. Tag-cycling is the basis for reading the
 *    nameplate as the primary source, and its blind spot is exact: a fighter who
 *    never enters never appears there. Counting DISTINCT NAMEPLATE IMAGES per
 *    side (perceptual hash, no reading required) bounds how often that case
 *    occurs. BUT the count is only valid AT THE SAMPLING DENSITY THAT PRODUCED
 *    IT — see `distinctSpread` below, and scripts/spike/anchor.ts, which reports
 *    both densities side by side.
 *
 * Run: npx tsx scripts/spike/sweep.ts [--per-channel N] [--measure-only]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHE, framesOf, grabWindow, pruneClips, samplePlan } from '../hud-frames';
import { CHANNELS } from '../channels';
import { dhash, distinct, grey, measure, platesOf, type FrameMeasure } from '../hud-read';
import type { ChannelKey, MatchVideo } from '../../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const PER_CHANNEL = Number(argv[argv.indexOf('--per-channel') + 1]) || 2;
const MEASURE_ONLY = argv.includes('--measure-only');

/** Available source formats — answers "1080p or 720p uploads" without downloading. */
function sourceRes(id: string): string {
  const r = spawnSync(
    'yt-dlp',
    [
      '--cookies',
      join(ROOT, 'secrets/yt-cookies.txt'),
      '--js-runtimes',
      'node',
      '-F',
      `https://www.youtube.com/watch?v=${id}`,
    ],
    {
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  const heights = [...(r.stdout ?? '').matchAll(/\b(\d{3,4})x(\d{3,4})\b/g)].map((m) =>
    Number(m[2]),
  );
  return heights.length ? `${Math.max(...heights)}p` : '?';
}

// ── main ────────────────────────────────────────────────────────────────────
const videos = JSON.parse(readFileSync(join(ROOT, 'data/videos.json'), 'utf8')) as MatchVideo[];
const byChannel = new Map<ChannelKey, MatchVideo[]>();
for (const v of videos) byChannel.set(v.intake, [...(byChannel.get(v.intake) ?? []), v]);

const picks: MatchVideo[] = [];
for (const ch of CHANNELS) {
  const list = (byChannel.get(ch.id) ?? []).sort((a, b) => b.durationSec - a.durationSec);
  picks.push(...list.slice(0, PER_CHANNEL));
}

console.log(`Crop sweep — ${picks.length} VODs across ${CHANNELS.length} channels\n`);
const OUT = join(CACHE, 'sweep.json');
mkdirSync(CACHE, { recursive: true });
const results: Record<string, unknown>[] = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>[])
  : [];
// Only a measurement that actually SAW a HUD counts as done. A --measure-only
// pass on an uncached video records zeros, and keying resume on the id alone
// would then skip its download forever.
const done = new Set(results.filter((r) => (r.hudFrames as number) > 0).map((r) => r.id as string));

for (const [i, v] of picks.entries()) {
  if (done.has(v.id)) {
    console.log(`[${i + 1}/${picks.length}] ${v.id} (${v.intake}) — cached`);
    continue;
  }
  console.log(
    `[${i + 1}/${picks.length}] ${v.id} (${v.intake}) ${Math.round(v.durationSec / 60)}min`,
  );

  if (!MEASURE_ONLY) {
    // dense start window (round-1 detection + any pre-match screen), then the sweep
    await grabWindow(v.id, 0, 60, 0.5);
    for (const s of samplePlan(v.durationSec, 8)) await grabWindow(v.id, s, 1, 1);
    pruneClips(v.id);
  }

  const frames = framesOf(v.id);
  const measures: { sec: number; m: FrameMeasure }[] = [];
  for (const f of frames) {
    const sec = Number(f.split('/').pop()!.replace('.png', ''));
    const { d, W, H } = await grey(f);
    measures.push({ sec, m: measure(d, W, H) });
  }
  const hudFrames = measures.filter((x) => x.m.hud);

  // round 1 start: earliest second in the dense window carrying a HUD
  const early = hudFrames.filter((x) => x.sec <= 60).map((x) => x.sec);
  const roundOne = early.length ? Math.min(...early) : null;

  const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

  const geom = {
    bandY0: med(hudFrames.map((x) => x.m.band!.y0)),
    bandY1: med(hudFrames.map((x) => x.m.band!.y1)),
    leftX0: med(hudFrames.map((x) => x.m.left!.x0)),
    rightX1: med(hudFrames.map((x) => x.m.right!.x1)),
  };
  const boxes = platesOf(geom, 'symmetric');
  const hl: string[] = [];
  const hr: string[] = [];
  const secs: number[] = [];
  for (const { sec } of hudFrames) {
    const f = frames.find((p) => p.endsWith(`${String(sec).padStart(6, '0')}.png`))!;
    hl.push(await dhash(f, boxes.left));
    hr.push(await dhash(f, boxes.right));
    secs.push(sec);
  }

  // A distinct-plate count is only meaningful WITH ITS SAMPLER. These frames come
  // overwhelmingly from dense burst windows (76-91% of every video's HUD frames
  // sit within 3s of another), so the burst count is an upper bound on what a
  // spread sampler would see. `spread` keeps one frame per burst — the same
  // frames a 12-singleton plan would have landed on — so both are on the record.
  const spreadIdx: number[] = [];
  for (let k = 0; k < secs.length; k++) {
    if (k === 0 || secs[k]! - secs[spreadIdx[spreadIdx.length - 1]!]! > 3) spreadIdx.push(k);
  }

  const rec = {
    id: v.id,
    channel: v.intake,
    durationSec: v.durationSec,
    sourceRes: MEASURE_ONLY ? '?' : sourceRes(v.id),
    frames: frames.length,
    hudFrames: hudFrames.length,
    roundOneSec: roundOne,
    letterboxTop: med(measures.map((x) => x.m.letterbox.top)),
    ...geom,
    leftX1: med(hudFrames.map((x) => x.m.left!.x1)),
    rightX0: med(hudFrames.map((x) => x.m.right!.x0)),
    // The seconds that actually carry a HUD. Scoring a reader over frames
    // without a nameplate measures the sampler, not the reader — a K.O. card or
    // a round banner has nothing to read and counting it as a miss hides the
    // reader's real behaviour.
    hudSecs: secs,
    distinctLeft: distinct(hl),
    distinctRight: distinct(hr),
    spreadFrames: spreadIdx.length,
    distinctSpreadLeft: distinct(spreadIdx.map((k) => hl[k]!)),
    distinctSpreadRight: distinct(spreadIdx.map((k) => hr[k]!)),
  };
  results.push(rec);
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(
    `   ${rec.hudFrames}/${rec.frames} HUD · band y ${rec.bandY0.toFixed(3)}-${rec.bandY1.toFixed(3)} · ` +
      `L x ${rec.leftX0.toFixed(3)}-${rec.leftX1.toFixed(3)} · R x ${rec.rightX0.toFixed(3)}-${rec.rightX1.toFixed(3)} · ` +
      `round1 ${roundOne ?? '—'}s · distinct ${rec.distinctLeft}/${rec.distinctRight} ` +
      `(spread ${rec.distinctSpreadLeft}/${rec.distinctSpreadRight} of ${rec.spreadFrames})`,
  );
}

console.log(`\n✔ ${results.length} videos measured → ${OUT}`);
