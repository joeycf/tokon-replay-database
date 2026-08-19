/**
 * Does a cached frame actually come from the second it is named after?
 *
 * A reviewer reported that the cluster in a cached frame shows a different team
 * from the one the source video shows at that timestamp. That is either a reading
 * error or a CACHE ALIGNMENT error, and the difference matters enormously: every
 * one of the 227 hand-read sides was read off these frames.
 *
 * `grabWindow` names frames by `start + i/fps`, but yt-dlp's --download-sections
 * seeks, and a seek lands on a keyframe rather than on the requested second. If
 * the returned clip does not begin where it was asked to, every frame in it is
 * mislabelled by the difference.
 *
 * This re-fetches one window into a SEPARATE directory and compares the bytes
 * against what is cached. Same request, same format, same cutter — so a difference
 * is alignment, not encoding.
 *
 * Run: npx tsx scripts/spike/frame-check.ts <videoId> <startSec>
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp, { type OverlayOptions } from 'sharp';

import { CACHE, grabWindow, stamp } from '../hud-frames';

const [id, startArg] = process.argv.slice(2);
if (!id || !startArg) {
  console.error('usage: frame-check.ts <videoId> <startSec>');
  process.exit(1);
}
const start = Number(startArg);
const VERIFY = join(CACHE, 'frames-verify');

console.log(`re-fetching ${id} @${start}s into frames-verify/ …\n`);
const got = await grabWindow(id, start, 6, 1, { maxHeight: 720, framesDir: VERIFY });
console.log(`  wrote ${got.length} frame(s)\n`);

/** Mean absolute difference of two frames, 0 = identical. */
async function diff(a: string, b: string): Promise<number> {
  const [x, y] = await Promise.all(
    [a, b].map((f) => sharp(f).greyscale().resize(160, 90, { fit: 'fill' }).raw().toBuffer()),
  );
  let s = 0;
  for (let i = 0; i < x!.length; i++) s += Math.abs(x![i]! - y![i]!);
  return s / x!.length;
}

console.log('  sec    cached vs re-fetched (mean abs diff, 0 = identical)');
for (const sec of got) {
  const cached = join(CACHE, 'frames', id, `${stamp(sec)}.png`);
  const fresh = join(VERIFY, id, `${stamp(sec)}.png`);
  if (!existsSync(cached) || !existsSync(fresh)) continue;
  const d = await diff(cached, fresh);
  const same = readFileSync(cached).equals(readFileSync(fresh));
  console.log(
    `  ${String(sec).padStart(5)}  ${d.toFixed(2).padStart(7)}  ${same ? 'byte-identical' : d < 3 ? 'same image' : 'DIFFERENT'}`,
  );
}
console.log(
  '\n  A large difference at every second means the window did not start where it\n' +
    '  was asked to, and the cache is offset from its own labels.\n',
);
export {};

// Side-by-side corner crops: cached on top, re-fetched beneath, same second.
// A numeric difference says the images are not identical; only the pixels say
// whether the difference is a different TEAM or just a different instant of the
// same fight.
if (process.argv.includes('--show')) {
  const sec = got[got.length - 1]!;
  const parts: OverlayOptions[] = [];
  let y = 0;
  for (const [label, dir] of [
    ['cached', join(CACHE, 'frames')],
    ['refetched', VERIFY],
  ] as [string, string][]) {
    const f = join(dir, id, `${stamp(sec)}.png`);
    if (!existsSync(f)) continue;
    const buf = await sharp(f)
      .extract({ left: 0, top: 0, width: 205, height: 173 })
      .resize({ width: 205 * 4, kernel: 'nearest' })
      .png()
      .toBuffer();
    parts.push({ input: buf, left: 0, top: y });
    y += 173 * 4 + 4;
    console.log(`  ${label}: ${f}`);
  }
  await sharp({ create: { width: 205 * 4, height: y, channels: 3, background: '#101014' } })
    .composite(parts)
    .png()
    .toFile(join(CACHE, 'portrait-recon', 'frame-check.png'));
  console.log(`\n✔ ${join(CACHE, 'portrait-recon', 'frame-check.png')} — cached above, re-fetched below\n`);
}

// The cluster at every sampled window, in time order. A set is several games and
// Tokon lets a team change between them, so "the description disagrees with the
// footage" and "the footage disagrees with itself over time" are the same
// observation seen from two ends.
if (process.argv.includes('--timeline')) {
  const dir = join(CACHE, 'frames', id);
  const secs = (await import('node:fs')).readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => Number(f.replace('.png', '')))
    .sort((a, b) => a - b)
    .filter((_, i) => i % 6 === 0);
  const parts: OverlayOptions[] = [];
  const CW = 150;
  const CH = 130;
  for (const [i, sec] of secs.entries()) {
    const f = join(dir, `${stamp(sec)}.png`);
    const buf = await sharp(f)
      .extract({ left: 0, top: 0, width: 175, height: 150 })
      .resize({ width: CW, height: CH, fit: 'fill' })
      .png()
      .toBuffer();
    parts.push({ input: buf, left: (i % 6) * (CW + 2), top: Math.floor(i / 6) * (CH + 2) });
  }
  const rows = Math.ceil(secs.length / 6);
  await sharp({
    create: { width: 6 * (CW + 2), height: rows * (CH + 2), channels: 3, background: '#101014' },
  })
    .composite(parts)
    .png()
    .toFile(join(CACHE, 'portrait-recon', 'timeline.png'));
  console.log(`  seconds: ${secs.join(' ')}`);
  console.log(`✔ timeline.png — ${secs.length} windows, left-to-right then down\n`);
}
