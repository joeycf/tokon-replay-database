/**
 * Dev-only: the bench-queue drain worklist — the human path's front door.
 *
 * Each item is one genuinely incomplete side, two frames from different bursts, and
 * the whole roster. No hash pre-sort: the portrait reader was measured and stopped
 * (a fighter's own icon varies more across matches than fighters differ from each
 * other), so offering its guesses would be dressing noise up as help.
 *
 * What IS offered is the nameplate reader's answer for the point fighter, which
 * scored 100% against human plate labels. That is why three picks complete a side
 * of four.
 */

import { partitionReviewQueue } from '@engine/server/utils/reviewQueue';

import { titleClaim } from '../../../scripts/title-refutation';

interface OvSide {
  characters: string[];
  handle?: string;
  provenance: {
    fromTitle?: string[];
    fromHuman?: string[];
    humanScreenSide?: 'L' | 'R';
    humanPicks?: { a: string[]; b: string[]; forced?: boolean };
    titleRefuted?: string[];
    titleRefutedWhy?: string;
    titleRefutedAt?: string;
  };
}

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const { items: work, awaitingFootage } = buildBench();
  const roster = readJson<{ id: string; name: string }[]>('data/characters.json', []);
  const nameOf = new Map(roster.map((c) => [c.id, c.name]));
  const named = (ids: string[]) => ids.map((id) => ({ id, name: nameOf.get(id) ?? id }));
  const overrides = readJson<Record<string, { sides?: OvSide[] }>>('data/overrides.json', {});
  const videos = readJson<{ id: string; sides: OvSide[] }[]>('data/videos.json', []);
  const publishedSides = new Map(videos.map((v) => [v.id, v.sides]));

  const items = work.map((w, i) => {
    // Match the saved side by the SCREEN side it was read from. Falling back to
    // the record-side index only works when the plate could attribute it, which is
    // exactly the case that did not need help.
    const ovSides = overrides[w.video]?.sides ?? [];
    const ovSide = savedSideFor(w, ovSides);
    const prov = ovSide?.provenance;
    // NO "any human side on this video" FALLBACK. One was tried and it reported
    // 37 of 50 sides drained when three had been: nearly every one of these records
    // already has its OTHER side hand-read from the earlier pass, and matching on
    // the video alone claimed that work as this side's. A false green is worse than
    // a false grey — grey costs a second look, green costs the side entirely.
    const saved = prov?.fromHuman ?? null;
    // RECHECK READS THE FILE THE VERDICT WRITES (c650959's rule, applied to the
    // control as well as to `done`). `w.recheck` comes from videos.json, which is
    // stale until the next parse: measured 2026-10-05, a refutation saved on
    // eTTKoXTTyMM or lX85HVFdsnk would have stayed "pending" until then, and an
    // unrecorded drop on a side the plate could not attribute (dE1pzpogWsU,
    // BhAlz4yHmcM) never showed as pending at all, because w.recheck needs a
    // sideIndex. The saved side answers both.
    const recheck = ovSide && Array.isArray(ovSide.characters) ? failsControl(ovSide) : w.recheck;
    // The title's claim for BOTH record sides, from the same base a save builds
    // on, so the reviewer sees what the save will be judged against.
    const sidesNow = overrides[w.video]?.sides ?? publishedSides.get(w.video) ?? [];
    return {
      /** exact per-frame picks when they were recorded; older saves derive them */
      savedPicks: prov?.humanPicks ?? null,
      /** a saved verdict that the title is wrong for this side */
      savedRefuted: prov?.titleRefuted?.length
        ? {
            ids: named(prov.titleRefuted),
            why: prov.titleRefutedWhy ?? '',
            at: prov.titleRefutedAt ?? '',
          }
        : null,
      i,
      // ADDRESS BY IDENTITY, NOT POSITION. The worklist is derived from
      // extracted.json, which grows while a fetch runs, so an index resolved at
      // save time can name a DIFFERENT side than the one on screen — observed
      // live: a list loaded at 160 sides was 192 by the time a save landed, and
      // the server unioned in the wrong point fighter. The set-check refused it,
      // but a coincidence would have let it through.
      //
      // The video id is disclosed here where the template worklist hides it. That
      // trade reads differently for this task: the labeller is already shown the
      // point fighter, and these records are in the bench queue precisely because
      // their descriptions did NOT state a full bench, so there is no answer to
      // leak — while a mis-addressed write is silent, published, and wrong.
      video: w.video,
      secs: w.secs,
      side: w.side,
      // null where the plate read nothing at that second — the page asks the
      // reviewer for the bust as a fourth pick instead of assuming one
      points: w.points.map((p) => (p === null ? null : { id: p, name: nameOf.get(p) ?? p })),
      handles: w.handles,
      needs: w.needs,
      recheck,
      sideIndex: w.sideIndex,
      allSecs: w.allSecs,
      known: named(w.known),
      title: w.title,
      titleSides: [0, 1].map((k) => ({
        handle: w.handles[k] ?? '',
        claim: named(sidesNow[k] ? titleClaim(sidesNow[k].provenance) : []),
        refuted: named(sidesNow[k]?.provenance?.titleRefuted ?? []),
      })),
      opposite: named(w.opposite),
      saved,
      done: Array.isArray(saved) && saved.length > 0,
    };
  });

  // `items` IS THE OPEN WORK (engine v0.14.0). `done` was computed here and the
  // row returned anyway, so a finished bench kept its place in the worklist.
  // A saved side that fails its title control is NOT finished (benchPartition).
  const queue = partitionReviewQueue(items, benchPartition, {
    generatedAt: new Date().toISOString(),
  });

  return {
    total: items.length,
    // "drained" counts what the partition calls resolved, never a bare save
    done: queue.counts.done,
    // queued records with no footage read yet. Not work for a reviewer, and
    // without this count an empty worklist looks like a drained queue.
    awaitingFootage,
    roster: [...roster].sort((a, b) => a.name.localeCompare(b.name)),
    ...queue,
  };
});
