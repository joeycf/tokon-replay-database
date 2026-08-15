/**
 * Dev-only: persist ONE blind label from /dev/source-review into
 * data/labels.json — the only file this endpoint may touch.
 *
 * WHY NOT data/overrides.json, WHICH IS WHERE THE SIBLINGS WRITE. An override is
 * a CORRECTION to published data. These forty-one records are already complete
 * and correct — their benches came from prose descriptions and are the ground
 * truth the reader is scored against. Writing labels there would re-state the
 * same values as if they were fixes, and would put a measurement artifact inside
 * the pipeline's correction channel where a later parse would apply it.
 *
 * data/labels.json is committed rather than cached: it is the most expensive
 * artifact in the project (a human watched footage for every row) and cache/ is
 * the directory that gets deleted to reclaim disk.
 *
 * Verdict shape:
 *   { id, point: [[ids],[ids]], bench: [[ids],[ids]], leftIsFirst: boolean|null }
 *
 * Both lists are per RECORD SIDE — index 0 is the title's first-named player —
 * so `leftIsFirst` carries the screen mapping separately rather than being baked
 * into the order. Baking it in would make a re-labelled record silently
 * disagree with its earlier self about which fact changed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Body {
  id?: unknown;
  point?: unknown;
  bench?: unknown;
  leftIsFirst?: unknown;
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const root = process.cwd();
  const body = (await readBody(event)) as Body;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' });

  const videos = JSON.parse(readFileSync(join(root, 'data/videos.json'), 'utf8')) as {
    id: string;
    sides: { characters: string[] }[];
  }[];
  const v = videos.find((x) => x.id === id);
  // Only the labelling corpus may be labelled. An id outside it is either a typo
  // or a page that has drifted from its own worklist; both are bugs, not input.
  const inCorpus =
    v && v.sides.length === 2 && v.sides.every((s) => s.characters.length === 4);
  if (!inCorpus) {
    throw createError({
      statusCode: 404,
      statusMessage: `id "${id}" is not in the ground-truth labelling corpus`,
    });
  }

  const roster = new Set(
    (JSON.parse(readFileSync(join(root, 'data/characters.json'), 'utf8')) as { id: string }[]).map(
      (c) => c.id,
    ),
  );
  const pair = (raw: unknown, what: string): [string[], string[]] => {
    if (!Array.isArray(raw) || raw.length !== 2) {
      throw createError({ statusCode: 400, statusMessage: `${what} must be two lists` });
    }
    return raw.map((side) => {
      if (!Array.isArray(side)) {
        throw createError({ statusCode: 400, statusMessage: `${what} side must be a list` });
      }
      const ids = [...new Set(side.map(String))];
      for (const c of ids) {
        if (!roster.has(c)) {
          throw createError({ statusCode: 400, statusMessage: `unknown fighter id "${c}"` });
        }
      }
      return ids;
    }) as [string[], string[]];
  };

  const point = pair(body.point, 'point');
  const bench = pair(body.bench, 'bench');
  // The point union is who held point; it cannot contain someone who is not on
  // the side's own bench. Catching it here keeps a slip out of the measurement
  // rather than surfacing it as a mysterious disagreement three steps later.
  for (const i of [0, 1] as const) {
    const stray = point[i].filter((c) => !bench[i].includes(c));
    if (stray.length) {
      throw createError({
        statusCode: 400,
        statusMessage: `side ${i + 1}: [${stray.join(', ')}] held point but is not on that bench`,
      });
    }
  }

  const path = join(root, 'data/labels.json');
  const labels = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : {};
  labels[id] = {
    point,
    bench,
    leftIsFirst: typeof body.leftIsFirst === 'boolean' ? body.leftIsFirst : null,
    at: new Date().toISOString().slice(0, 10),
  };
  // Non-ASCII escaped, matching the other data files, so a save does not
  // reformat every line that happens to hold a handle with an accent.
  const serialized =
    JSON.stringify(labels, null, 2).replace(
      /[\u0080-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    ) + '\n';
  writeFileSync(path, serialized, 'utf8');

  return { ok: true, saved: Object.keys(labels).length };
});
