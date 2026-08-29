/**
 * Cross-channel duplicate AUDIT. Read-only: nothing here edits data/.
 *
 * Six channels re-upload from the same public pool, so the same match can
 * appear more than once. One pair is already confirmed in the launch corpus —
 * the same Roda vs Snake Eyez set on two channels the same day. (The seventh,
 * marvelTokonYT, is events-only: nothing else here carries CEO or EVO footage
 * today, so it has no overlap to lose — but it is ranked last in CHANNELS
 * precisely so that it loses if one ever appears.)
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
// The two exclusions are counted SEPARATELY because they have opposite causes
// and opposite cures. A thin side is missing information and fills in over
// time; a record with no duration has the strongest signature in the archive
// and will never gain a length, because its source does not publish one.
// Rolling them together is not a rounding error — it printed "a side with <2
// known characters" over records carrying four a side, which is the reverse of
// true and is exactly the line a reader trusts to know what was not checked.
const noDuration = new Set(videos.filter((v) => v.durationSec <= 0).map((v) => v.id));
const thinOnly = videos.filter(
  (v) => !noDuration.has(v.id) && !v.sides.every((s) => s.characters.length >= KEYABLE_MIN),
).length;
if (thinOnly) {
  console.log(
    `  ⓘ ${thinOnly} record(s) excluded as unkeyable (a side with <${KEYABLE_MIN} known characters).\n` +
      `    Coverage rises as sides fill in.`,
  );
}
if (noDuration.size) {
  console.log(
    `  ⓘ ${noDuration.size} record(s) excluded for having NO DURATION — see the third pass below.\n` +
      `    These are not thin: an index intake publishes four fighters a side and no length.`,
  );
}
console.log(
  `    This audit adjudicates ${((keyable.length / videos.length) * 100).toFixed(0)}% of the archive today.\n`,
);

/**
 * ── SECOND PASS: THE THIN-SIDE AUDIT ─────────────────────────────────────────
 *
 * The signature above needs ≥2 known characters a side, and that is a real
 * blind spot rather than a conservative one. A channel whose titles state ONE
 * character per side and whose descriptions carry no bench contributes records
 * that are unkeyable at intake and stay unkeyable until a human or the
 * extractor drains them — which is to say, exactly when a duplicate would be
 * cheapest to catch, the audit cannot see it. marvelTokonYT is that channel:
 * every one of its titles states one fighter a side.
 *
 * So drop the character component and lean on the pair that is always known:
 * WHO PLAYED, plus duration as the independent signal the pass above already
 * trusts. Measured across the 384-record corpus at the time this was written:
 * 2 collisions total, 0 of them cross-channel. That is a low enough false-pair
 * rate to print without burying the real findings — the thing that made
 * KEYABLE_MIN necessary in the first place was character-less signatures
 * matching the roster, and a player PAIR does not have that failure mode.
 *
 * Reported separately, and second, because it IS a weaker hypothesis than the
 * pass above: two players who meet often can play two sets that happen to land
 * within a second of each other. Same rule as everything else here — it prints
 * candidates, a person watches the footage, nothing drops automatically.
 *
 * Runs over EVERY record, not only the thin ones, then reports a pair only when
 * at least one side of it is thin. That is what catches the cross-tier case —
 * a 1-of-4 record from one channel against a filled-in 4-of-4 record of the
 * same match from another — which no character signature can ever match,
 * because the two disagree about the characters by construction.
 */
const thinIds = new Set(videos.filter((v) => !keyable.includes(v)).map((v) => v.id));
const alreadyPaired = new Set(pairs.map((p) => p.drop.id));

const byPlayers = new Map<string, MatchVideo[]>();
for (const v of videos) {
  if (v.durationSec <= 0) continue;
  const k = v.sides
    .map((s) => s.player)
    .sort()
    .join('~');
  byPlayers.set(k, [...(byPlayers.get(k) ?? []), v]);
}

const thinPairs: Pair[] = [];
for (const list of byPlayers.values()) {
  if (list.length < 2) continue;
  const sorted = [...list].sort((a, b) => a.durationSec - b.durationSec);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const delta = b.durationSec - a.durationSec;
    if (delta > 1) continue;
    if (a.intake === b.intake) continue;
    if (!thinIds.has(a.id) && !thinIds.has(b.id)) continue; // pass one's job
    const [keep, drop] =
      (priority.get(a.intake) ?? 99) <= (priority.get(b.intake) ?? 99) ? [a, b] : [b, a];
    if (alreadyPaired.has(drop.id)) continue;
    thinPairs.push({ keep, drop, deltaSec: delta });
  }
}

const show = (p: Pair) => {
  console.log(`  ${p.keep.id} (${p.keep.intake})  ⟵ keep`);
  console.log(`  ${p.drop.id} (${p.drop.intake})  ⟵ candidate, Δ${p.deltaSec}s`);
  console.log(`     ${p.keep.title.slice(0, 88)}`);
  console.log(`     ${p.drop.title.slice(0, 88)}\n`);
};

if (pairs.length) {
  for (const p of pairs) show(p);
} else {
  console.log(
    `✓ no cross-channel duplicate candidates among the ${keyable.length} keyable records\n`,
  );
}

console.log(
  `Thin-side pass — ${thinIds.size} record(s) below ${KEYABLE_MIN} chars/side, ` +
    `keyed on players + duration only: ${thinPairs.length} candidate(s)\n`,
);
for (const p of thinPairs) show(p);

/**
 * ── THIRD PASS: NO-DURATION RECORDS, REPORTED AND NEVER ADJUDICATED ──────────
 *
 * Both passes above gate on `durationSec > 0`, because duration is the
 * INDEPENDENT signal: two different matches between the same players on the
 * same teams almost never land within a second of each other. An INDEX source
 * publishes no per-match duration — the catalogue records a (videoId,
 * startSeconds) pair and says nothing about length, and the gap to the next set
 * includes the downtime between them — so every one of its records is invisible
 * to both. Invisible in the worst possible way: those are the records with the
 * STRONGEST signature here, four fighters on both sides against a corpus mean
 * of 3.7.
 *
 * Duration is replaced by the only other independent signal available: the
 * PUBLISH DAY. Two sources covering one tournament upload it the same day; a
 * rematch weeks later does not. That is weaker, and the difference is the whole
 * reason this section exists separately.
 *
 * IT PROPOSES NOTHING AND PRINTS NO OVERRIDES FRAGMENT, which is what separates
 * it from the two passes above. A drop needs the independent signal; a shared
 * publish day is corroboration, not proof. This section names what the audit
 * CANNOT decide, so that "0 candidates" upstairs keeps meaning what it says.
 */
const byPlayersAll = new Map<string, MatchVideo[]>();
for (const v of videos) {
  const k = v.sides
    .map((s) => s.player)
    .sort()
    .join('~');
  byPlayersAll.set(k, [...(byPlayersAll.get(k) ?? []), v]);
}
const unadjudicated: { a: MatchVideo; b: MatchVideo; sameDay: boolean }[] = [];
for (const list of byPlayersAll.values()) {
  if (list.length < 2) continue;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (a.intake === b.intake) continue; // not a cross-post
      if (!noDuration.has(a.id) && !noDuration.has(b.id)) continue; // passes 1-2 own these
      unadjudicated.push({
        a,
        b,
        sameDay: a.publishedAt.slice(0, 10) === b.publishedAt.slice(0, 10),
      });
    }
  }
}
if (noDuration.size) {
  const sameDay = unadjudicated.filter((u) => u.sameDay).length;
  console.log(
    `No-duration pass — ${noDuration.size} record(s) with no length to compare, keyed on ` +
      `players only: ${unadjudicated.length} cross-intake pair(s), ${sameDay} of them same-day.\n` +
      `  REPORTED, NEVER ADJUDICATED — no drop is proposed for any of these.\n`,
  );
  for (const u of [...unadjudicated].sort((x, y) => Number(y.sameDay) - Number(x.sameDay))) {
    console.log(`  ${u.sameDay ? '⚠ same day' : '· different days'}`);
    for (const r of [u.a, u.b]) {
      console.log(
        `    ${r.id} (${r.intake}) ${r.publishedAt.slice(0, 10)} ${r.durationSec || '—'}s`,
      );
      console.log(`       ${r.title.slice(0, 88)}`);
    }
    console.log('');
  }
}

const all = [...pairs, ...thinPairs];
if (!all.length) process.exit(0);

console.log('─'.repeat(72));
console.log('CANDIDATES ONLY — nothing has been changed. A signature is a hypothesis:');
console.log('on a sibling game 118 of 196 proposed drops were different matches. Watch');
console.log('the footage, then paste what survives into data/overrides.json:\n');
console.log(
  JSON.stringify(
    Object.fromEntries(
      all.map((p) => [
        p.drop.id,
        { exclude: true, '//': `dupe of ${p.keep.id} (${p.keep.intake})` },
      ]),
    ),
    null,
    2,
  ),
);
