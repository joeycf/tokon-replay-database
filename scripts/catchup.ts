/**
 * THE MAINTENANCE RITUAL, AS ONE COMMAND.
 *
 * Run: npm run data:catchup [-- --no-extract] [-- --limit N] [-- --dry]
 *
 * WHY THIS EXISTS. Keeping this corpus honest takes four steps in a fixed order,
 * and between 2026-08-20 and 2026-08-24 the last two were simply not run. Nobody
 * decided to skip them; there was no single thing to run, so the site drifted
 * from 85.7% complete sides to 70.8% and the first symptom anyone saw was a lone
 * fighter badge on a 4v4 match.
 *
 * THE ORDER IS THE POINT, NOT THE CONVENIENCE. `raw/` is gitignored, so it is
 * local and the daily cron never writes it. That means a local `raw/` is
 * routinely OLDER than the committed `data/` the cron produced in CI — measured
 * at 5 records behind on 2026-08-24 — and running `data:parse` on its own
 * silently DELETES every record the local dump cannot reproduce. The collapse
 * guard does not catch it: it needs >10% AND >20 records from one channel, and
 * this arrives as one or two records spread across four. Pairing fetch with
 * parse in one command is what makes that unhittable by accident.
 *
 * WHAT IT PUBLISHES, AND WHY THAT CHANGED. Extraction now writes what its gate
 * accepts. It used to run `--dry` unconditionally on the argument that the reader
 * "closes a side outright only 15.9% of the time" — but 15.9% is side-exact, a
 * COMPLETENESS number, and it was being used to argue about TRUST. The precision
 * measurements say the opposite: 125/125 on blind human plate labels, 136/136
 * machine unions a subset of the human union with zero invented members, and every
 * one of 143 machine-asserted members that a person independently picked was
 * confirmed. Meanwhile the two-frame human reading of the same side agrees with
 * itself 66.3% of the time. The reader is ~100% precise and ~16% complete, and
 * only the first of those is an argument about publishing.
 *
 * So the gate publishes, and a person's verdict still outranks it: a side carrying
 * `fromHuman` is never restamped, and `/dev/bench-review` replaces a footage side
 * wholesale whenever someone reads it. `--dry` still suppresses all writing for a
 * pass run alongside a labelling session, which is the race it was really for.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BenchQueueItem, MatchVideo, ReviewQueueItem } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const argv = process.argv.slice(2);
const NO_EXTRACT = argv.includes('--no-extract');
const DRY = argv.includes('--dry');
const LIMIT = argv[argv.indexOf('--limit') + 1];

/** Roughly what one video costs end to end — download, frame grab, OCR. Measured
 *  across the 08-18/08-20 passes; used only to print an ETA before a long run. */
const MINUTES_PER_VIDEO = 5;

const read = <T>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;

function step(label: string, cmd: string, args: string[]): void {
  console.log(`\n\x1b[1m── ${label}\x1b[0m`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${r.status ?? 'signal'}) — stopping here.`);
    console.error('  Nothing downstream ran, so data/ is whatever the last good step left.');
    process.exit(r.status ?? 1);
  }
}

// ── 1 + 2: fetch THEN parse, always together ────────────────────────────────
step('fetch — refresh raw/ from YouTube', 'npm', ['run', 'data:fetch']);
step('parse — rebuild the substrate and the queues', 'npm', ['run', 'data:parse']);

// ── 3: read footage for anything new, publishing what the gate accepts ──────
const queue = read<BenchQueueItem[]>('bench-queue.json');
const storePath = join(ROOT, 'cache', 'tokon', 'extracted.json');
const persisted = existsSync(storePath)
  ? (JSON.parse(readFileSync(storePath, 'utf8')) as Record<string, { geom?: unknown }>)
  : {};
const uncached = queue.filter((q) => !persisted[q.id]?.geom);

if (NO_EXTRACT) {
  console.log(
    `\n── extract — SKIPPED (--no-extract); ${uncached.length} record(s) have no read yet`,
  );
} else if (uncached.length === 0) {
  console.log('\n── extract — nothing to do: every queued record already has a read');
} else {
  const eta =
    ((LIMIT ? Math.min(Number(LIMIT), uncached.length) : uncached.length) * MINUTES_PER_VIDEO) / 60;
  console.log(
    `\n── extract — ${uncached.length} record(s) with no read` +
      `${LIMIT ? ` (limited to ${LIMIT})` : ''}, about ${eta.toFixed(1)}h at ~${MINUTES_PER_VIDEO} min each.`,
  );
  console.log('   Local-only and resumable. Ctrl-C is safe: each video flushes as it finishes.');
  step(
    DRY
      ? 'extract — read the HUD, persist reads, publish nothing'
      : 'extract — read the HUD, publish what the gate accepts',
    'npm',
    [
      'run',
      'data:extract',
      '--',
      // PASSED THROUGH, NOT HARD-CODED. A pass run alongside a labelling session
      // still needs to keep its hands off overrides.json — both writers rewrite the
      // whole file, so the loser of that race loses verdicts.
      ...(DRY ? ['--dry'] : []),
      '--uncached',
      ...(LIMIT ? ['--limit', LIMIT] : []),
    ],
  );
}

// ── 4: say exactly what is left, and what only a person can do ──────────────
const videos = read<MatchVideo[]>('videos.json');
const review = read<ReviewQueueItem[]>('review-queue.json');
const sides = videos.flatMap((v) => v.sides);
const short = sides.filter((s) => s.characters.length < 4);
// COMPLETE IS `>= 4`, MATCHING report.md — an oversize side (a mid-set team
// change) is complete data, not a defect, and it is excluded from pairing
// surfaces rather than from this count. Counting `=== 4` here instead would
// print 495 beside the report's 501 and make two artifacts about the same
// corpus disagree by six.
const complete = sides.length - short.length;

const after = read<BenchQueueItem[]>('bench-queue.json');
const stillUnread = after.filter(
  (q) =>
    !(
      existsSync(storePath) &&
      (JSON.parse(readFileSync(storePath, 'utf8')) as Record<string, { geom?: unknown }>)[q.id]
        ?.geom
    ),
).length;

const oldest = after.length
  ? Math.max(...after.map((q) => Math.floor((Date.now() - Date.parse(q.publishedAt)) / 86_400_000)))
  : 0;

console.log('\n\x1b[1m════ what still needs you ════\x1b[0m');
console.log(`  corpus          ${videos.length} records · ${sides.length} sides`);
console.log(
  `  complete (4/4)  ${complete}/${sides.length} (${((complete / sides.length) * 100).toFixed(1)}%)`,
);
console.log(
  `  sides short     ${short.length} across ${after.length} record(s), oldest ${oldest} day(s) old`,
);
if (stillUnread)
  console.log(`  no read yet     ${stillUnread} record(s) — re-run to continue the drain`);
if (review.length)
  console.log(`  review queue    ${review.length} record(s) — NEVER published, needs a verdict`);
console.log('');
if (short.length) {
  console.log('  → npm run dev, then /dev/bench-review');
  console.log('    The reader supplies the point fighter and a candidate order; the bench');
  console.log('    is yours to read off the portrait cluster. What is left here is what the');
  console.log('    footage gate would not take — a nameplate only ever names who is on point.');
} else {
  console.log('  → nothing. Every side is complete. 🎉');
}
console.log('');
