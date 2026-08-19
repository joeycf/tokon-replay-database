/**
 * Dev-only: everywhere a human read and an automatic tier disagree.
 *
 * A check that finds nothing must be distinguishable from a check that did not
 * run, so the cross-tier section reports how many sides it SCANNED even when it
 * has no rows. Zero across 227 is the current answer and it is worth stating.
 */

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const roster = readJson<{ id: string; name: string }[]>('data/characters.json', []);
  const nameOf = new Map(roster.map((c) => [c.id, c.name]));
  const nm = (id: string) => nameOf.get(id) ?? id;

  const ct = crossTier();
  const ob = offBench();

  return {
    crossTier: {
      scanned: ct.scanned,
      rows: ct.rows.map((r) => ({
        ...r,
        claimedNames: r.claimed.map(nm),
        humanNames: r.human.map(nm),
        missingNames: r.missing.map(nm),
      })),
    },
    offBench: ob.map((o) => ({
      ...o,
      readName: nm(o.read),
      pointName: nm(o.point),
      benchNames: o.benches.map((b) => b.map(nm)),
    })),
  };
});
