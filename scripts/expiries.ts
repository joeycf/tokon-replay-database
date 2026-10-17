/**
 * Self-expiring gates — things the DATA can tell us are due, rather than things
 * a human has to remember.
 *
 * THREE SEVERITIES, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE DESIGN:
 *
 *   scripts/characters.ts  (manual roster run)  → process.exit(1)
 *   scripts/parse.ts       (daily cron path)    → NEVER exits; prints a FAILURE
 *                                                 banner and writes an
 *                                                 "## ⚠ ACTION REQUIRED" block
 *                                                 at the top of data/report.md
 *   .github/workflows/pending-work.yml          → runs after every completed
 *                                                 data run and exits 1
 *
 * A hard exit in parse.ts would fail `npm run data:build` and stop the daily
 * refresh entirely, which is strictly worse than the misfiling it warns about:
 * a day of stale data costs more than a day of a fighter filed under the wrong
 * accent. So the daily path stays soft, the data gets pushed, and the "Pending
 * work" run (workflow_run on the data run's completion) goes red afterwards so
 * the pending work is impossible to miss — and a held data run can no longer
 * hide a due expiry behind it, which it did on 2026-10-12.
 *
 * THE RED PENDING-WORK RUN AND THE exit 1 ARE THE DESIGN, NOT A BUG. Clear them by
 * doing the work below — never by deleting the check.
 *
 * Second-order property worth preserving: report.md's commit guard drops the
 * file when the only diff is its "_Generated_" timestamp. An ACTION REQUIRED
 * block is real content, so the day it first appears the guard lets it through
 * and the signal reaches git — and the deployed site — even on a no-change day.
 *
 * Run: npm run data:expiries   (tsx scripts/expiries.ts --check)
 */

import { CONFIRMED_QUIET_THROUGH, PATCHES, SEASONS } from './patches';
import type { Expiry } from '../types/index';

/**
 * Fighters that are announced but NOT yet playable.
 *
 * A row here is what turns a future release into a due expiry instead of
 * something someone has to diary. `releases` is the date the row FIRES, which
 * for a windowed announcement is the START of the window, not a guess at the
 * day — firing early costs one dismissed warning, firing late means the fighter
 * shipped and the archive silently filed them nowhere.
 *
 * Champion is deliberately absent: he is a hidden unlockable that shipped in
 * the base game, needs no patch and no purchase, and is already on the roster.
 */
export const UNRELEASED: { id: string; releases: string; accent?: string; note?: string }[] = [
  {
    id: 'phoenix-cyclops',
    releases: '2026-11-02',
    // Already derived — the design handoff's own worked DLC example carries it
    // at 7.4:1, so release day is a one-line change rather than a design task.
    accent: '#FF9D57',
    note:
      'Year-1 character #1. DATED: first announced 2026-10-07 (PlayStation Blog 17:00Z, ' +
      'YouTube 3y9_kwKo3Fs, Bluesky), Steam copy 2026-10-08: "Phoenix Cyclops joins MARVEL ' +
      'Tōkon: Fighting Souls on November 2". Fired at window open on 2026-10-01 (not playable ' +
      'on 10-02), then was re-dated two weeks out while no date existed. This is the release ' +
      'day, IN PACIFIC TIME: SIE\'s Japanese release writes "11月2日（月）（※太平洋時間）", so ' +
      "the cron's 2026-11-02 07:47Z run is 11-01 23:47 PST and fires before the release day " +
      "has begun — expected, and what this file's rule accepts (early costs one dismissed " +
      'warning); 11-03 07:47Z is the first run on the release day. If it slips, re-date the ' +
      'row — do not delete it.',
  },
  // ── THE YEAR-1 SLOTS, NAMED 2026-10-11 ─────────────────────────────────────
  // These three replace 'year1-character-2', 'year1-character-3-and-stage' and
  // 'year1-character-4' — the unnamed one-row-per-window placeholders, which in
  // turn replaced a single 'year1-remainder' row dated 2027-12-31. That date
  // was the pass's OUTSIDE COMMITMENT ("expected to be made available by 31
  // December 2027" on the Year 1 pass listing), not a release date, and it
  // would have fired ELEVEN MONTHS after character 2's window opened — the
  // exact failure this file exists to prevent. The placeholders fixed the
  // dates; these rows put names on them, the same way the October row was split
  // in the CotW repo (ae5c9f8, Mikey/Draken).
  //
  // THE VENDOR NAMED ALL THREE ON 2026-10-11, during EVO France — YouTube at
  // 11:58Z, X at 13:00Z, Bluesky at 13:50Z — and never on Steam news or Sony's
  // Hero Select page, so the two surfaces the checkers read said nothing.
  // Verbatim:
  //   · Bluesky, bsky.app/profile/marveltokon.bsky.social/post/3mxm5ioefd22t:
  //     "Thor (Jane Foster) - Winter 2027 / Venom - Spring 2027 / Jubilee -
  //     Summer 2027"
  //   · X, x.com/MARVELTokon/status/2109267863047401839 — quoted for the three
  //     NAMES only: the same post misdates Cyclops ("October 12th").
  //   · YouTube, youtube.com/watch?v=sNf7HHYxTAM: "Thor (Jane Foster), the
  //     second DLC character in the Year 1 Character & Stage Pass … Coming this
  //     Winter!"
  //   · the roster image on the posts: "SPRING 2027 / VENOM & KLYNTAR STAGE".
  //
  // THE QUARTERS ARE VENDOR-SOURCED TOO, SO THE WINDOW-OPEN DATES STAND. The
  // season-pass block on store.steampowered.com/app/4848500/ lists milestones
  // 91639 "Year 1 character 2 (Jan-Mar 2027)", 49216 "Year 1 character 3
  // (Apr-Jun 2027)", 49651 "Year 1 Stage (Apr-Jun 2027)" and 51085 "Year 1
  // character 4 (Jul-Sep 2027)". Each season word lands in exactly one of those
  // quarters: Thor = #2 is EXPLICIT (the YouTube line says "second"); Venom +
  // Klyntar Stage = #3 and Jubilee = #4 are WINDOW MATCHES — strong, and marked
  // as inference in their notes rather than stated as fact.
  //
  // Sony's Hero Select still lists 21 and none of the four (2026-10-15), so
  // every id below is the kebab of the vendor's own spelling, to be confirmed
  // there. No accent on any of them: never invented here — the action text says
  // where one comes from, and phoenix-cyclops carries his only because the
  // design handoff already had it.
  {
    id: 'thor-jane-foster',
    releases: '2027-01-01',
    note:
      'Year-1 character #2. "Thor (Jane Foster) - Winter 2027" (Bluesky 3mxm5ioefd22t, ' +
      '2026-10-11); the ordinal is EXPLICIT — YouTube sNf7HHYxTAM: "Thor (Jane Foster), the ' +
      'second DLC character in the Year 1 Character & Stage Pass … Coming this Winter!" — and ' +
      'Steam milestone 91639 "Year 1 character 2 (Jan-Mar 2027)" is the quarter, so this fires ' +
      "at window open. The id is the kebab of the vendor's spelling; CONFIRM it against Sony's " +
      'Hero Select when she is listed (not yet, 2026-10-15). Before she joins ROSTER: a bare ' +
      '"Thor" is in 24 titles in raw/ today, all fightingStationX AI-exhibition uploads with no ' +
      'Tōkon marker, so the game-marker gate drops them first: 22 MvC:I "(Hardest AI)" that ' +
      'NOT_A_MATCH_RE would drop as well, plus an MvC:I "(Hardest) AI" and a UMvC3 "(Hardest IA)" ' +
      'that only the gate catches — clean today, so recount on the day.',
  },
  {
    id: 'venom',
    releases: '2027-04-01',
    note:
      'Year-1 character #3, AND the Year-1 stage rides this row. "Venom - Spring 2027" (Bluesky ' +
      '3mxm5ioefd22t); the roster image reads "SPRING 2027 / VENOM & KLYNTAR STAGE". The ' +
      'ordinal is INFERRED by window match, not stated: Steam milestones 49216 "Year 1 ' +
      'character 3 (Apr-Jun 2027)" and 49651 "Year 1 Stage (Apr-Jun 2027)" are the only slots ' +
      "in that quarter. Fires at window open. CONFIRM the id against Sony's Hero Select when " +
      'he is listed (not yet, 2026-10-15). The stage is not a roster row — it is here so the one ' +
      'announcement that covers both is not half-tracked — and its name is attested only as ' +
      '"KLYNTAR STAGE", in caps on the image; do not title-case it without a second source. ' +
      'HAZARDS BEFORE HE JOINS ROSTER (raw/ measured 2026-10-15): "venom" is in 53 titles and ' +
      'none is him. 25 carry the player handle "LORD VENOM" / "Lorde Venom" (replaysHub, ' +
      'highLevelReplays, fgcReplaysHub; two player pages exist, lord-venom and lorde-venom), ' +
      '10 are Tōkon "Venom vs … ▰ Mod Showcase" uploads that NOT_A_MATCH_RE drops (MOD SHOWCASE), ' +
      '13 are MvC:I AI-exhibition uploads with no Tōkon marker that the game-marker gate drops ' +
      'first (11 "(Hardest AI)", which NOT_A_MATCH_RE would also drop, plus a "(Hardest) AI" and a ' +
      '"(Hardest IA)" that only the gate catches), and 5 are ' +
      "Guilty Gear's " +
      'Venom (other-game). So before the alias goes live, check the matcher against the HANDLE ' +
      'position — parallelLists() classifies a segment by whether its sides resolve, ' +
      '/dev/review-queue refuses a handle that resolves a fighter, and e2e asserts no handle is ' +
      'a fighter name; all three meet LORD VENOM on release day — and against a modded Venom: ' +
      'the mod titles are dropped by their "Mod Showcase" marker, not by the roster, and one ' +
      'without the marker would resolve on both sides.',
  },
  {
    id: 'jubilee',
    releases: '2027-07-01',
    note:
      'Year-1 character #4, the last of the pass. "Jubilee - Summer 2027" (Bluesky ' +
      '3mxm5ioefd22t). The ordinal is INFERRED by window match, not stated: Steam milestone ' +
      '51085 "Year 1 character 4 (Jul-Sep 2027)" is the only slot in that quarter. Fires at ' +
      "window open. CONFIRM the id against Sony's Hero Select when she is listed (not yet, " +
      '2026-10-15). Zero hits for "jubilee" in raw/ today. When she is named and shipped, the ' +
      'Year-1 gate is done.',
  },
];

/** The patch table goes stale silently, so it gets a cadence check.
 *
 *  Ten days, down from 21, because 21 was picked before the game had a cadence
 *  to measure. It now has one: post-launch the vendor has shipped on 08-06,
 *  08-10, 08-21 and 08-28 — gaps of 4, 11 and 7 days. A 21-day threshold cannot
 *  fire until two patches have already been missed, which is what happened.
 *  Ten days lets one ordinary gap pass without noise and still catches the
 *  first miss rather than the second.
 *
 *  This alarm is blunt on purpose and it is not the real check — that is
 *  `npm run data:patch-check`. It earns its place by being the thing that
 *  cannot go blind: it reads only the table's own newest date and the clock,
 *  so no change of the vendor's title format can silence it. It was, in fact,
 *  the only signal that fired when the parser did go blind. */
const STALE_PATCH_DAYS = 10;

const today = (): string => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Everything whose date has now passed. Empty is the happy path. */
export function dueExpiries(
  asOf: string = today(),
  quietThrough: string = CONFIRMED_QUIET_THROUGH,
): Expiry[] {
  const due: Expiry[] = [];

  for (const u of UNRELEASED) {
    if (asOf >= u.releases) {
      due.push({
        kind: 'unreleased-character',
        id: u.id,
        date: u.releases,
        action:
          `${u.id} should now be playable. If it is: add --char-${u.id} to ` +
          `design/handoff/tokens.css (${u.accent ? `the handoff already derived ${u.accent}` : 'accent from Claude Design — never invent one'} ` +
          `— contrast ≥4.5:1 on --color-surface and a hue ≥8–12° off its roster neighbours), ` +
          `add the same hex to accents in app/app.config.ts, add the fighter to ROSTER in ` +
          `scripts/characters.ts, drop this entry from UNRELEASED, then run ` +
          `\`npm run data:characters\` and \`npm run data:art\`. If it has NOT shipped, re-date ` +
          `this row to the new window — do not delete it.`,
      });
    }
  }

  for (const s of SEASONS) {
    if (!s.confirmed && asOf >= s.start) {
      due.push({
        kind: 'unconfirmed-season',
        id: `S${s.season}`,
        date: s.start,
        action:
          `Season ${s.season} was scheduled for ${s.start} and is still unconfirmed. Verify the ` +
          `balance patch landed, add its opening patch to PATCHES in scripts/patches.ts (the ` +
          `token is the vendor's own publication DATE — this vendor publishes no version ` +
          `string; \`npm run data:patch-check\` will name it), set confirmed: true, and re-run ` +
          `\`npm run data:emit\`.`,
      });
    }
  }

  // The cadence check. Two patches shipped in this game's first five days, and
  // a patch missing from the table does not fail — it silently files every
  // replay since under the previous token, which renders, filters and passes
  // every count assertion while being wrong.
  //
  // Counted from the later of the newest patch and the last confirmed-quiet
  // feed read (CONFIRMED_QUIET_THROUGH in scripts/patches.ts). A quiet date that
  // is malformed or in the future is IGNORED rather than trusted: its age would
  // be NaN or negative, both compare false against the threshold, and the alarm
  // would never fire again.
  const newest = PATCHES.at(-1);
  const quiet =
    /^\d{4}-\d{2}-\d{2}$/.test(quietThrough) && quietThrough <= asOf ? quietThrough : '';
  const since = newest && quiet > newest.start ? quiet : newest?.start;
  if (newest && since && daysBetween(since, asOf) > STALE_PATCH_DAYS) {
    const age = daysBetween(since, asOf);
    due.push({
      kind: 'stale-patch-table',
      id: 'patch-table',
      date: since,
      action:
        (since === newest.start
          ? `The newest patch in scripts/patches.ts is ${newest.version}, ${age} days old. `
          : `The newest patch in scripts/patches.ts is ${newest.version}, and the feed was last ` +
            `confirmed quiet ${since}, ${age} days ago. `) +
        `Run \`npm run data:patch-check\` against the vendor's news feed. If a patch shipped and ` +
        `is not in the table, every replay since is filed under the previous token — silently ` +
        `wrong. If genuinely nothing shipped, run it as \`npm run data:patch-check -- ` +
        `--confirm-quiet\` and commit scripts/patches.ts: that records today and quiets this ` +
        `alarm for ${STALE_PATCH_DAYS} days.`,
    });
  }

  return due;
}

/** Rendered into data/report.md by parse.ts when anything is due. */
export function expiryBlock(due: Expiry[]): string[] {
  if (!due.length) return [];
  return [
    '## ⚠ ACTION REQUIRED',
    '',
    `${due.length} self-expiring gate(s) are due:`,
    '',
    ...due.flatMap((d) => [`- **${d.id}** (${d.kind}, due ${d.date})`, `  ${d.action}`, '']),
  ];
}

// ── standalone `--check` ─────────────────────────────────────────────────────
// The "Pending work" workflow's step. It runs after the data run has completed
// (pushed, or held), so a red run never costs a refresh — it only makes the
// pending work impossible to ignore.
const isMain = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain && process.argv.includes('--check')) {
  const due = dueExpiries();
  if (!due.length) {
    console.log(
      `✓ no expiries due — ${UNRELEASED.length} unreleased row(s) pending, ` +
        `newest patch ${PATCHES.at(-1)?.version}` +
        (CONFIRMED_QUIET_THROUGH > (PATCHES.at(-1)?.start ?? '')
          ? `, feed confirmed quiet ${CONFIRMED_QUIET_THROUGH}`
          : ''),
    );
    process.exit(0);
  }
  console.error(`\n✖ ${due.length} EXPIRY(S) DUE — this step is designed to go red.\n`);
  for (const d of due) {
    console.error(`  ${d.id}  (${d.kind}, due ${d.date})`);
    console.error(`    ${d.action}\n`);
  }
  console.error('  Clear these by doing the work above. Never by deleting the check.');
  process.exit(1);
}
