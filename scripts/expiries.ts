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
 *   .github/workflows/…    (daily cron)         → a FINAL step, AFTER commit and
 *                                                 push, that exits 1
 *
 * A hard exit in parse.ts would fail `npm run data:build` and stop the daily
 * refresh entirely, which is strictly worse than the misfiling it warns about:
 * a day of stale data costs more than a day of a fighter filed under the wrong
 * accent. So the daily path stays soft, the data gets pushed, and the WORKFLOW
 * goes red afterwards so the pending work is impossible to miss.
 *
 * THE RED WORKFLOW AND THE exit 1 ARE THE DESIGN, NOT A BUG. Clear them by
 * doing the work below — never by deleting the check.
 *
 * Second-order property worth preserving: report.md's commit guard drops the
 * file when the only diff is its "_Generated_" timestamp. An ACTION REQUIRED
 * block is real content, so the day it first appears the guard lets it through
 * and the signal reaches git — and the deployed site — even on a no-change day.
 *
 * Run: npm run data:expiries   (tsx scripts/expiries.ts --check)
 */

import { PATCHES, SEASONS } from './patches';
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
    releases: '2026-10-01',
    // Already derived — the design handoff's own worked DLC example carries it
    // at 7.4:1, so release day is a one-line change rather than a design task.
    accent: '#FF9D57',
    note:
      'Year-1 character #1. Announced "this Fall" with a published Oct–Dec 2026 window and no ' +
      'hard date, so this row fires at WINDOW OPEN. If the window slips, re-date the row — ' +
      'do not delete it.',
  },
  {
    id: 'year1-remainder',
    releases: '2027-12-31',
    note:
      'Year-1 characters 2/3/4 and the Year-1 stage, all committed to "by 31 December 2027" ' +
      'and none of them announced. Split into real rows as each is named.',
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
export function dueExpiries(asOf: string = today()): Expiry[] {
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
  const newest = PATCHES.at(-1);
  if (newest && daysBetween(newest.start, asOf) > STALE_PATCH_DAYS) {
    due.push({
      kind: 'stale-patch-table',
      id: 'patch-table',
      date: newest.start,
      action:
        `The newest patch in scripts/patches.ts is ${newest.version}, ${daysBetween(newest.start, asOf)} days old. ` +
        `Run \`npm run data:patch-check\` against the vendor's news feed. If a patch shipped and ` +
        `is not in the table, every replay since is filed under the previous token — silently ` +
        `wrong. If genuinely nothing shipped, that is fine: this warning costs one command.`,
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
// The workflow's LAST step. It runs after the data has been committed and
// pushed, so a red run never costs a refresh — it only makes the pending work
// impossible to ignore.
const isMain = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain && process.argv.includes('--check')) {
  const due = dueExpiries();
  if (!due.length) {
    console.log(
      `✓ no expiries due — ${UNRELEASED.length} unreleased row(s) pending, ` +
        `newest patch ${PATCHES.at(-1)?.version}`,
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
