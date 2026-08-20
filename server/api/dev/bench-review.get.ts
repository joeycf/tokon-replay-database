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
    Record<
      string,
      {
        sides?: {
          provenance?: {
            fromHuman?: string[];
            humanScreenSide?: 'L' | 'R';
            humanPicks?: { a: string[]; b: string[]; forced?: boolean };
          };
        }[];
      }
    >
  >('data/overrides.json', {});


  const items = work.map((w, i) => {
    // Match the saved side by the SCREEN side it was read from. Falling back to
    // the record-side index only works when the plate could attribute it, which is
    // exactly the case that did not need help.
    const ovSides = overrides[w.video]?.sides ?? [];
    let prov = ovSides.find((s) => s.provenance?.humanScreenSide === w.side)?.provenance;
    if (!prov && w.sideIndex !== null) prov = ovSides[w.sideIndex]?.provenance;
    // NO "any human side on this video" FALLBACK. One was tried and it reported
    // 37 of 50 sides drained when three had been: nearly every one of these records
    // already has its OTHER side hand-read from the earlier pass, and matching on
    // the video alone claimed that work as this side's. A false green is worse than
    // a false grey — grey costs a second look, green costs the side entirely.
    const saved = prov?.fromHuman ?? null;
    return {
      /** exact per-frame picks when they were recorded; older saves derive them */
      savedPicks: prov?.humanPicks ?? null,
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
      recheck: w.recheck,
      sideIndex: w.sideIndex,
      allSecs: w.allSecs,
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
