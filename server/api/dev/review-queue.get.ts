/**
 * Dev-only: the review queue's worklist — the last surface with no exit.
 *
 * A `character-completion` record is held off the site entirely because no
 * character resolved in either title slot, and until the verdict hook in
 * parse.ts existed that was PERMANENT BY CONSTRUCTION. The record is absent from
 * videos.json, therefore absent from bench-queue.json, so scripts/
 * complete-characters.ts could not read its footage and /dev/bench-review could
 * not list it; and applyOverrides maps over records the parser built, which
 * these never become, so hand-authoring `sides` did nothing and `exclude` was a
 * no-op. Resolving one took a commit.
 *
 * NO FRAMES ARE OFFERED, and that is not an oversight — it is the same gap
 * stated honestly. The extractor never ran on these records because it works
 * from the bench queue, so there is nothing cached to crop. The evidence a
 * reviewer gets is the title, the handles and a link out to YouTube, which
 * mirrors /dev/bench-review's own escape hatch (bench-review.vue links to the
 * video at a timestamp rather than embedding it).
 *
 * SCOPED TO ONE KIND. `bench-conflict` and `slot-ambiguous` are both zero in the
 * corpus and carry a different shape (`conflict`), so there is nothing to design
 * a form against. Their counts are returned anyway: a surface that silently
 * handles a subset is indistinguishable from one that has no work, and the page
 * says which kinds it is not showing.
 */

import { buildAliasMatcher } from '../../../scripts/roster';
import type { CharacterRecord, ReviewQueueItem, VideoOverride } from '../../../types/index';

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const queue = readJson<ReviewQueueItem[]>('data/review-queue.json', []);
  const roster = readJson<CharacterRecord[]>('data/characters.json', []);
  const overrides = readJson<Record<string, VideoOverride>>('data/overrides.json', {});

  const mine = queue.filter((q) => q.kind === 'character-completion');
  // Flagged HERE as well as refused in the POST, so the reason is on screen
  // before somebody spends a minute picking eight fighters for a record that
  // cannot accept them. See review-queue.post.ts for why a handle containing a
  // fighter is a wrong parse rather than an unknown one.
  const matcher = buildAliasMatcher(roster);
  const blockedReason = (handles: [string, string]): string | null => {
    for (const [i, h] of handles.entries()) {
      const inside = matcher.ids(h);
      if (inside.length) return `handle ${i} ("${h}") contains ${inside.join('/')}`;
    }
    return null;
  };
  const others: Record<string, number> = {};
  for (const q of queue)
    if (q.kind !== 'character-completion') others[q.kind] = (others[q.kind] ?? 0) + 1;

  return {
    // Sorted by the roster's display name, matching every other dev picker.
    roster: roster
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    otherKinds: others,
    items: mine.map((q) => {
      const ov = overrides[q.id];
      // A SAVED VERDICT MUST READ BACK AS DONE. bench-review learned this the
      // expensive way: its ticks stayed grey while writes landed perfectly,
      // which invites the same record to be judged twice and is worse than not
      // writing at all. Here the override IS the state, so it is read straight
      // back rather than inferred.
      const saved = ov?.exclude
        ? ({ verdict: 'reject' } as const)
        : ov?.sides
          ? ({ verdict: 'complete', sides: ov.sides.map((s) => s.characters) } as const)
          : null;
      return {
        id: q.id,
        channel: q.channel,
        title: q.title,
        publishedAt: q.publishedAt,
        durationSec: q.durationSec,
        // Canonicalised against players.json upstream (types/index.ts), so
        // showing them here cannot mint a second player page for a spelling.
        handles: q.handles ?? ['', ''],
        blocked: blockedReason(q.handles ?? ['', '']),
        saved,
      };
    }),
  };
});
