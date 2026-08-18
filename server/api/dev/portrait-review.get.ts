/**
 * Dev-only: the bench-diamond labelling worklist, with the reader's pre-sort.
 *
 * Each item is three diamonds and the three fighters they must hold. The reader's
 * current templates order the candidates per diamond — 46.9% top-3 recall is
 * useless as a RESOLVER but genuinely useful as a PRE-SORT, because putting the
 * likeliest name first turns most items into a confirmation rather than a search.
 *
 * The pre-sort is advisory and says so. It is never pre-selected: a suggestion the
 * labeller has to actively accept cannot quietly become the label, which is the
 * failure mode that cost this project seventeen contaminated plate labels.
 *
 * THE CANDIDATE SET IS NOT ALWAYS RIGHT, so the full roster ships alongside it. The
 * three candidates come from the uploader's own description, and a description can
 * name a bench the match does not field — a typo, a team changed between games, a
 * parse that split a name wrongly. The labeller looking at the pixels is the more
 * reliable witness, so they must be able to answer OFF-BENCH rather than being
 * forced into a closed set that is wrong.
 *
 * Those disagreements are counted rather than swallowed. Description-derived benches
 * are the truth set the whole tier is scored against, so how often a human contradicts
 * one is a measurement of that truth set, and it belongs in the report either way.
 */

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const work = buildWorkList();
  const labels = readJson<Record<string, { char: string }>>('data/portrait-labels.json', {});
  const roster = readJson<{ id: string; name: string }[]>('data/characters.json', []);
  const nameOf = new Map(roster.map((c) => [c.id, c.name]));
  const templates = readJson<Record<string, { lit?: string; dim?: string }>>(
    'cache/tokon/portrait-templates.json',
    {},
  );

  const CELLS = ['left', 'right', 'bottom'];
  let offBench = 0;
  const items = work.map((w, i) => {
    const saved = CELLS.map((c) => labels[labelKey(w, c)]?.char ?? null);
    const off = saved.map((s) => s !== null && !w.candidates.includes(s));
    offBench += off.filter(Boolean).length;
    return {
      i,
      side: w.side,
      point: w.point,
      pointName: nameOf.get(w.point) ?? w.point,
      candidates: w.candidates.map((id) => ({ id, name: nameOf.get(id) ?? id })),
      saved,
      /** per cell: the label contradicts the description's bench */
      off,
      done: saved.filter(Boolean).length === CELLS.length,
    };
  });

  return {
    total: items.length,
    labelled: items.filter((x) => x.done).length,
    crops: Object.keys(labels).length,
    offBench,
    hasTemplates: Object.keys(templates).length > 0,
    roster: [...roster].sort((a, b) => a.name.localeCompare(b.name)),
    items,
  };
});
