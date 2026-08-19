/**
 * Dev-only: the annotated corner crop a person labels bench diamonds from.
 *
 * Serves the top corner of one cached frame, upscaled 4x with nearest-neighbour so
 * pixel edges stay honest, with the three bench diamonds outlined and lettered
 * A/B/C. The point fighter's bust is outlined separately and labelled, because
 * knowing who is on point is what makes the three candidates a closed set.
 *
 * The frame is addressed by an opaque WORKLIST INDEX. The video id never reaches
 * the DOM or the network tab — the same protection source-review.get.ts documents,
 * kept here even though this task is an assignment among named candidates rather
 * than a blind read: there is no reason to hand out a lookup key that lets a
 * labeller go and read the uploader's own description instead of the picture.
 *
 * Frames live outside public/ and stay there — 17 GB of downloaded footage,
 * gitignored, and nothing about it belongs in a built site.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

import {
  ASSIST_CELLS,
  BUST_CELL,
  cellCentre,
  CELL_HALF,
  cellLuma,
} from '../../../scripts/portrait-read';

const Z = 4;
const WIN_W = 0.16;
const WIN_H = 0.24;

/** The player-handle strip, measured from a labelled frame: the handle sits under
 *  the health bar at roughly x 0.152-0.207, y 0.104-0.128 on the LEFT, mirrored on
 *  the right. Bounds are generous around that.
 *
 *  It is served SEPARATELY rather than by widening the cluster crop, because the
 *  cluster is the thing being read and halving its scale to fit a name in would
 *  trade the task for the label. */
const STRIP = { x0: 0.1, x1: 0.32, y0: 0.07, y1: 0.22 };

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  // `pool=bench` serves the DRAIN worklist, which carries two frames per side;
  // `frame` selects between them. Default stays the template worklist.
  const q = getQuery(event);
  const bench = String(q.pool ?? '') === 'bench';
  const list = bench ? buildBenchList() : buildWorkList();
  const byIdentity = bench && String(q.video ?? '') !== '';
  const i = Number(q.i);
  // The index is only meaningful when the caller did NOT send an identity. It is
  // validated here rather than unconditionally, because the bench page stopped
  // sending one the moment addressing moved to {video, side} — and validating a
  // parameter nobody sends turns every crop into a 400.
  if (!byIdentity && (!Number.isInteger(i) || i < 0 || i >= list.length)) {
    throw createError({ statusCode: 400, statusMessage: 'bad worklist index' });
  }
  const fi = Number(q.frame ?? 0) === 1 ? 1 : 0;
  const item = list[byIdentity ? 0 : i]!;
  const w = bench
    ? (() => {
        // resolve by identity when the caller supplies it; the index is only a
        // fallback, because the bench list grows whenever a fetch persists a read
        const b = (String(q.video ?? '')
          ? (list as import('../../utils/portraitWork').BenchItem[]).find(
              (x) => x.video === String(q.video) && x.side === String(q.side),
            )
          : (item as import('../../utils/portraitWork').BenchItem)) ?? null;
        if (!b) throw createError({ statusCode: 404, statusMessage: 'side no longer in the queue' });
        return { video: b.video, sec: b.secs[fi], side: b.side, point: b.points[fi] };
      })()
    : (item as import('../../utils/portraitWork').WorkItem);
  const file = join(
    process.cwd(),
    'cache/tokon/frames',
    w.video,
    `${String(w.sec).padStart(6, '0')}.png`,
  );
  if (!existsSync(file)) throw createError({ statusCode: 404, statusMessage: 'no such frame' });

  const meta = await sharp(file).metadata();
  const W = meta.width!;
  const H = meta.height!;

  // handle strip: no annotation, just the name, upscaled enough to read
  if (String(q.strip ?? '') === '1') {
    const sx0 = w.side === 'L' ? STRIP.x0 : 1 - STRIP.x1;
    const sw = Math.round(W * (STRIP.x1 - STRIP.x0));
    const strip = await sharp(file)
      .extract({
        left: Math.round(W * sx0),
        top: Math.round(H * STRIP.y0),
        width: sw,
        height: Math.round(H * (STRIP.y1 - STRIP.y0)),
      })
      .resize({ width: sw * 3, kernel: 'nearest' })
      .png()
      .toBuffer();
    setHeader(event, 'content-type', 'image/png');
    setHeader(event, 'cache-control', 'private, max-age=3600');
    return strip;
  }

  const cw = Math.round(W * WIN_W);
  const chh = Math.round(H * WIN_H);
  const left = w.side === 'L' ? 0 : W - cw;

  const grey = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const base = await sharp(file)
    .extract({ left, top: 0, width: cw, height: chh })
    .resize({ width: cw * Z, kernel: 'nearest' })
    .png()
    .toBuffer();

  // Diamonds are drawn where the reader looks, so a mislabelled crop and a
  // misplaced box are distinguishable by eye rather than by argument.
  const marks: string[] = [];
  const letters = ['A', 'B', 'C'];
  ASSIST_CELLS.forEach((c, k) => {
    const { cx, cy } = cellCentre(c, w.side, W, H);
    const x = (cx - left) * Z;
    const y = cy * Z;
    const d = CELL_HALF * W * Z;
    const lit = cellLuma(grey.data, W, H, w.side, c);
    marks.push(
      `<polygon points="${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}" ` +
        `fill="none" stroke="#00E5FF" stroke-width="3"/>`,
      `<circle cx="${x}" cy="${y - d - 14}" r="13" fill="#00E5FF"/>`,
      `<text x="${x}" y="${y - d - 9}" font-family="monospace" font-size="18" font-weight="bold" ` +
        `text-anchor="middle" fill="#04121A">${letters[k]}</text>`,
      `<text x="${x + d + 6}" y="${y + 5}" font-family="monospace" font-size="13" fill="#00E5FF">` +
        `${Math.round(lit)}</text>`,
    );
  });
  {
    const { cx, cy } = cellCentre(BUST_CELL, w.side, W, H);
    const x = (cx - left) * Z;
    const y = cy * Z;
    const d = CELL_HALF * W * Z;
    marks.push(
      `<polygon points="${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}" ` +
        `fill="none" stroke="#FF9D2E" stroke-width="2" stroke-dasharray="6 4"/>`,
      `<text x="${x + d + 8}" y="${y + 4}" font-family="monospace" font-size="15" fill="#FF9D2E">` +
        `point: ${w.point}</text>`,
    );
  }
  const svg = Buffer.from(
    `<svg width="${cw * Z}" height="${chh * Z}" xmlns="http://www.w3.org/2000/svg">${marks.join('')}</svg>`,
  );

  const out = await sharp(base).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
  setHeader(event, 'content-type', 'image/png');
  setHeader(event, 'cache-control', 'private, max-age=3600');
  return out;
});
