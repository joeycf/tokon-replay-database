/**
 * Dev-only: everywhere a human read and an automatic tier disagree.
 *
 * A check that finds nothing must be distinguishable from a check that did not
 * run, so the cross-tier section reports how many sides it SCANNED even when it
 * has no rows. (It was zero across 227 when written; by 2026-10-05 it was six
 * across 1,383, five of them wrong titles — see server/utils/disagree.ts.) Title
 * refutations ride along as `acknowledged`: settled, and shown with their
 * evidence rather than dropped.
 */

import type { CrossTier } from '../../utils/disagree';

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const roster = readJson<{ id: string; name: string }[]>('data/characters.json', []);
  const nameOf = new Map(roster.map((c) => [c.id, c.name]));
  const nm = (id: string) => nameOf.get(id) ?? id;

  const ct = crossTier();
  const ob = offBench();

  const withNames = (r: CrossTier) => ({
    ...r,
    claimedNames: r.claimed.map(nm),
    humanNames: r.human.map(nm),
    missingNames: r.missing.map(nm),
    refutedNames: (r.refuted ?? []).map(nm),
  });

  return {
    roster: [...roster].sort((a, b) => a.name.localeCompare(b.name)),
    crossTier: {
      scanned: ct.scanned,
      rows: ct.rows.map(withNames),
      acknowledged: ct.acknowledged.map(withNames),
    },
    // OPEN disagreements only. `applied` has been computed here since the row
    // existed and never used to filter, so a disagreement the reviewer had
    // already resolved came back every time — the page "kept offering buttons for
    // work already done", which is the failure this file's own comment describes.
    // The resolved ones ride along for reference rather than disappearing.
    offBench: ob
      .filter((o) => !o.applied)
      .map((o) => ({
        ...o,
        readName: nm(o.read),
        pointName: nm(o.point),
        benchNames: o.benches.map((b) => b.map(nm)),
      })),
    offBenchResolved: ob
      .filter((o) => o.applied)
      .map((o) => ({
        ...o,
        readName: nm(o.read),
        pointName: nm(o.point),
        benchNames: o.benches.map((b) => b.map(nm)),
      })),
    counts: {
      total: ob.length,
      pending: ob.filter((o) => !o.applied).length,
      done: ob.filter((o) => o.applied).length,
      unreadable: 0,
    },
  };
});
