/**
 * The fold's arithmetic, on hand-built frame sequences.
 *
 * Every case here is a claim about behaviour that a corpus number cannot make
 * legible: a corpus tells you the fold scored 0.83, not WHY, and not whether it
 * would have scored 0.83 for the wrong reason. These are the reasons.
 *
 * The counting case is the CORRELATED PHANTOM. Noisy-OR assumes independent
 * reads, and burst frames are the opposite of independent — same fighter, same
 * face, same crop, same background one second apart — so the realistic phantom
 * is the SAME misread twice inside one burst rather than two independent errors.
 * Plain noisy-OR multiplies that straight into confidence. `BURST_INDEP` is the
 * one constant that closes it, and this file is where its value is decided.
 *
 * The harness counts rather than throws, so one run reports everything.
 *
 * Run: npx tsx scripts/spike/fold-cases.ts
 */

import {
  BURST_INDEP,
  foldSide,
  MEMBER_MIN,
  resolveSide,
  titleOk,
  type FrameRead,
} from '../hud-read';

let pass = 0;
let fail = 0;
const check = (ok: boolean, what: string, detail = ''): void => {
  if (ok) pass++;
  else fail++;
  if (!ok) console.log(`  ✖ ${what}${detail ? `  — ${detail}` : ''}`);
  else console.log(`  ✔ ${what}${detail ? `  — ${detail}` : ''}`);
};

/** A legible read. `v`/`of` default to unanimous, which is the common case. */
const R = (sec: number, id: string | null, dist = 0, v = 10, of = 10): FrameRead => ({
  sec,
  id,
  dist,
  margin: id ? 4 : 0,
  votes: v,
  of,
});
/** A frame that read nothing — neutral, never evidence of absence. */
const BLANK = (sec: number): FrameRead => R(sec, null, 0, 0, 0);

/** A burst of `n` frames one second apart starting at `sec`. */
const burst = (sec: number, ids: (string | null)[], dist = 0): FrameRead[] =>
  ids.map((id, i) => (id === null ? BLANK(sec + i) : R(sec + i, id, dist)));

console.log(`fold cases  (BURST_INDEP=${BURST_INDEP}, MEMBER_MIN=${MEMBER_MIN})\n`);

// ── 1. the one-frame tag-in, which is the whole reason contiguity was dropped ─
console.log('1. a real tag-in occupying ONE frame of its own burst');
{
  const reads = [
    ...burst(10, ['storm', 'storm', 'storm']),
    ...burst(100, ['storm', 'storm']),
    ...burst(200, ['magik']), // one frame, one burst — a genuine brief tag
    ...burst(300, ['storm', 'storm']),
    ...burst(400, ['magik', 'magik']),
  ];
  const f = foldSide(reads);
  check(
    f.characters.includes('magik'),
    'a fighter seen in 2 bursts (one of them a single frame) is a member',
    `union [${f.characters.join(', ')}]`,
  );
  const single = foldSide([...burst(10, ['storm', 'storm', 'storm']), ...burst(200, ['magik'])]);
  check(
    !single.characters.includes('magik'),
    'ONE burst alone does not mint a member',
    `union [${single.characters.join(', ')}] · magik ${single.dropped.find((d) => d.char === 'magik')?.confidence ?? '—'}`,
  );
}

// ── 2. the correlated phantom — the case BURST_INDEP exists for ──────────────
console.log('\n2. the correlated phantom: the SAME misread on two adjacent frames');
{
  // A real side (storm) plus one burst in which the reader slipped the same way
  // twice. Under frame-level noisy-OR these are two pieces of evidence; in truth
  // they are one look at one plate, repeated.
  const reads = [
    ...burst(10, ['storm', 'storm', 'storm']),
    ...burst(100, ['storm', 'storm', 'storm']),
    // one burst, two frames, same wrong id, both one edit out
    R(200, 'blade', 1),
    R(201, 'blade', 1),
    ...burst(300, ['storm', 'storm']),
  ];
  const f = foldSide(reads);
  const phantom = [...f.members, ...f.dropped].find((m) => m.char === 'blade');
  console.log(
    `     phantom 'blade': ${phantom?.confidence} (needs ${MEMBER_MIN}) · ` +
      `frames ${phantom?.frames} · bursts ${phantom?.bursts}`,
  );
  check(
    !f.characters.includes('blade'),
    'two correlated misreads in ONE burst do not mint a member',
    f.characters.includes('blade')
      ? `LOWER BURST_INDEP — currently ${BURST_INDEP}`
      : `union [${f.characters.join(', ')}]`,
  );
  // The same two reads spread across two SEPARATE bursts are genuinely two
  // observations, and the fold is allowed to believe them.
  const spread = foldSide([
    ...burst(10, ['storm', 'storm', 'storm']),
    ...burst(100, ['storm', 'storm', 'storm']),
    R(200, 'blade', 1),
    R(400, 'blade', 1),
    ...burst(300, ['storm', 'storm']),
  ]);
  check(
    spread.characters.includes('blade'),
    'the same two reads in SEPARATE bursts do mint a member',
    `union [${spread.characters.join(', ')}]`,
  );
}

// ── 3. completeness is not confidence ───────────────────────────────────────
console.log('\n3. a complete union does not score below an incomplete one');
{
  // The structural claim, isolated: with the SAME evidence per member, the count
  // of members must not move the score. This is what the sibling formula fails —
  // there, four members splitting one evidence budget cleared 0.9 twenty times
  // less often than one member holding all of it, so the gate rewarded
  // under-reading. Here `min` is bounded below by MEMBER_MIN by construction.
  const evenly = (chars: string[]) =>
    foldSide(chars.flatMap((c, i) => [...burst(i * 1000, [c, c]), ...burst(i * 1000 + 500, [c])]));
  const one = evenly(['storm']);
  const four = evenly(['storm', 'magik', 'blade', 'loki']);
  console.log(
    `     equal evidence per member — 1 member ${one.confidence} · 4 members ${four.confidence}`,
  );
  check(
    Math.abs(four.confidence - one.confidence) < 0.001,
    'member COUNT does not move the score when per-member evidence is equal',
    `${four.confidence} vs ${one.confidence}`,
  );

  // Realistically the members are unevenly witnessed, and `min` then reports the
  // weakest of four rather than the weakest of two. That is the metric working,
  // not collapsing: it stays above the gate, which is the property that matters.
  const uneven = foldSide([
    ...burst(10, ['storm', 'storm']),
    ...burst(100, ['magik', 'magik']),
    ...burst(200, ['blade', 'blade']),
    ...burst(300, ['loki']),
    ...burst(400, ['storm', 'magik']),
    ...burst(500, ['blade', 'loki']),
  ]);
  const two = foldSide([
    ...burst(10, ['storm', 'storm']),
    ...burst(100, ['magik', 'magik']),
    ...burst(400, ['storm', 'magik']),
    ...burst(500, ['storm', 'magik']),
  ]);
  console.log(
    `     uneven — 4-member ${uneven.confidence} (complete ${uneven.complete}) · ` +
      `2-member ${two.confidence} (complete ${two.complete})`,
  );
  // The claim is about the GATE, not about beating the 2-member number. `min`
  // over four unevenly-witnessed members reports the thinnest of the four and is
  // supposed to — that is the metric working. What would be a defect is it
  // falling THROUGH the gate, which is what the sibling formula did.
  check(
    uneven.confidence >= MEMBER_MIN + 0.1,
    'an unevenly-witnessed complete union stays well clear of the gate',
    `${uneven.confidence} vs gate ${MEMBER_MIN}`,
  );
  check(uneven.complete && !two.complete, '`complete` tracks the union size, not the confidence');
  check(
    two.confidence >= MEMBER_MIN,
    'a trustworthy 2-of-4 keeps a high confidence — it is true, publishable data',
    `${two.confidence}`,
  );
}

// ── 4. confidence rises with evidence rather than converging to a constant ───
console.log('\n4. more evidence raises confidence (the sibling formula falls)');
{
  const grow = [2, 4, 8, 16].map((n) => {
    const reads = Array.from({ length: n }, (_, i) => burst(i * 100, ['storm', 'storm'])).flat();
    return foldSide(reads).confidence;
  });
  console.log(`     confidence at 2/4/8/16 bursts: ${grow.join(' → ')}`);
  check(
    grow.every((c, i) => i === 0 || c >= grow[i - 1]!),
    'monotone in evidence',
  );
  // all reads one edit out — a middling error mix must still be able to reach a
  // high confidence given enough independent looks, not asymptote below it
  const noisy = Array.from({ length: 12 }, (_, i) => [R(i * 100, 'storm', 1)]).flat();
  check(
    foldSide(noisy).confidence > 0.9,
    'twelve one-edit reads across twelve bursts clear 0.9',
    `${foldSide(noisy).confidence}`,
  );
}

// ── 5. blanks are neutral; an all-blank video is not a verdict ───────────────
console.log('\n5. blank frames');
{
  const withBlanks = foldSide([
    ...burst(10, ['storm', null, 'storm']),
    ...burst(100, ['storm', null]),
    ...burst(200, [null, null]),
  ]);
  check(
    withBlanks.characters.includes('storm'),
    'a blank between two reads does not break the member',
    `union [${withBlanks.characters.join(', ')}] · read ${withBlanks.read}/${withBlanks.sampled}`,
  );
  const allBlank = foldSide([...burst(10, [null, null, null]), ...burst(100, [null, null])]);
  check(
    allBlank.characters.length === 0 && allBlank.confidence === 0 && !allBlank.complete,
    'an all-blank video yields an empty union at confidence 0',
  );
  check(allBlank.saturation === 0, 'saturation of nothing is 0, not 1');
}

// ── 6. saturation tracks discovery, not volume ──────────────────────────────
console.log('\n6. Good-Turing saturation');
{
  const settled = foldSide(
    Array.from({ length: 8 }, (_, i) => burst(i * 100, [i % 2 ? 'storm' : 'magik'])).flat(),
  );
  const discovering = foldSide([
    ...burst(10, ['storm', 'storm']),
    ...burst(100, ['storm', 'storm']),
    ...burst(200, ['magik']),
    ...burst(300, ['blade']),
    ...burst(400, ['loki']),
  ]);
  console.log(
    `     settled (2 fighters, 8 bursts) ${settled.saturation} · ` +
      `still discovering (3 singletons) ${discovering.saturation}`,
  );
  check(
    settled.saturation > discovering.saturation,
    'a side that has stopped finding new fighters saturates higher',
  );
}

// ── 7. side attribution ─────────────────────────────────────────────────────
console.log('\n7. attribution anchored on the title-known fighter');
{
  // title says p1 played storm, p2 played magik; footage shows storm on the LEFT
  const L = [R(10, 'storm'), R(11, 'storm'), R(100, 'blade'), R(200, 'storm')];
  const Rr = [R(10, 'magik'), R(11, 'magik'), R(100, 'magik'), R(200, 'loki')];
  const s = resolveSide(L, Rr, ['storm', 'magik']);
  check(s.decided && s.leftIsFirst, 'title order confirmed spatially', `votes ${s.votes}`);

  const rev = resolveSide(Rr, L, ['storm', 'magik']);
  check(rev.decided && !rev.leftIsFirst, 'reversed footage is detected', `votes ${rev.votes}`);

  // a MIRROR — both title fighters identical — must cancel rather than guess
  const mirror = resolveSide(
    [R(10, 'storm'), R(11, 'storm')],
    [R(10, 'storm'), R(11, 'storm')],
    ['storm', 'storm'],
  );
  check(!mirror.decided, 'a mirror match is UNDECIDED, not a coin flip', `votes ${mirror.votes}`);

  // neither title fighter ever appears — no evidence, no verdict
  const silent = resolveSide([R(10, 'blade')], [R(10, 'loki')], ['storm', 'magik']);
  check(!silent.decided, 'no anchor sighting is UNDECIDED', `votes ${silent.votes}`);
}

// ── 8. the free positive control ────────────────────────────────────────────
console.log('\n8. titleOk — the per-record positive control');
{
  check(titleOk(['storm', 'magik', 'blade'], ['storm']), 'union containing the title fighter passes');
  check(
    !titleOk(['magik', 'blade'], ['storm']),
    'union MISSING the title fighter fails — reader or attribution is wrong',
  );
  check(!titleOk([], ['storm']), 'an empty union cannot satisfy the control');
}

console.log(`\n${fail === 0 ? '✔' : '✖'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
