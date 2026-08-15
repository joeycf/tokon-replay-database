/**
 * Preserve hand-labelled ground truth out of harm's way.
 *
 * Labels are the most expensive artifact this project produces — a human watched
 * footage for every row — and they sit in exactly one file, `data/labels.json`,
 * which git tracks. Two ways to lose them, and each is guarded by the other's
 * home:
 *
 *   1. `git restore data/labels.json` erases a whole labelling session with no
 *      warning and no diff to notice. The snapshot lives in cache/, outside
 *      git's reach, so it survives.
 *   2. `rm -rf cache/` is the normal way to reclaim the 3.6 GB of frames, and it
 *      takes the snapshot with it. The committed file survives that.
 *
 * This session earned the guard the hard way: a `git add -A` swept an unrelated
 * in-progress edit into a commit, and the file it hit was the one nobody was
 * watching.
 *
 * MERGES, NEVER REPLACES, in both directions, so a label written by one route
 * cannot silently delete one written by the other.
 *
 * Run: npx tsx scripts/spike/snapshot-labels.ts            # capture
 *      npx tsx scripts/spike/snapshot-labels.ts --check    # exit 1 if uncaptured
 *      npx tsx scripts/spike/snapshot-labels.ts --restore  # put them back
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHE } from '../hud-frames';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LABELS = join(ROOT, 'data/labels.json');
const SNAPSHOT = join(CACHE, 'ground-truth.json');

const checkOnly = process.argv.includes('--check');
const restore = process.argv.includes('--restore');

interface Label {
  point: [string[], string[]];
  bench: [string[], string[]];
  leftIsFirst: boolean | null;
  at: string;
}

const read = (p: string): Record<string, Label> =>
  existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, Label>) : {};

/** Identity of a label, order-insensitive within each list: [ed, elena] and
 *  [elena, ed] are the same claim, because the stored order is presentational
 *  and only the SET is being asserted. `leftIsFirst` IS part of the identity —
 *  it is a separate observation about screen position, not presentation. */
const key = (l: Label): string =>
  [
    l.bench.map((s) => [...s].sort().join('+')).join('|'),
    l.point.map((s) => [...s].sort().join('+')).join('|'),
    String(l.leftIsFirst),
  ].join(' :: ');

const write = (p: string, v: unknown, indent: number) =>
  writeFileSync(p, `${JSON.stringify(v, null, indent)}\n`, 'utf8');

const labels = read(LABELS);
const snapshot = read(SNAPSHOT);

if (restore) {
  // Iterates the SNAPSHOT, so it can never invent an id the snapshot does not
  // know, and skips no-ops so an unchanged entry does not churn the file.
  let put = 0;
  for (const [id, l] of Object.entries(snapshot)) {
    if (labels[id] && key(labels[id]!) === key(l)) continue;
    labels[id] = { ...labels[id], ...l };
    put++;
  }
  if (put) write(LABELS, labels, 2);
  console.log(
    `✔ restored ${put} label(s) into data/labels.json (${Object.keys(snapshot).length} in snapshot)`,
  );
  process.exit(0);
}

const fresh: string[] = [];
const changed: string[] = [];
for (const [id, l] of Object.entries(labels)) {
  const prev = snapshot[id];
  if (!prev) fresh.push(id);
  else if (key(prev) !== key(l)) changed.push(id);
  else continue;
  snapshot[id] = l;
}

console.log(
  `ground truth: ${Object.keys(snapshot).length} labelled · +${fresh.length} new · ${changed.length} revised`,
);

if (checkOnly) {
  if (fresh.length || changed.length) {
    console.error(
      '✖ unsnapshotted labels in data/labels.json — run without --check\n' +
        `  new: ${fresh.join(', ') || '—'}\n  revised: ${changed.join(', ') || '—'}`,
    );
    process.exit(1);
  }
  console.log('✔ snapshot is current');
  process.exit(0);
}

mkdirSync(CACHE, { recursive: true });
write(SNAPSHOT, snapshot, 1);
console.log(`✔ ${SNAPSHOT}`);
if (fresh.length) console.log(`  new: ${fresh.join(', ')}`);
