/**
 * STEP 6 — score the reader against the free ground truth, before any human
 * spends an hour labelling.
 *
 * THE GROUND TRUTH COSTS NOTHING AND EXISTS TODAY. Forty records already carry
 * both sides at four fighters, parsed from prose descriptions independently of
 * any pixel: 33 from highLevelReplays and 7 from proReplays. That is 80 sides of
 * labels the extractor has never seen.
 *
 * WHAT IT CAN AND CANNOT SETTLE. It shares any systematic error in the
 * description parser, so it is not a substitute for blind human labels. But it
 * can validate side attribution, which an earlier note said it could not: a
 * description states handle→bench without reference to screen position, and the
 * two benches in a record are never identical (75% share at least one fighter,
 * mean 1.20 — never all four), so matching a screen side's whole union against
 * the two known benches decides orientation. Weaker than a human label, free,
 * and it sizes how much human labelling is actually needed.
 *
 * THREE NUMBERS, NOT ONE. For bench completion the failure modes are not
 * symmetric — a precise but incomplete read ADVANCES the queue and is worth
 * shipping, an imprecise one poisons a record. So:
 *
 *   precision  every member read is genuinely on that side's bench   ← gates auto-accept
 *   recall     how much of the four-fighter bench was found          ← drives `complete`
 *   exact      union === bench                                       ← the strict headline
 *
 * Run: npx tsx scripts/spike/accuracy.ts            # read (downloads) and score
 *      npx tsx scripts/spike/accuracy.ts --refold   # re-score persisted reads only
 *      npx tsx scripts/spike/accuracy.ts --limit N
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorker } from 'tesseract.js';

import { readVideo, type VideoRead } from '../extract';
import { CACHE } from '../hud-frames';
import {
  AUTO_ACCEPT,
  foldSide,
  resolveSide,
  titleOk,
  WHITELIST,
  type FrameRead,
} from '../hud-read';
import { buildPlateRoster, loadCharacters } from '../roster';
import type { MatchVideo } from '../../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const REFOLD = argv.includes('--refold');
/** Re-OCR every video even if it is already in the store. Needed whenever the
 *  GEOMETRY changes — `--refold` only re-runs the fold over reads that were
 *  taken through the old crop, which would score the old boxes with the new
 *  arithmetic and report a number that describes neither. */
const REREAD = argv.includes('--reread');
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || Infinity;
const STORE = join(CACHE, 'extracted.json');

const videos = JSON.parse(readFileSync(join(ROOT, 'data/videos.json'), 'utf8')) as MatchVideo[];
const truth = videos
  .filter((v) => v.sides.length === 2 && v.sides.every((s) => s.characters.length === 4))
  .slice(0, LIMIT);

const roster = buildPlateRoster(await loadCharacters());
const setKey = (xs: string[]) => [...new Set(xs)].sort().join(',');

// ── read (or reload) ────────────────────────────────────────────────────────
const stored: Record<string, VideoRead> = existsSync(STORE)
  ? (JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, VideoRead>)
  : {};

if (!REFOLD) {
  const worker = await createWorker('eng', undefined, { logger: () => {} });
  await worker.setParameters({
    tessedit_char_whitelist: WHITELIST,
    tessedit_pageseg_mode: '7' as never,
  });
  console.log(`reading ${truth.length} ground-truth videos\n`);
  for (const [i, v] of truth.entries()) {
    if (!REREAD && stored[v.id]?.hud) {
      console.log(`  [${i + 1}/${truth.length}] ${v.id} — cached (${stored[v.id]!.hud} HUD)`);
      continue;
    }
    const r = await readVideo(worker, v.id, v.durationSec, roster);
    stored[v.id] = r;
    writeFileSync(STORE, JSON.stringify(stored, null, 1));
    console.log(
      `  [${i + 1}/${truth.length}] ${v.id} (${v.intake}) — ${r.hud}/${r.frames} HUD frames`,
    );
  }
  await worker.terminate();
  console.log();
}

// ── score ───────────────────────────────────────────────────────────────────
interface Scored {
  id: string;
  channel: string;
  /** truth benches, in the record's own side order */
  want: [string[], string[]];
  /** the fighter the TITLE named per side — the extractor's anchor */
  titleChars: [string, string];
  gotLeft: string[];
  gotRight: string[];
  confL: number;
  confR: number;
  satL: number;
  satR: number;
  votes: number;
  decided: boolean;
  /** true when the fold's screen-left union belongs to want[0] */
  leftIsFirst: boolean;
  hud: number;
}

const scored: Scored[] = [];
for (const v of truth) {
  const r = stored[v.id];
  if (!r || !r.hud) continue;
  const L = foldSide(r.left as FrameRead[]);
  const R = foldSide(r.right as FrameRead[]);
  const titleChars = v.sides.map((s) => s.provenance.fromTitle[0] ?? '') as [string, string];
  const side = resolveSide(r.left as FrameRead[], r.right as FrameRead[], titleChars);
  scored.push({
    id: v.id,
    channel: v.intake,
    want: [v.sides[0]!.characters, v.sides[1]!.characters],
    titleChars,
    gotLeft: L.characters,
    gotRight: R.characters,
    confL: L.confidence,
    confR: R.confidence,
    satL: L.saturation,
    satR: R.saturation,
    votes: side.votes,
    decided: side.decided,
    leftIsFirst: side.leftIsFirst,
    hud: r.hud,
  });
}

if (!scored.length) {
  console.error('✖ nothing to score — run without --refold first.');
  process.exit(1);
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');

/** Per-side precision/recall against a known bench. */
const pr = (got: string[], want: string[]) => ({
  hit: got.filter((g) => want.includes(g)).length,
  got: got.length,
  want: want.length,
});

/** Attribute the two screen unions to the two record sides.
 *
 *  Uses the extractor's OWN verdict, not a best-fit — scoring against the best
 *  of the two arrangements would grade an attribution the reader never made and
 *  would report a number the pipeline cannot achieve. */
const attributed = (s: Scored): [string[], string[]] =>
  s.leftIsFirst ? [s.gotLeft, s.gotRight] : [s.gotRight, s.gotLeft];

// ── headline, per channel ───────────────────────────────────────────────────
console.log('── reader accuracy, per channel ─────────────────────────────────────\n');
console.log('  channel              recs  sides   precision      recall       exact');
const channels = [...new Set(scored.map((s) => s.channel))];
for (const ch of [...channels, 'ALL']) {
  const rows = ch === 'ALL' ? scored : scored.filter((s) => s.channel === ch);
  let hit = 0;
  let got = 0;
  let want = 0;
  let exact = 0;
  let sides = 0;
  for (const s of rows) {
    const at = attributed(s);
    for (const i of [0, 1] as const) {
      const p = pr(at[i]!, s.want[i]!);
      hit += p.hit;
      got += p.got;
      want += p.want;
      sides++;
      if (setKey(at[i]!) === setKey(s.want[i]!)) exact++;
    }
  }
  console.log(
    `  ${ch.padEnd(20)} ${String(rows.length).padStart(4)}  ${String(sides).padStart(5)}   ` +
      `${pct(hit, got).padStart(9)}   ${pct(hit, want).padStart(9)}   ${pct(exact, sides).padStart(9)}`,
  );
}

// ── both-sides-exact, the strict headline ───────────────────────────────────
const bothExact = scored.filter(
  (s) =>
    setKey(attributed(s)[0]) === setKey(s.want[0]!) &&
    setKey(attributed(s)[1]) === setKey(s.want[1]!),
);
console.log(
  `\n  both-sides-exact: ${bothExact.length}/${scored.length} (${pct(bothExact.length, scored.length)})` +
    ' — one wrong side is a wrong replay, so per-side accuracy flatters this.\n',
);

// ── attribution ─────────────────────────────────────────────────────────────
console.log('── side attribution (anchored on the title-known fighter) ───────────\n');
const dec = scored.filter((s) => s.decided);
// The truth's own orientation: which record side does the screen-LEFT union
// actually belong to? Decided by whole-bench overlap, which the benches' being
// distinct makes unambiguous.
const trueLeftIsFirst = (s: Scored) => {
  const a = pr(s.gotLeft, s.want[0]!).hit + pr(s.gotRight, s.want[1]!).hit;
  const b = pr(s.gotLeft, s.want[1]!).hit + pr(s.gotRight, s.want[0]!).hit;
  return a === b ? null : a > b;
};
const checkable = dec.filter((s) => trueLeftIsFirst(s) !== null);
const rightWay = checkable.filter((s) => s.leftIsFirst === trueLeftIsFirst(s));
console.log(`  decided                 ${dec.length}/${scored.length} (${pct(dec.length, scored.length)})`);
console.log(
  `  checkable against truth ${checkable.length}/${dec.length}  ` +
    `(the rest read too little for the bench overlap to break a tie)`,
);
console.log(`  CORRECT                 ${rightWay.length}/${checkable.length} (${pct(rightWay.length, checkable.length)})`);
const margins = dec.map((s) => Math.abs(s.votes)).sort((a, b) => a - b);
console.log(
  `  |votes| margin          min ${margins[0]} · median ${margins[Math.floor(margins.length / 2)]} · max ${margins[margins.length - 1]}`,
);
const thin = checkable.filter((s) => Math.abs(s.votes) <= 2);
console.log(
  `  margin <= 2             ${thin.length} record(s), ${thin.filter((s) => s.leftIsFirst === trueLeftIsFirst(s)).length} correct` +
    " — decides whether 'votes !== 0' is strict enough\n",
);

// ── the free positive control ───────────────────────────────────────────────
const controlFails = scored.filter((s) => {
  const at = attributed(s);
  return !titleOk(at[0], [s.titleChars[0]!]) || !titleOk(at[1], [s.titleChars[1]!]);
});
console.log('── titleOk, the free per-record positive control ────────────────────\n');
console.log(
  `  records where a union MISSES its own title-named fighter: ${controlFails.length}/${scored.length}` +
    ` (${pct(controlFails.length, scored.length)})`,
);
console.log('  Each is a reader error or an attribution error; either way, review.\n');

// ── completeness and the never-enters tail ──────────────────────────────────
console.log('── completeness (what decision #4’s trigger counts) ────────────────\n');
const sidesAll = scored.flatMap((s) => [
  { got: attributed(s)[0], want: s.want[0]!, conf: s.leftIsFirst ? s.confL : s.confR },
  { got: attributed(s)[1], want: s.want[1]!, conf: s.leftIsFirst ? s.confR : s.confL },
]);
const sizes = new Map<number, number>();
for (const s of sidesAll) sizes.set(s.got.length, (sizes.get(s.got.length) ?? 0) + 1);
for (const [n, c] of [...sizes].sort((a, b) => a[0] - b[0])) {
  console.log(`  union of ${n}: ${String(c).padStart(3)} side(s)  ${pct(c, sidesAll.length)}`);
}
const tail = sidesAll.filter((s) => s.conf >= AUTO_ACCEPT && s.got.length < 4);
console.log(
  `\n  NEVER-ENTERS TAIL: ${tail.length}/${sidesAll.length} (${pct(tail.length, sidesAll.length)})` +
    ` — read confidently, still short of four.\n  This is the quantity the portrait tier's trigger counts.\n`,
);

// ── threshold curve ─────────────────────────────────────────────────────────
console.log('── auto-accept threshold sweep ──────────────────────────────────────\n');
console.log('  thresh   accepted   precision   both-exact   coverage');
let best: { t: number; cov: number } | null = null;
for (const t of [0.01, 0.25, 0.5, 0.6, 0.75, 0.9, 0.95, 1.0]) {
  const acc = scored.filter((s) => Math.min(s.confL, s.confR) >= t && s.decided);
  let hit = 0;
  let got = 0;
  let ex = 0;
  for (const s of acc) {
    const at = attributed(s);
    for (const i of [0, 1] as const) {
      const p = pr(at[i]!, s.want[i]!);
      hit += p.hit;
      got += p.got;
      if (setKey(at[i]!) === setKey(s.want[i]!)) ex++;
    }
  }
  const precision = got ? hit / got : 1;
  console.log(
    `  ${t.toFixed(2)}     ${String(acc.length).padStart(3)}/${scored.length}      ${pct(hit, got).padStart(6)}      ` +
      `${pct(ex, acc.length * 2).padStart(6)}      ${pct(acc.length, scored.length).padStart(6)}`,
  );
  if (acc.length && precision >= 0.95 && (!best || acc.length / scored.length > best.cov)) {
    best = { t, cov: acc.length / scored.length };
  }
}
console.log(
  best
    ? `\n  ⇒ lowest threshold holding >=95% member precision: ${best.t.toFixed(2)} — ` +
        `${(100 * best.cov).toFixed(0)}% auto-resolves, the rest routes to review\n`
    : '\n  ⇒ NO threshold reaches 95% member precision on this set\n',
);

// ── every disagreement ──────────────────────────────────────────────────────
console.log('── disagreements ───────────────────────────────────────────────────\n');
for (const s of scored) {
  const at = attributed(s);
  for (const i of [0, 1] as const) {
    if (setKey(at[i]!) === setKey(s.want[i]!)) continue;
    const missing = s.want[i]!.filter((w) => !at[i]!.includes(w));
    const invented = at[i]!.filter((g) => !s.want[i]!.includes(g));
    console.log(
      `  ${s.id} p${i + 1} [${s.channel}]  hud ${s.hud}  conf ${(i === 0 ? s.confL : s.confR).toFixed(2)}` +
        `${invented.length ? `  INVENTED [${invented.join(', ')}]` : ''}` +
        `${missing.length ? `  missed [${missing.join(', ')}]` : ''}`,
    );
  }
}
console.log();
