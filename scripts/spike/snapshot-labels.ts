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

/** Both label files, each snapshotted beside the other. `labels.json` holds the
 *  bench readings (four fighters per side, from the corner icons);
 *  `plate-labels.json` holds the per-frame nameplate readings. They are
 *  different observations of different things and neither is derivable from the
 *  other, so both are protected. */
const FILES = [
  { data: join(ROOT, 'data/labels.json'), snap: join(CACHE, 'ground-truth.json') },
  { data: join(ROOT, 'data/plate-labels.json'), snap: join(CACHE, 'ground-truth-plates.json') },
];

const checkOnly = process.argv.includes('--check');
const restore = process.argv.includes('--restore');

const read = (p: string): Record<string, unknown> =>
  existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : {};

/** Identity of one label, order-insensitive INSIDE each list but not across
 *  fields. A bench of [ed, elena] and [elena, ed] is the same claim, because the
 *  stored order is presentational and only the SET is asserted. Everything else
 *  — which plate, which side — is a distinct observation and part of the
 *  identity. Sorting the JSON keys gives both properties without the shape of
 *  either label file being hard-coded here, so a new field cannot silently fall
 *  outside the comparison. */
const key = (l: unknown): string =>
  JSON.stringify(l, (_k, v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === 'string')
      ? [...(v as string[])].sort()
      : v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([k2]) => k2 !== 'at')
              .sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
  );

const write = (p: string, v: unknown, indent: number) =>
  writeFileSync(p, `${JSON.stringify(v, null, indent)}\n`, 'utf8');

let anyStale = false;
for (const { data, snap } of FILES) {
  const name = data.split('/').slice(-2).join('/');
  const labels = read(data);
  const snapshot = read(snap);

  if (restore) {
    // Iterates the SNAPSHOT, so it can never invent an id the snapshot does not
    // know, and skips no-ops so an unchanged entry does not churn the file.
    let put = 0;
    for (const [id, l] of Object.entries(snapshot)) {
      if (labels[id] && key(labels[id]) === key(l)) continue;
      labels[id] = l;
      put++;
    }
    if (put) write(data, labels, 2);
    console.log(`\u2714 ${name}: restored ${put} (${Object.keys(snapshot).length} in snapshot)`);
    continue;
  }

  const fresh: string[] = [];
  const changed: string[] = [];
  for (const [id, l] of Object.entries(labels)) {
    const prev = snapshot[id];
    if (prev === undefined) fresh.push(id);
    else if (key(prev) !== key(l)) changed.push(id);
    else continue;
    snapshot[id] = l;
  }

  console.log(
    `${name}: ${Object.keys(snapshot).length} labelled \u00b7 +${fresh.length} new \u00b7 ${changed.length} revised`,
  );

  if (checkOnly) {
    if (fresh.length || changed.length) {
      anyStale = true;
      console.error(
        `\u2716 unsnapshotted labels in ${name} \u2014 run without --check\n` +
          `  new: ${fresh.join(', ') || '\u2014'}\n  revised: ${changed.join(', ') || '\u2014'}`,
      );
    }
    continue;
  }

  mkdirSync(CACHE, { recursive: true });
  write(snap, snapshot, 1);
  if (fresh.length) console.log(`  new: ${fresh.join(', ')}`);
}

if (checkOnly) {
  if (anyStale) process.exit(1);
  console.log('\u2714 snapshots are current');
}
