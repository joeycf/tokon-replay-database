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

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const work = buildBenchList();
  const roster = readJson<{ id: string; name: string }[]>('data/characters.json', []);
  const nameOf = new Map(roster.map((c) => [c.id, c.name]));
  const overrides = readJson<
    Record<string, { sides?: { provenance?: { fromHuman?: string[] } }[] }>
  >('data/overrides.json', {});

  const items = work.map((w, i) => {
    const saved = overrides[w.video]?.sides?.[w.sideIndex]?.provenance?.fromHuman ?? null;
    return {
      i,
      side: w.side,
      points: w.points.map((p) => ({ id: p, name: nameOf.get(p) ?? p })),
      known: w.known.map((k) => ({ id: k, name: nameOf.get(k) ?? k })),
      saved,
      done: Array.isArray(saved) && saved.length > 0,
    };
  });

  return {
    total: items.length,
    done: items.filter((x) => x.done).length,
    roster: [...roster].sort((a, b) => a.name.localeCompare(b.name)),
    items,
  };
});
