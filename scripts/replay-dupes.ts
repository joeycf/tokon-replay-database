/**
 * Cross-channel duplicate AUDIT. Read-only: nothing here edits data/.
 *
 * Five channels re-upload from the same public pool, so the same match can
 * appear more than once. One pair is already confirmed in the launch corpus —
 * the same Roda vs Snake Eyez set on two channels the same day.
 *
 * IT NEVER DROPS ANYTHING, AND THAT IS THE DESIGN. A dedupe signature is a
 * HYPOTHESIS about footage identity, not a fact about it: on a sibling game,
 * 118 of 196 signature-proposed drops turned out to be genuinely different
 * matches. The daily cron is unattended, and a fuzzy matcher that silently
 * deletes a committed record is the exact failure class this platform must not
 * build. So the report prints a paste-ready overrides.json fragment and a human
 * approves it.
 *
 * Run: npm run data:replay-dupes
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNELS } from './channels';
import type { MatchVideo } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Side-agnostic players+characters key.
 *
 * MUST STAY SEMANTICALLY IDENTICAL to the copy inside scripts/e2e.ts — if the
 * two drift, the gate stops checking what this scanner finds.
 *
 * Characters are SORTED into the key rather than left in first-appearance
 * order, because two uploads of the same set can sample it differently and
 * disagree about who appeared first. At 4v4 that matters more than it does for
 * a 1v1 game: a side's four fighters can legitimately arrive in any order, and
 * the bench tier fills them in from prose that has its own ordering.
 *
 * Sides are sorted too, so a channel that lists the players the other way round
 * still collides.
 */
const signature = (v: MatchVideo): string =>
  v.sides
    .map((s) => `${s.player}|${[...s.characters].sort().join(',')}`)
    .sort()
    .join('~');

/** Records whose known characters are too thin to key on. A 1-of-4 side shares
 *  its signature with every other match those two players ever played, so
 *  including them would report the roster rather than the duplicates. */
const KEYABLE_MIN = 2;

const videos = JSON.parse(await readFile(join(ROOT, 'data/videos.json'), 'utf8')) as MatchVideo[];
const priority = new Map(CHANNELS.map((c, i) => [c.id, i]));

const keyable = videos.filter(
  (v) => v.durationSec > 0 && v.sides.every((s) => s.characters.length >= KEYABLE_MIN),
);
const bySig = new Map<string, MatchVideo[]>();
for (const v of keyable) {
  const k = signature(v);
  bySig.set(k, [...(bySig.get(k) ?? []), v]);
}

interface Pair {
  keep: MatchVideo;
  drop: MatchVideo;
  deltaSec: number;
}
const pairs: Pair[] = [];
for (const list of bySig.values()) {
  if (list.length < 2) continue;
  const sorted = [...list].sort((a, b) => a.durationSec - b.durationSec);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const delta = b.durationSec - a.durationSec;
    // Same signature AND near-identical runtime. Duration is the independent
    // signal: two different matches between the same players on the same teams
    // almost never land within a second of each other.
    if (delta > 1) continue;
    if (a.intake === b.intake) continue; // same channel: not a cross-post
    const [keep, drop] =
      (priority.get(a.intake) ?? 99) <= (priority.get(b.intake) ?? 99) ? [a, b] : [b, a];
    pairs.push({ keep, drop, deltaSec: delta });
  }
}

console.log(
  `Dupe audit — ${videos.length} records, ${keyable.length} keyable (≥${KEYABLE_MIN} chars/side)`,
);
console.log(
  `  ${bySig.size} distinct signatures · ${pairs.length} candidate cross-channel pair(s)\n`,
);

// Say what was NOT checked. "0 candidates" reads as "no duplicates exist",
// and right now it mostly means "most sides are too thin to key on" — a
// 1-of-4 side shares its signature with every match those two players played,
// so those records are excluded rather than guessed at. The audit's reach
// grows as the bench tier and the extractor fill sides in; until then this
// number is a floor, not a finding.
const unkeyable = videos.length - keyable.length;
if (unkeyable) {
  console.log(
    `  ⓘ ${unkeyable} record(s) excluded as unkeyable (a side with <${KEYABLE_MIN} known characters).\n` +
      `    This audit sees ${((keyable.length / videos.length) * 100).toFixed(0)}% of the archive today; ` +
      `coverage rises as sides fill in.\n`,
  );
}

if (!pairs.length) {
  console.log(
    `✓ no cross-channel duplicate candidates among the ${keyable.length} keyable records`,
  );
  process.exit(0);
}

for (const p of pairs) {
  console.log(`  ${p.keep.id} (${p.keep.intake})  ⟵ keep`);
  console.log(`  ${p.drop.id} (${p.drop.intake})  ⟵ candidate, Δ${p.deltaSec}s`);
  console.log(`     ${p.keep.title.slice(0, 88)}`);
  console.log(`     ${p.drop.title.slice(0, 88)}\n`);
}

console.log('─'.repeat(72));
console.log('CANDIDATES ONLY — nothing has been changed. A signature is a hypothesis:');
console.log('on a sibling game 118 of 196 proposed drops were different matches. Watch');
console.log('the footage, then paste what survives into data/overrides.json:\n');
console.log(
  JSON.stringify(
    Object.fromEntries(
      pairs.map((p) => [
        p.drop.id,
        { exclude: true, '//': `dupe of ${p.keep.id} (${p.keep.intake})` },
      ]),
    ),
    null,
    2,
  ),
);
