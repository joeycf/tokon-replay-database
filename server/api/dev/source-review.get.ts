/**
 * Dev-only: the blind-labelling worklist.
 *
 * Same shipping guarantees as the siblings' curation endpoints: 404 outside
 * `nuxt dev`, and the static output carries no server at all.
 *
 * WHY THIS LABELS THE GROUND-TRUTH VIDEOS AND NOT THE BENCH QUEUE. The
 * description-derived ground truth cannot check itself. It says a side's bench
 * is four fighters; the reader says two of them took point; and both are true at
 * once, because a bench member can spend a whole set on assists without ever
 * holding point. Scoring the reader against the description therefore measures
 * a semantic gap and reports it as recall — 36% of bench slots never appear on a
 * nameplate at all.
 *
 * A human looking at the footage can separate them, and only a human can. So
 * each item asks for TWO labels per side:
 *
 *   point  — who actually held point.       Compared against the READER.
 *   bench  — all four, off the corner icons. Compared against the DESCRIPTION.
 *
 * If point matches the reader and bench matches the description, the gap is
 * semantic and the reader is right. If point does NOT match the reader, the
 * reader has a real recall problem the description could never have shown.
 *
 * ONLY A BOOLEAN CROSSES THE WIRE. The extractor's actual answer is computed
 * here and deliberately thrown away, because this page is the ground-truth
 * labelling surface: shipping the machine's characters would put a suggested
 * answer one devtools tab away from a reviewer who is supposed to be labelling
 * blind. A flag says "look again"; it cannot say "say this".
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Side {
  handle: string;
  characters: string[];
  provenance?: { fromTitle?: string[] };
}
interface Video {
  id: string;
  title: string;
  intake: string;
  durationSec: number;
  sides: Side[];
}
interface Extraction {
  hud: number;
  left: { sec: number; id: string | null }[];
  right: { sec: number; id: string | null }[];
}
interface Label {
  point: [string[], string[]];
  bench: [string[], string[]];
  /** true when the labeller says the title's first-named player was on the left */
  leftIsFirst: boolean | null;
  at: string;
}

/** How many frames to offer per item. Enough to see tag-ins without turning the
 *  page into a video player — the bench icons need one, the point union a few. */
const FRAMES_PER_ITEM = 8;

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const root = process.cwd();
  const read = <T>(p: string, fallback: T): T => {
    const f = join(root, p);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback;
  };

  const videos = read<Video[]>('data/videos.json', []);
  const roster = read<{ id: string; name: string }[]>('data/characters.json', []).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const labels = read<Record<string, Label>>('data/labels.json', {});
  const extracted = read<Record<string, Extraction>>('cache/tokon/extracted.json', {});

  // The corpus is exactly the free ground truth: both sides known at four.
  const corpus = videos.filter(
    (v) => v.sides.length === 2 && v.sides.every((s) => s.characters.length === 4),
  );

  const setKey = (xs: string[]) => [...new Set(xs)].sort().join(',');
  const pairKey = (a: string[], b: string[]) => [setKey(a), setKey(b)].sort().join(' | ');

  /** Does the reader's point union differ from what the human said? Unordered on
   *  both axes — within a side because tag order is presentational, and across
   *  sides because screen order is exactly what the label is establishing. */
  const disputedBy = (id: string, label: Label | undefined): boolean => {
    const e = extracted[id];
    if (!e || !label) return false;
    const fold = (rs: { id: string | null }[]) => [...new Set(rs.map((r) => r.id).filter(Boolean))];
    return (
      pairKey(label.point[0], label.point[1]) !==
      pairKey(fold(e.left) as string[], fold(e.right) as string[])
    );
  };

  /** HUD-bearing seconds, from the extraction if it exists, else whatever is
   *  cached. Spread across the runtime so the sample spans tag-ins. */
  const framesFor = (id: string): number[] => {
    const e = extracted[id];
    let secs: number[];
    if (e?.left?.length) {
      secs = e.left.map((r) => r.sec);
    } else {
      const dir = join(root, 'cache/tokon/frames', id);
      if (!existsSync(dir)) return [];
      secs = readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .map((f) => Number(f.replace('.png', '')));
    }
    secs.sort((a, b) => a - b);
    if (secs.length <= FRAMES_PER_ITEM) return secs;
    const step = (secs.length - 1) / (FRAMES_PER_ITEM - 1);
    return Array.from({ length: FRAMES_PER_ITEM }, (_, i) => secs[Math.round(i * step)]!);
  };

  return {
    roster,
    items: corpus.map((v) => ({
      id: v.id,
      title: v.title,
      channel: v.intake,
      durationSec: v.durationSec,
      handles: v.sides.map((s) => s.handle) as [string, string],
      /** the fighter the TITLE named per side — the reader's own anchor, and the
       *  one thing a labeller may see, because the title is on screen anyway */
      titleChars: v.sides.map((s) => s.provenance?.fromTitle?.[0] ?? '') as [string, string],
      frames: framesFor(v.id),
      cached: existsSync(join(root, 'cache/tokon/frames', v.id)),
      saved: labels[v.id] ?? null,
      disputed: disputedBy(v.id, labels[v.id]),
    })),
  };
});
