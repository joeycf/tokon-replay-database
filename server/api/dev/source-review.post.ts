/**
 * Dev-only: persist ONE plate reading from /dev/source-review into
 * data/plate-labels.json — the only file this endpoint may touch.
 *
 * The body carries a SAMPLE INDEX, not a video id. The page never learns which
 * video it is looking at (see source-review.get.ts for why), so the index is
 * resolved to a `<videoId>/<sec>` key here, server-side, against the same sample
 * file the frame endpoint reads.
 *
 * Verdict shape:  { i, left, right }
 * where `left`/`right` are roster ids, or null for "no readable plate".
 *
 * NULL IS AN ANSWER, NOT AN ABSENCE. A frame with no legible nameplate is the
 * measurement for a large part of this pass — 16% of plates the reader rejected,
 * plus the no-HUD frames included as a control on the HUD gate — so it has to be
 * storable and distinguishable from "not yet labelled".
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Body {
  i?: unknown;
  left?: unknown;
  right?: unknown;
}
interface SampleEntry {
  videoId: string;
  sec: number;
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const root = process.cwd();
  const body = (await readBody(event)) as Body;

  const samplePath = join(root, 'cache/tokon/plate-sample.json');
  if (!existsSync(samplePath)) throw createError({ statusCode: 503, statusMessage: 'no sample' });
  const { sample } = JSON.parse(readFileSync(samplePath, 'utf8')) as { sample: SampleEntry[] };

  const i = Number(body.i);
  if (!Number.isInteger(i) || i < 0 || i >= sample.length) {
    throw createError({ statusCode: 400, statusMessage: `sample index out of range: ${String(body.i)}` });
  }
  const entry = sample[i]!;

  const roster = new Set(
    (JSON.parse(readFileSync(join(root, 'data/characters.json'), 'utf8')) as { id: string }[]).map(
      (c) => c.id,
    ),
  );
  const plate = (raw: unknown, side: string): string | null => {
    if (raw === null || raw === undefined || raw === '') return null;
    const v = String(raw);
    if (!roster.has(v)) {
      throw createError({ statusCode: 400, statusMessage: `unknown fighter id "${v}" on ${side}` });
    }
    return v;
  };

  const path = join(root, 'data/plate-labels.json');
  const labels = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : {};
  labels[`${entry.videoId}/${entry.sec}`] = {
    left: plate(body.left, 'left'),
    right: plate(body.right, 'right'),
    at: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(path, `${JSON.stringify(labels, null, 2)}\n`, 'utf8');

  return { ok: true, saved: Object.keys(labels).length };
});
