/**
 * The Tōkon patch table — the single boundary authority.
 *
 * One module holds BOTH tables (eras and patches) so the "an era opens on its
 * first patch" invariant is enforceable rather than aspirational, and so
 * `Replay.patch` and the committed `data/patchGroups.json` the app imports are
 * derived from the same source and cannot drift.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VERSION SCHEME: THERE ISN'T ONE. THE TOKEN IS A DATE.
 *
 * Every other game on the platform copies its vendor's own version grammar —
 * Capcom's atomic `X.YYZZ`, Bandai's foldable `X.YY.ZZ`. Tōkon's vendor
 * publishes no version string at all. Arc System Works and Sony ship
 * date-titled posts on the Steam news hub:
 *
 *     "Patch Update 8/10/2026"
 *
 * and nothing else — no semver, no build id, no update-history page, no
 * in-client version display anyone has documented. Notes for the day-one patch
 * went out on X and Discord only and never got a Steam post at all.
 *
 * The one version-shaped number in circulation, `1.002.002`, is a press report
 * of a PlayStation system build. It is not vendor-published, could not be
 * corroborated from any Sony page, and is deliberately NOT used here. Adopting
 * it would be exactly the invention the checklist forbids, dressed up as
 * research.
 *
 * So the token IS the vendor's own publication date, ISO-normalised for URL and
 * sort stability (their `M/D/YYYY` sorts lexically wrong and reads ambiguously
 * outside the US). `announcedOn` records where each row was found, so a row
 * nobody can point at a source for is visible rather than merely plausible.
 *
 * The fold rule follows from this: a build the vendor did not post separately
 * folds into the dated window that CONTAINS it, recorded in `includes`. There
 * is no sequence gap to feel obliged to fill, because dates have no gaps.
 *
 * (Reported upstream as a new-game-checklist gap: step 4 assumes a vendor
 * version grammar exists and says nothing about what to do when one doesn't.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PatchBoundary, PatchWindow, SeasonBoundary } from '../types/index';

/** Global launch. PS5 + PC (Steam/Epic) 2026-08-06 PT; JP/KR/AU/NZ 08-07. The
 *  earlier of the two is the floor, because a JP-region upload on 08-06 PT is
 *  still a launch-build match. */
export const LAUNCH = '2026-08-06';

/** Balance eras. Uploader descriptions on one channel write "(Season 1)", which
 *  is a weak corroboration of the name but never the authority — the date is.
 *  Season 2 does not exist and is not pre-declared: a childless future era
 *  renders as a chip that filters to nothing. */
export const SEASONS: SeasonBoundary[] = [
  { season: 1, start: LAUNCH, end: null, confirmed: true, note: 'Launch' },
];

/**
 * Released patches, oldest first. Every row is a vendor publication.
 *
 * Cadence warning for whoever reads this next: TWO patches shipped in the first
 * five days. scripts/expiries.ts carries a `stale-patch-table` check that goes
 * off if the newest row here is more than 21 days old, because a shipped patch
 * that is missing from this table does not fail — it silently files every
 * replay since under the previous token, which renders, filters and passes
 * every count assertion while being wrong.
 */
export const PATCHES: PatchBoundary[] = [
  {
    version: '2026-08-06',
    start: '2026-08-06',
    announcedOn: 'launch',
    note: 'Launch build',
    includes: ['day-one update (X/Discord only — no Steam news post)'],
  },
  {
    version: '2026-08-10',
    start: '2026-08-10',
    announcedOn: 'steam',
    note: 'Patch Update 8/10/2026',
  },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ERA_TOKEN = /^S\d+$/i;
const today = () => new Date().toISOString().slice(0, 10);

export function validateSeasons(seasons: SeasonBoundary[] = SEASONS): void {
  if (seasons.length === 0) throw new Error('SEASONS is empty');
  seasons.forEach((s, i) => {
    if (!ISO_DAY.test(s.start)) throw new Error(`S${s.season}: start "${s.start}" is not ISO`);
    if (s.start < LAUNCH) throw new Error(`S${s.season}: starts before launch (${LAUNCH})`);
    const prev = seasons[i - 1];
    if (prev && s.start <= prev.start) {
      throw new Error(`S${s.season}: starts on/before S${prev.season}`);
    }
    if (prev && prev.end !== s.start) {
      throw new Error(`S${prev.season}.end must equal S${s.season}.start`);
    }
  });
  const last = seasons.at(-1)!;
  if (last.end !== null)
    throw new Error(`S${last.season} is the current era and must have end: null`);
}

export function validatePatches(
  patches: PatchBoundary[] = PATCHES,
  seasons: SeasonBoundary[] = SEASONS,
): void {
  if (patches.length === 0) throw new Error('PATCHES is empty');
  const seen = new Set<string>();
  const now = today();

  patches.forEach((p, i) => {
    // The token IS the date. A row whose token and start disagree is a typo,
    // and it would mint a URL that no window ever matches.
    if (!ISO_DAY.test(p.version)) {
      throw new Error(`patch "${p.version}": token must be an ISO date (the vendor's own grammar)`);
    }
    if (p.version !== p.start) {
      throw new Error(`patch "${p.version}": token must equal start ("${p.start}")`);
    }
    if (ERA_TOKEN.test(p.version)) {
      throw new Error(`patch "${p.version}": collides with an era token`);
    }
    if (seen.has(p.version)) throw new Error(`patch "${p.version}": duplicate token`);
    seen.add(p.version);

    if (p.start < LAUNCH) throw new Error(`patch "${p.version}": predates launch (${LAUNCH})`);
    // A typo'd year mints an empty future window that filters to nothing and
    // asserts perfectly clean — the exact silent failure this table exists to
    // avoid.
    if (p.start > now) throw new Error(`patch "${p.version}": is in the future (today ${now})`);

    const prev = patches[i - 1];
    if (prev && p.start <= prev.start) {
      throw new Error(`patch "${p.version}": not strictly after "${prev.version}"`);
    }
    if (seasonForDate(p.start, seasons) === 0) {
      throw new Error(`patch "${p.version}": start falls in no era`);
    }
    // 'announcedOn' is required by the type, but a hand edit can still write a
    // value outside the union at the JSON boundary; assert the intent.
    if (!['steam', 'x', 'discord', 'launch'].includes(p.announcedOn)) {
      throw new Error(
        `patch "${p.version}": announcedOn "${p.announcedOn}" is not a known channel`,
      );
    }
    for (const inc of p.includes ?? []) {
      if (seen.has(inc)) throw new Error(`patch "${p.version}": includes a paged token ("${inc}")`);
      if (inc === p.version) throw new Error(`patch "${p.version}": includes itself`);
    }
  });

  // Every era must open on a real patch, or the era chip covers a window whose
  // first days belong to no child.
  for (const s of seasons) {
    if (!patches.some((p) => p.start === s.start)) {
      throw new Error(`S${s.season}: no patch opens the era on ${s.start}`);
    }
  }
}

export function seasonForDate(iso: string, seasons: SeasonBoundary[] = SEASONS): number {
  const s = seasons.find((x) => iso >= x.start && (x.end === null || iso < x.end));
  return s ? s.season : 0;
}

export const seasonToken = (season: number): string => `S${season}`;

/** Patches with their computed windows. `end` is never authored. */
export function patchWindows(
  patches: PatchBoundary[] = PATCHES,
  seasons: SeasonBoundary[] = SEASONS,
): PatchWindow[] {
  return patches.map((p, i) => {
    const season = seasonForDate(p.start, seasons);
    const era = seasons.find((s) => s.season === season)!;
    const next = patches[i + 1];
    const end = next && seasonForDate(next.start, seasons) === season ? next.start : era.end;
    return { ...p, end: end ?? null, season };
  });
}

/** The child token a date falls in, or undefined when the date precedes every
 *  patch in its era (then the caller emits the era token — "era known, patch
 *  unknown" is a real state and the engine models it). */
export function patchForDate(iso: string, windows: PatchWindow[] = patchWindows()) {
  return windows.find((w) => iso >= w.start && (w.end === null || iso < w.end));
}

/** The GameConfig.patchGroups payload → data/patchGroups.json.
 *
 *  Parents carry a self-describing "Season N" label because the engine's
 *  default facet heading is "Patch", under which a bare "S1" chip reads wrong.
 *  Children carry no label: the token IS the display string. */
export function buildPatchGroups(
  seasons: SeasonBoundary[] = SEASONS,
  patches: PatchBoundary[] = PATCHES,
) {
  const windows = patchWindows(patches, seasons);
  return seasons.map((s) => {
    const children = windows
      .filter((w) => w.season === s.season)
      .map((w) => ({ id: w.version, ...(w.note ? { note: w.note } : {}) }));
    return {
      id: seasonToken(s.season),
      label: `Season ${s.season}`,
      ...(s.note ? { note: s.note } : {}),
      ...(children.length ? { children } : {}),
    };
  });
}

// ── standalone `--check` ─────────────────────────────────────────────────────
// Both validators are pure and offline, but `tsc --noEmit` only TYPE-checks —
// it never runs them, so a table edit would otherwise only be caught during an
// emit. This entry puts it in the typecheck path (see package.json).
const isMain = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain && process.argv.includes('--check')) {
  validateSeasons();
  validatePatches();
  const windows = patchWindows();
  const ids = new Set<string>();
  for (const g of buildPatchGroups()) {
    if (ids.has(g.id)) throw new Error(`patchGroups: duplicate id "${g.id}"`);
    ids.add(g.id);
    for (const c of g.children ?? []) {
      if (ids.has(c.id)) throw new Error(`patchGroups: duplicate id "${c.id}"`);
      ids.add(c.id);
    }
  }
  console.log(
    `✓ ${SEASONS.length} era(s), ${PATCHES.length} dated patches, ${ids.size} unique facet ids — ` +
      `${windows.filter((w) => w.end === null).length} open window(s), ` +
      `newest ${PATCHES.at(-1)!.version} (announced on ${PATCHES.at(-1)!.announcedOn})`,
  );
}
