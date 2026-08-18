/**
 * Dev-only: persist one diamond's label into data/portrait-labels.json.
 *
 * Body: { i, cell, char }  — worklist index, cell name, roster id (or null to clear).
 *
 * MEASUREMENTS ARE STORED, NOT INTERPRETATIONS. The cell's luminance and saturation
 * are both recorded, along with their rank among the frame's three cells — but no
 * 'lit'/'dim' verdict, because the first such verdict was wrong. Luminance looked
 * like the render-state tag and turned out to track the character's own palette as
 * much as its state; saturation is the better candidate and has not yet been
 * validated against labels either. Once these labels exist the tag can be FITTED
 * against them, which is not possible if the file already contains a guess.
 *
 * The id is validated against the roster and the cell against the lattice, because
 * both arrive from a request body and both end up as keys in a committed file.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

import { ASSIST_CELLS, cellLuma, cellSat } from '../../../scripts/portrait-read';

interface Body {
  i?: unknown;
  cell?: unknown;
  char?: unknown;
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const body = (await readBody(event)) as Body;
  const work = buildWorkList();
  const i = Number(body.i);
  if (!Number.isInteger(i) || i < 0 || i >= work.length) {
    throw createError({ statusCode: 400, statusMessage: `worklist index out of range: ${String(body.i)}` });
  }
  const w = work[i]!;
  const cellName = String(body.cell ?? '');
  const cell = ASSIST_CELLS.find((c) => c.name === cellName);
  if (!cell) throw createError({ statusCode: 400, statusMessage: `unknown cell "${cellName}"` });

  const path = join(process.cwd(), 'data/portrait-labels.json');
  const labels = readJson<Record<string, unknown>>('data/portrait-labels.json', {});
  const key = labelKey(w, cellName);

  if (body.char === null || body.char === '' || body.char === undefined) {
    // rebuild without the key rather than `delete` — clearing a label is a normal
    // correction, and it must not leave the object in a shape the writer treats
    // differently from one that never held it
    for (const k of Object.keys(labels)) if (k === key) labels[k] = undefined as never;
  } else {
    const char = String(body.char);
    const roster = readJson<{ id: string }[]>('data/characters.json', []);
    if (!roster.some((c) => c.id === char)) {
      throw createError({ statusCode: 400, statusMessage: `unknown fighter id "${char}"` });
    }
    const frame = join(
      process.cwd(),
      'cache/tokon/frames',
      w.video,
      `${String(w.sec).padStart(6, '0')}.png`,
    );
    if (!existsSync(frame)) throw createError({ statusCode: 404, statusMessage: 'frame gone' });
    const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels } = info;
    const grey = await sharp(frame).greyscale().raw().toBuffer();
    const k = ASSIST_CELLS.indexOf(cell);
    const lums = ASSIST_CELLS.map((c) => cellLuma(grey, W, H, w.side, c));
    const sats = ASSIST_CELLS.map((c) => cellSat(data, W, H, channels, w.side, c));
    const rank = (xs: number[], i: number) =>
      1 + xs.filter((v) => v > xs[i]!).length; // 1 = highest of the three
    labels[key] = {
      char,
      luma: Math.round(lums[k]!),
      sat: Number(sats[k]!.toFixed(3)),
      lumaRank: rank(lums, k),
      satRank: rank(sats, k),
      at: new Date().toISOString().slice(0, 10),
    };
  }
  const kept = Object.fromEntries(Object.entries(labels).filter(([, v]) => v !== undefined));
  writeFileSync(path, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
  return { ok: true, crops: Object.keys(kept).length };
});
