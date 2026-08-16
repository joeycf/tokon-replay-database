/**
 * Dev-only: the per-frame plate-labelling worklist.
 *
 * 404 outside `nuxt dev`, and the static output carries no server at all.
 *
 * THIS PAYLOAD IS DELIBERATELY ALMOST EMPTY, and the reason is a failure. The
 * previous version of this page rendered the video title as its heading, and
 * every Tōkon title names exactly two fighters per side — "Momus (Storm/Loki) vs
 * Kax (Danger/Iron-Man)". Seventeen videos were labelled through it and all 17
 * point labels reproduced the title exactly. The page was built so the MACHINE
 * could not whisper the answer, and left the title shouting it.
 *
 * So: no title, no description, no handles, no channel, no video id, and no
 * reader answer. The frame is addressed by an opaque sample index, so the video
 * id never enters the DOM and cannot be looked up. A labeller sees a picture and
 * a counter. Everything else is a way to be told what to say.
 *
 * The sample's STRATA — which plates the reader resolved and which it rejected —
 * live in cache/tokon/plate-sample.json and stop there. Telling the labeller
 * which plates the machine failed on would be a subtler version of the same
 * mistake.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface SampleEntry {
  videoId: string;
  sec: number;
}
interface PlateLabel {
  left: string | null;
  right: string | null;
  at: string;
}

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const root = process.cwd();
  const read = <T>(p: string, fallback: T): T => {
    const f = join(root, p);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback;
  };

  const { sample } = read<{ sample: SampleEntry[] }>('cache/tokon/plate-sample.json', {
    sample: [],
  });
  const labels = read<Record<string, PlateLabel>>('data/plate-labels.json', {});
  const roster = read<{ id: string; name: string }[]>('data/characters.json', [])
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!sample.length) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'no plate sample — run `npx tsx scripts/spike/build-plate-sample.ts` first',
    });
  }

  return {
    roster,
    total: sample.length,
    // Index and saved verdict. Nothing else. `saved` is the labeller's own prior
    // answer, which is theirs to see; a first pass returns null and opens blank.
    items: sample.map((e, i) => {
      const saved = labels[`${e.videoId}/${e.sec}`];
      return {
        i,
        saved: saved ? { left: saved.left, right: saved.right } : null,
      };
    }),
  };
});
