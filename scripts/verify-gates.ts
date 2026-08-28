/**
 * POSITIVE CONTROLS for every gate the pipeline relies on.
 *
 * Checklist step 10: inject the failure each gate exists to catch and confirm
 * it exits non-zero, then confirm the clean run exits 0. A gate that cannot
 * fail is indistinguishable from a gate that passes, and you will trust it.
 *
 * Two kinds of control here:
 *   · PURE — the parser's predicates, driven with hand-built strings. Fast,
 *     no I/O, and they double as the regression suite for the five title
 *     grammars.
 *   · INTEGRATION — the guards that only exist across a whole run (collapse,
 *     freeze pin, emit throws). These snapshot data/ and raw/, inject the
 *     defect, assert the failure, and restore in a `finally`.
 *
 * Run: npm run verify:gates
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { buildAliasMatcher, loadCharacters, stripLeaderboard } from './roster';
import { alignBench, readBench } from './bench';
import { buildBenchList } from '../server/utils/portraitWork';
import { NOT_A_MATCH_RE } from './parse';
import { emitGeneric } from './emit';
import { SEASONS, buildPatchGroups, validatePatches, validateSeasons } from './patches';
import type { MatchVideo, PlayerRecord, SeasonBoundary } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label: string, ok: boolean, actual: unknown) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${actual === undefined ? '' : `: ${actual}`}`);
};

/** Assert a thunk throws. The point of an emit gate is the throw. */
async function throws(label: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await fn();
    check(label, false, 'DID NOT THROW');
  } catch (e) {
    check(label, true, `threw: ${(e as Error).message.slice(0, 74)}`);
  }
}

/**
 * SNAPSHOT FIRST, EVERYTHING, BEFORE ANY CONTROL RUNS.
 *
 * Learned here rather than read: the emit controls below call emitGeneric,
 * which writes data/replays.json + summary.json + stats.json to THIS repo —
 * that is its job. An earlier version of this script snapshotted only around
 * the parse controls further down, so the emit controls silently replaced the
 * committed 153-record archive with a single synthetic control record, and the
 * later snapshot faithfully preserved the damage.
 *
 * That is checklist step 9 exactly ("snapshot every data file before any
 * operation that can touch it"), and the thing that caught it was looking at
 * the artifact rather than at the exit code — every control still reported ✓.
 */
const SNAPSHOT = await mkdtemp(join(tmpdir(), 'tokon-gates-'));
await cp(join(ROOT, 'data'), join(SNAPSHOT, 'data'), { recursive: true });
await cp(join(ROOT, 'raw'), join(SNAPSHOT, 'raw'), { recursive: true });
const restoreAll = async () => {
  for (const dir of ['data', 'raw']) {
    await rm(join(ROOT, dir), { recursive: true, force: true });
    await cp(join(SNAPSHOT, dir), join(ROOT, dir), { recursive: true });
  }
  await rm(SNAPSHOT, { recursive: true, force: true });
};
process.on('exit', () => {
  /* best-effort marker; the real restore is the finally below */
});

const characters = await loadCharacters();
const matcher = buildAliasMatcher(characters);
try {
  // ── 1. character extraction: spans, not separator splits ────────────────────
  console.log('\n[1] character extraction — span, never split');
  {
    // The whole reason span extraction exists. A split on [/-] shreds every one
    // of these into fragments that resolve to nothing (or worse, to something).
    const hyphenBench = 'Ghost Rider- Storm- Spider-Man- Star-Lord';
    const ids = matcher.ids(hyphenBench);
    check(
      'hyphen-separated bench yields exactly 4 (Spider-Man / Star-Lord survive)',
      ids.length === 4 &&
        ids.includes('spider-man') &&
        ids.includes('star-lord') &&
        ids.includes('ghost-rider') &&
        ids.includes('storm'),
      ids.join(','),
    );
    check(
      'comma bench',
      matcher.ids('Magik, Doctor Doom, Blade, Black Panther').length === 4,
      matcher.ids('Magik, Doctor Doom, Blade, Black Panther').join(','),
    );
    check('slash bench', matcher.ids('Magik/Storm').join(',') === 'magik,storm', undefined);
    check(
      '"and" bench',
      matcher.ids('Danger, Magik, Magneto and Hulk').length === 4,
      matcher.ids('Danger, Magik, Magneto and Hulk').join(','),
    );
    check(
      'longest-alias-first: "Doctor Doom" is not "Doom" twice',
      matcher.ids('Doctor Doom').join(',') === 'doctor-doom',
      matcher.ids('Doctor Doom').join(','),
    );
    // THREE ORDERINGS. The first always worked; the other two did not, and the
    // symptom was not a short side — every fighter still resolved — but a
    // residue string ("Ranked#5", "Ranked#10") clearing the 3-record threshold
    // and raising "a new fighter has probably shipped" in report.md. These
    // controls exist so the DLC alarm stays trustworthy.
    for (const [slot, want] of [
      ['#2 Ranked Danger', 'danger'],
      ['Ranked #5 Storm', 'storm'],
      ['Rank #3 Magik', 'magik'],
      ['#1 Captain America', 'captain-america'],
      ['Ranked #10 Wolverine', 'wolverine'],
    ] as const) {
      const stripped = stripLeaderboard(slot);
      check(
        `leaderboard stripped: "${slot}" → ${want}`,
        matcher.ids(stripped).join(',') === want && matcher.residue(stripped) === '',
        `ids=${matcher.ids(stripped).join(',')} residue="${matcher.residue(stripped)}"`,
      );
    }
    // The widened strip must not become a swallower. A `#` is mandatory in every
    // branch, so a bare word still surfaces — otherwise the fix to the alarm
    // would have quietly disabled the alarm.
    check(
      'no bare-word swallowing: "Ranked Danger" keeps its residue',
      stripLeaderboard('Ranked Danger') === 'Ranked Danger' &&
        matcher.residue('Ranked Danger').toLowerCase() === 'ranked',
      `"${matcher.residue(stripLeaderboard('Ranked Danger'))}"`,
    );
    check(
      'the strip does not eat an unknown fighter after a rank',
      matcher.residue(stripLeaderboard('#1 Sentinel')).toLowerCase() === 'sentinel',
      `"${matcher.residue(stripLeaderboard('#1 Sentinel'))}"`,
    );
    // The residue gate: an unknown name must SURFACE, not vanish.
    check(
      'residue surfaces an unknown fighter',
      matcher.residue('Magik, Sentinel').toLowerCase() === 'sentinel',
      `"${matcher.residue('Magik, Sentinel')}"`,
    );
    check('residue empty on a clean bench', matcher.residue('Magik, Storm') === '', undefined);

    // OBSERVED UPLOADER TYPOS. Each of these sat in the review queue as
    // character-completion — the whole record held off the site because one
    // slot named a fighter nobody could spell. Added only where the misspelling
    // has exactly ONE plausible referent; `P. Parker` stays unresolved on
    // purpose, because Peni Parker and Peter Parker are both real answers.
    for (const [typo, want] of [
      ['Ghsot Rider', 'ghost-rider'],
      ['Stard-Lord', 'star-lord'],
      ['Capitan America', 'captain-america'],
      ['Black Phanther', 'black-panther'],
      ['Sipder Man', 'spider-man'],
      ['Strom', 'storm'],
    ] as const) {
      check(
        `typo alias: "${typo}" → ${want}`,
        matcher.ids(typo).join(',') === want && matcher.residue(typo) === '',
        `ids=${matcher.ids(typo).join(',')} residue="${matcher.residue(typo)}"`,
      );
    }
  }

  // ── 1a. the not-a-match filter ──────────────────────────────────────────────
  //
  // This regex is the one with a body count. Its own header records that
  // testing /Top \d+/ "cost SF6 real records", so every widening owes TWO
  // controls: that it catches what it was widened for, and that it still lets a
  // real match through. The second is the one that would have caught SF6's.
  console.log('\n[1a] not-a-match — catches mod showcases, still passes real matches');
  {
    for (const title of [
      'Dark Magik vs Lady Deadpool ▰ Mod Showcase ▰ Marvel Tokon',
      'Deadpool (Lady Deadpool) vs Spider-Man (Black Gold Suit) ▰ Mod Showcase ▰ Marvel Tokon',
      'MARVEL TOKON ▰ A (Magik) vs B (Storm) ▰ MODSHOWCASE',
    ]) {
      check(`rejects: "${title.slice(0, 52)}…"`, NOT_A_MATCH_RE.test(title), undefined);
    }
    // Mod showcases are worse than unresolvable: "Lady Deadpool" and "Dark
    // Magik" BOTH resolve against the roster, so a looser rule would publish
    // mod skins as fighters rather than fail loudly.
    check(
      'and the danger is real — a mod title does resolve to fighters',
      matcher.ids('Dark Magik vs Lady Deadpool').length === 2,
      matcher.ids('Dark Magik vs Lady Deadpool').join(','),
    );
    // THE OVER-REJECTION CONTROL. Every one of these is a real match from the
    // corpus, and each contains a substring near the new pattern.
    for (const title of [
      'MARVEL TOKON ▰ KEAZER (#1 Ranked Danger) vs JERRES (Iron Man) ▰ High Level Gameplay',
      'MARVEL Tokon ▰ K7 showoff (Doc. Doom/Magneto) vs Yamii (Spider-Man/G. Goblin) ▰ High Level Gameplay',
      'TOKON ▰ NAIRE (Spider-Man) vs (Green Goblin) HADO 👊【MARVEL TŌKON: Fighting Souls】',
      'Marvel Tokon ▰ SENSHII (#1 Black Panther) vs SOAP EATER (Blade) ▰ High Level Gameplay',
      'MARVEL TOKON ▰ MODESTO (Magik) vs SHOWCASER (Storm) ▰ High Level Gameplay',
    ]) {
      check(`still a match: "${title.slice(0, 46)}…"`, !NOT_A_MATCH_RE.test(title), undefined);
    }

    // THE SIGNAL /dev/review-queue REFUSES A VERDICT ON.
    //
    // Some queued titles name their fighters with no parentheses — "GLIDER
    // Ranked #13 Magik vs Senshii Ranked #9 Spider Man" — so the slot boundary
    // lands in the wrong place and the whole span becomes the handle. Those
    // characters are not unknown; the PARSE is wrong, and no answer about
    // characters can repair it. Accepting one would mint
    // `glider-ranked-13-magik` beside the `glider` who already exists — a real
    // player split across two pages, each holding some of their matches.
    //
    // This controls the predicate the endpoint keys on, not the HTTP layer:
    // a handle that resolves a fighter is a broken handle.
    for (const h of [
      'GLIDER Ranked #13 Magik',
      'Senshii Ranked #9 Spider Man',
      'Eduardo Hook Ranked #1 Blade',
    ]) {
      check(
        `unusable handle detected: "${h}"`,
        matcher.ids(h).length > 0,
        matcher.ids(h).join(','),
      );
    }
    for (const h of ['DIAPHONE', 'LIQUID GIANT', 'Eduardo Hook', 'SAVE THE QUEEN', 'Cloud805']) {
      check(
        `real handle passes: "${h}"`,
        matcher.ids(h).length === 0,
        matcher.ids(h).join(',') || 'clean',
      );
    }
  }

  // ── 1b. the fgcReplaysHub 'prose-with' bench shape ──────────────────────────
  //
  // A bench shape's failure mode is not a crash. It is a side that looks
  // complete and is wrong. So the controls that matter here are the REJECTIONS:
  // three descriptions this shape must refuse, one of which contains five
  // roster names and would be the fabrication if it were ever read.
  console.log("\n[1b] description bench — the 'prose-with' shape");
  {
    const FGC =
      'FGC Replays Hub is your place for fighting game replay videos, featuring ' +
      'matches from 2XKO and Marvel Tokon. This replay features EDUARDO HOOK with ' +
      'Blade, Storm, Spider Man, Iron Man vs SUPERNOON with Magik, Spider Man, ' +
      'Green Goblin, Blade.\n\n#marveltokon #tokon';

    const read = readBench(FGC, 'prose-with', matcher);
    check(
      'reads both sides to exactly 4',
      read?.sides[0]!.characters.length === 4 && read?.sides[1]!.characters.length === 4,
      `${read?.sides[0]!.characters.join('/')} | ${read?.sides[1]!.characters.join('/')}`,
    );
    // The defect the uppercase handle class exists to prevent. With
    // DESC_SIDE_RE's class this reads "This replay features EDUARDO HOOK" — 31
    // chars, under parse.ts's 40-char guard, so it would outrank the title
    // handle and ship as the player's display name.
    check(
      'handle is the handle, not the boilerplate lead-in',
      read?.sides[0]!.handle === 'EDUARDO HOOK' && read?.sides[1]!.handle === 'SUPERNOON',
      `"${read?.sides[0]!.handle}" | "${read?.sides[1]!.handle}"`,
    );
    check(
      'clean bench leaves no residue',
      read?.sides[0]!.residue === '',
      `"${read?.sides[0]!.residue}"`,
    );
    check(
      'it aligns to the title by handle, not by position',
      alignBench(read!, ['EDUARDO HOOK', 'SUPERNOON'], [['blade'], ['magik']]).how === 'handle',
      alignBench(read!, ['EDUARDO HOOK', 'SUPERNOON'], [['blade'], ['magik']]).how,
    );

    // ── the rejections ──
    // hadoukenReplays' boilerplate. FIVE roster names, identical on every one of
    // its 758 uploads, belonging to no side at all. This is the fabrication the
    // shape must refuse, and the reason the channel has no descriptionBench.
    const SOUP =
      'Electrifying battles, insane and flawless plays, breathtaking comebacks.\n\n' +
      '#marveltokon \n#IronMan #HomemDeFerro\n#SpiderMan #Storm\n#StarLord #GhostRider';
    check(
      'REJECTS hadouken hashtag soup (5 roster names, no side structure)',
      readBench(SOUP, 'prose-with', matcher) === null,
      `${matcher.ids(SOUP).length} names present, read ${readBench(SOUP, 'prose-with', matcher) === null ? 'null' : 'A SIDE'}`,
    );
    // replaysHub's shape — parenthesised, one per side. Reading it as a bench
    // would "complete" a 4-slot side at 1.
    check(
      'REJECTS a replaysHub Player-lines description',
      readBench(
        'Player 1: JOHNNY (Captain America)\nPlayer 2: LORD VENOM (Loki)',
        'prose-with',
        matcher,
      ) === null,
      undefined,
    );
    // The uppercase guard, stated as a control rather than a comment.
    check(
      'REJECTS a lowercase handle rather than guessing at its extent',
      readBench(
        'this replay features someone with Blade, Storm, Magik, Loki vs other with Magik, Storm, Blade, Loki.',
        'prose-with',
        matcher,
      ) === null,
      undefined,
    );
    // An unknown name must SURFACE, not silently shorten the side to three.
    const DLC = FGC.replace('Storm,', 'Sentinel,');
    const dlc = readBench(DLC, 'prose-with', matcher);
    check(
      'an unknown fighter surfaces as residue instead of a quiet 3-name side',
      dlc?.sides[0]!.characters.length === 3 && dlc?.sides[0]!.residue.toLowerCase() === 'sentinel',
      `n=${dlc?.sides[0]!.characters.length} residue="${dlc?.sides[0]!.residue}"`,
    );
  }

  // ── 1c. the human tier's front door ─────────────────────────────────────────
  //
  // buildBenchList decides which incomplete sides a person is ever SHOWN. A side
  // it silently omits is not deferred, it is abandoned — nothing else in the
  // pipeline will ever revisit it — so its two guards need controls as much as
  // any parser predicate does.
  //
  // The bug these were written for: both frame pools derived from the reader's
  // own rows, so a record the OCR read NOTHING on had no seconds, tripped
  // `pool.length < 2`, and never appeared. That is the case a human is most
  // needed for. 19 records, 38 sides, 3,368 unused frames on disk.
  console.log('\n[1c] bench worklist — what a person is allowed to see');
  {
    const tmp = await mkdtemp(join(tmpdir(), 'tokon-bench-'));
    const cwd = process.cwd();
    const write = async (rel: string, data: unknown) => {
      await mkdir(dirname(join(tmp, rel)), { recursive: true });
      await writeFile(join(tmp, rel), JSON.stringify(data));
    };
    const frame = async (id: string, sec: number) => {
      await mkdir(join(tmp, 'cache/tokon/frames', id), { recursive: true });
      await writeFile(
        join(tmp, 'cache/tokon/frames', id, `${String(sec).padStart(6, '0')}.png`),
        '',
      );
    };
    const side = (chars: string[]) => ({
      characters: chars,
      handle: 'H',
      provenance: { fromTitle: [chars[0]!] },
    });
    const rec = (id: string) => ({ id, sides: [side(['magik']), side(['storm'])] });
    try {
      // zeroRead   — OCR read nothing, but frames exist 100s apart  → MUST SURFACE
      // noFrames   — same, no frames directory at all               → must be refused
      // oneFrame   — same, only ONE frame on disk                   → must be refused
      await write('data/bench-queue.json', [
        { id: 'zeroRead' },
        { id: 'noFrames' },
        { id: 'oneFrame' },
      ]);
      await write('data/videos.json', [rec('zeroRead'), rec('noFrames'), rec('oneFrame')]);
      await write('cache/tokon/extracted.json', {
        zeroRead: { geom: {}, left: [], right: [] },
        noFrames: { geom: {}, left: [], right: [] },
        oneFrame: { geom: {}, left: [], right: [] },
      });
      await frame('zeroRead', 100);
      await frame('zeroRead', 200);
      await frame('oneFrame', 100);

      process.chdir(tmp);
      const list = buildBenchList();
      const ids = list.map((w) => w.video);
      check(
        'a record the plate read NOTHING on still reaches the labeller',
        ids.filter((x) => x === 'zeroRead').length === 2,
        `${ids.filter((x) => x === 'zeroRead').length} item(s) — expected 2, one per screen side`,
      );
      // The frames the fallback picks must be far enough apart to be different
      // bursts; two frames of the same moment is not a set comparison.
      const zr = list.find((w) => w.video === 'zeroRead');
      check(
        'it picks two DIFFERENT seconds, not the same frame twice',
        !!zr && zr.secs[0] !== zr.secs[1],
        zr ? `${zr.secs[0]}s and ${zr.secs[1]}s` : 'no item',
      );
      // It must ask for attribution rather than assume it: with no plate read
      // there is nothing placing this screen side on a player.
      check(
        'with nothing read, it ASKS which player the side is',
        !!zr && zr.needs.side === true && zr.known.length === 0,
        zr ? `needs.side=${zr.needs.side} known=${zr.known.length}` : 'no item',
      );
      // The two guards the fix must not have weakened.
      check(
        'a record with NO frames on disk is still refused',
        !ids.includes('noFrames'),
        undefined,
      );
      check('a record with only ONE frame is still refused', !ids.includes('oneFrame'), undefined);
    } finally {
      process.chdir(cwd);
      await rm(tmp, { recursive: true, force: true });
    }
  }

  // ── 1d. attribution collision ───────────────────────────────────────────────
  //
  // Both screen sides cannot be the same player. When the plate places them both
  // on one record side, the elimination rule (which only rescues exactly-one-null)
  // does not fire, `settled()` skips both, and the incomplete side is unreachable.
  // Observed on L_s3lYOuR3k: the right plate read the LEFT player's title fighter
  // — ordinary on a 21-fighter roster, not necessarily an OCR error — and HADO's
  // bench sat behind 72 frames nobody was ever shown.
  console.log('\n[1d] bench worklist — contradictory attribution asks instead of skipping');
  {
    const tmp = await mkdtemp(join(tmpdir(), 'tokon-collide-'));
    const cwd = process.cwd();
    const write = async (rel: string, data: unknown) => {
      await mkdir(dirname(join(tmp, rel)), { recursive: true });
      await writeFile(join(tmp, rel), JSON.stringify(data));
    };
    const frame = async (id: string, sec: number) => {
      await mkdir(join(tmp, 'cache/tokon/frames', id), { recursive: true });
      await writeFile(
        join(tmp, 'cache/tokon/frames', id, `${String(sec).padStart(6, '0')}.png`),
        '',
      );
    };
    const row = (sec: number, id: string) => ({ sec, id, dist: 0 });
    const pair = (id: string) => ({
      id,
      sides: [
        {
          characters: ['spider-man', 'blade', 'magik', 'carnage'],
          handle: 'A',
          provenance: { fromTitle: ['spider-man'] },
        },
        { characters: ['loki'], handle: 'B', provenance: { fromTitle: ['loki'] } },
      ],
    });
    try {
      // collide — BOTH plates read spider-man, side 0's title fighter. Side 0 is
      //           complete and settled; side 1 is short and must still be offered.
      // clean   — each plate reads its own side's fighter. Attribution resolves,
      //           and the page must NOT ask for a side it already knows.
      await write('data/bench-queue.json', [{ id: 'collide' }, { id: 'clean' }]);
      await write('data/videos.json', [pair('collide'), pair('clean')]);
      await write('cache/tokon/extracted.json', {
        collide: {
          geom: {},
          left: [row(10, 'spider-man'), row(100, 'spider-man')],
          right: [row(20, 'spider-man'), row(200, 'spider-man')],
        },
        clean: {
          geom: {},
          left: [row(10, 'spider-man'), row(100, 'spider-man')],
          right: [row(20, 'loki'), row(200, 'loki')],
        },
      });
      for (const sec of [10, 100, 20, 200]) {
        await frame('collide', sec);
        await frame('clean', sec);
      }

      process.chdir(tmp);
      const list = buildBenchList();
      const collide = list.filter((w) => w.video === 'collide');
      check(
        'both plates on one player: the unreachable side is still offered',
        collide.length === 2,
        `${collide.length} item(s) — expected 2`,
      );
      check(
        'and it ASKS which player, rather than trusting a contradiction',
        collide.length > 0 && collide.every((w) => w.sideIndex === null && w.needs.side === true),
        collide.map((w) => `sideIndex=${w.sideIndex}`).join(' ') || 'no items',
      );
      // The guard must not fire on ordinary records: a correct attribution still
      // resolves, and asking a reviewer a question they already answered is a cost.
      const clean = list.filter((w) => w.video === 'clean');
      check(
        'normal attribution still resolves without asking',
        clean.length === 1 && clean[0]!.sideIndex === 1 && clean[0]!.needs.side === false,
        clean.map((w) => `sideIndex=${w.sideIndex} needs.side=${w.needs.side}`).join(' ') ||
          'no item',
      );
    } finally {
      process.chdir(cwd);
      await rm(tmp, { recursive: true, force: true });
    }
  }

  // ── 2. the emit contract ────────────────────────────────────────────────────
  console.log('\n[2] emit contract — every assertion is a throw');
  {
    const players: PlayerRecord[] = [
      { id: 'a', handle: 'A' },
      { id: 'b', handle: 'B' },
    ];
    const sources = ['proReplays'];
    const prov = {
      tier: 'title' as const,
      tiers: ['title' as const],
      fromTitle: ['magik'],
      complete: false,
    };
    const base = (): MatchVideo => ({
      id: 'ctl1',
      channel: 'proReplays',
      intake: 'proReplays',
      title: 't',
      publishedAt: '2026-08-11T00:00:00Z',
      durationSec: 600,
      season: 1,
      sides: [
        { player: 'a', handle: 'A', characters: ['magik'], provenance: { ...prov } },
        { player: 'b', handle: 'B', characters: ['storm'], provenance: { ...prov } },
      ],
    });

    // The clean case must NOT throw, or every control below is meaningless.
    const cleanDir = await mkdtemp(join(tmpdir(), 'tokon-emit-'));
    try {
      await throws('empty side (0 characters) rejected', async () => {
        const r = base();
        r.sides[0].characters = [];
        await emitGeneric([r], characters, players, sources);
      });
      await throws('unknown character id rejected', async () => {
        const r = base();
        r.sides[0].characters = ['sentinel'];
        await emitGeneric([r], characters, players, sources);
      });
      await throws('unknown player id rejected', async () => {
        const r = base();
        r.sides[0].player = 'nobody';
        await emitGeneric([r], characters, players, sources);
      });
      await throws('untracked source rejected', async () => {
        const r = base();
        r.channel = 'proReplays';
        await emitGeneric([r], characters, players, ['someOtherToken']);
      });
      await throws('unknown patch token rejected (date outside every window)', async () => {
        const r = base();
        r.season = 9;
        await emitGeneric([r], characters, players, sources);
      });
    } finally {
      await rm(cleanDir, { recursive: true, force: true });
    }

    // A side LONGER than charactersPerSide is legal data (mid-set team change) —
    // the contract hard-fails only on zero, and a gate that rejected 5 would
    // silently drop real records.
    let oversizeOk = true;
    try {
      const r = base();
      r.sides[0].characters = ['magik', 'storm', 'blade', 'hulk', 'loki'];
      await emitGeneric([r], characters, players, sources);
    } catch {
      oversizeOk = false;
    }
    check('a 5-character side is ACCEPTED (>4 is legal, only 0 fails)', oversizeOk, undefined);
  }

  // ── 3. the patch table ──────────────────────────────────────────────────────
  console.log('\n[3] patch table validators');
  {
    // Mirrors the committed table's SHAPE, pre-release row included. Without
    // that row every case below would trip the post-loop "S0 has no opening
    // patch" check instead of the defect it injects — every control still
    // throwing, none of them still testing what its label says.
    const good = [
      { version: '2026-06-26', start: '2026-06-26', announcedOn: 'event' as const },
      { version: '2026-08-06', start: '2026-08-06', announcedOn: 'launch' as const },
      { version: '2026-08-10', start: '2026-08-10', announcedOn: 'steam' as const },
    ];
    check('the committed table validates', (validatePatches(), true), undefined);
    const bad = (mut: (p: typeof good) => unknown[], label: string) => {
      try {
        validatePatches(mut(structuredClone(good)) as never);
        check(label, false, 'DID NOT THROW');
      } catch (e) {
        check(label, true, (e as Error).message.slice(0, 62));
      }
    };
    bad((p) => ((p[0]!.version = '1.00'), p), 'a semver token is rejected (the vendor uses dates)');
    bad((p) => ((p[2]!.version = '2026-08-11'), p), 'token !== start is rejected');
    bad(
      (p) => ((p[2]!.start = '2030-01-01'), (p[2]!.version = '2030-01-01'), p),
      'a future date is rejected',
    );
    // The floor, tested with the date it actually exists to keep out: the
    // December 2025 closed-test footage sitting in hadoukenReplays' dump. The
    // earlier version of this control injected 2026-08-05, which stopped
    // testing the floor the moment PRE_RELEASE moved below it — it kept passing
    // on the strictly-after rule instead, with the same green tick.
    bad(
      (p) => ((p[0]!.start = '2025-12-07'), (p[0]!.version = '2025-12-07'), p),
      'a date below the pre-release floor is rejected',
    );
    bad((p) => [p[1]!, p[2]!], 'an era with no opening patch is rejected');
    bad(
      (p) => ((p[0]!.announcedOn = 'rumour' as never), p),
      'an announcedOn outside the union is rejected',
    );

    // The season table's own floor, which validatePatches never reaches.
    const badSeasons = (mut: (x: SeasonBoundary[]) => SeasonBoundary[], label: string) => {
      try {
        validateSeasons(mut(structuredClone(SEASONS)));
        check(label, false, 'DID NOT THROW');
      } catch (e) {
        check(label, true, (e as Error).message.slice(0, 62));
      }
    };
    badSeasons(
      (x) => ((x[0]!.start = '2025-01-01'), x),
      'an era starting below the pre-release floor is rejected',
    );
    badSeasons((x) => [x[1]!, x[0]!], 'eras out of order are rejected');

    const ids = new Set<string>();
    let dupe = false;
    for (const g of buildPatchGroups()) {
      if (ids.has(g.id)) dupe = true;
      ids.add(g.id);
      for (const c of g.children ?? []) {
        if (ids.has(c.id)) dupe = true;
        ids.add(c.id);
      }
    }
    check('patchGroups ids unique across parents AND children', !dupe, `${ids.size} ids`);
  }

  // ── 4. the collapse guard + game marker, end to end ─────────────────────────
  console.log('\n[4] collapse guard + game marker (full parse run)');
  {
    const parse = (args: string[] = []) => {
      try {
        execFileSync('npx', ['tsx', 'scripts/parse.ts', ...args], {
          cwd: ROOT,
          stdio: 'pipe',
          encoding: 'utf8',
        });
        return { code: 0, out: '' };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      }
    };

    try {
      // 4a — the game marker, in the direction that actually bit this platform:
      // a 2XKO title in the ▰ grammar this channel used to publish under.
      const rawPath = join(ROOT, 'raw', 'proReplays.json');
      const original = JSON.parse(await readFile(rawPath, 'utf8')) as Record<string, unknown>[];
      const poisoned = [
        {
          id: 'CTLPOISON01',
          channel: 'proReplays',
          title: '2XKO ▰ FAKEPLAYER (Ahri) vs OTHERGUY (Darius) ▰ 2XKO Pro level replays',
          description: '2XKO high level replay',
          publishedAt: '2026-08-11T00:00:00Z',
          durationSec: 600,
          liveBroadcastContent: 'none',
        },
        ...original,
      ];
      await writeFile(rawPath, JSON.stringify(poisoned, null, 1));
      parse();
      const videos = JSON.parse(
        await readFile(join(ROOT, 'data', 'videos.json'), 'utf8'),
      ) as MatchVideo[];
      check(
        'a 2XKO title in the SAME ▰ grammar never reaches videos.json',
        !videos.some((v) => v.id === 'CTLPOISON01'),
        `${videos.length} records, poison absent`,
      );
      await writeFile(rawPath, JSON.stringify(original, null, 1));

      // 4c — the title tail affixes, BOTH bracket families.
      // hadoukenReplays publishes the same "MARVEL TŌKON: Fighting Souls" tail
      // in 【】 on 53 titles and in ASCII [] on 17, and only the full-width form
      // was modelled. The ASCII tail rode into the last side's handle: it minted
      // 12 junk players, and where it pushed the handle past 40 characters the
      // bad-handle guard deleted the record outright. Controlled here because
      // the failure is invisible in every count — a junk handle looks like a
      // player and a deleted record looks like a channel that posted less.
      const hadoPath = join(ROOT, 'raw', 'hadoukenReplays.json');
      const hadoOriginal = JSON.parse(await readFile(hadoPath, 'utf8')) as Record<
        string,
        unknown
      >[];
      const fixture = (id: string, title: string) => ({
        id,
        channel: 'hadoukenReplays',
        title,
        description: 'control fixture',
        publishedAt: '2026-08-11T00:00:00Z',
        durationSec: 600,
        liveBroadcastContent: 'none',
      });
      const LONG = 'A'.repeat(45); // > 40 with no tail at all
      await writeFile(
        hadoPath,
        JSON.stringify(
          [
            fixture(
              'CTLTAIL01',
              'TOKON ▰ CTLONE (Spider-Man) vs (Champion) CTLBRACKET 👊[MARVEL TŌKON: Fighting Souls]',
            ),
            fixture(
              'CTLTAIL02',
              'TOKON ▰ CTLTWO (Magik) vs (Loki) CTLFULLWIDTH 👊 【MARVEL TŌKON: Fighting Souls】',
            ),
            fixture(
              'CTLTAIL03',
              `TOKON ▰ CTLTHREE (Blade) vs (Hulk) ${LONG} 👊[MARVEL TŌKON: Fighting Souls]`,
            ),
            ...hadoOriginal,
          ],
          null,
          1,
        ),
      );
      parse();
      const tailVideos = JSON.parse(
        await readFile(join(ROOT, 'data', 'videos.json'), 'utf8'),
      ) as MatchVideo[];
      const tailPlayers = JSON.parse(
        await readFile(join(ROOT, 'data', 'players.json'), 'utf8'),
      ) as PlayerRecord[];
      const handleOf = (id: string) =>
        tailVideos.find((v) => v.id === id)?.sides.at(-1)?.handle ?? '(record absent)';
      check(
        'ASCII [MARVEL TŌKON: Fighting Souls] stripped from the handle',
        handleOf('CTLTAIL01') === 'CTLBRACKET',
        `"${handleOf('CTLTAIL01')}"`,
      );
      check(
        'full-width 【…】 still stripped (the regression this widening could cause)',
        handleOf('CTLTAIL02') === 'CTLFULLWIDTH',
        `"${handleOf('CTLTAIL02')}"`,
      );
      check(
        'a handle still over 40 chars AFTER the strip is refused, not published',
        !tailVideos.some((v) => v.id === 'CTLTAIL03'),
        `record ${tailVideos.some((v) => v.id === 'CTLTAIL03') ? 'present' : 'absent'}`,
      );
      check(
        'no player handle anywhere carries a bracket',
        !tailPlayers.some((pl) => /[[\]【】]/u.test(pl.handle)),
        `${tailPlayers.length} players`,
      );
      await writeFile(hadoPath, JSON.stringify(hadoOriginal, null, 1));

      /**
       * 4e — the marvelTokonYT intake: three gates that only exist together.
       *
       * Controlled as one fixture because the failures are not independent. The
       * events-only gate decides WHETHER a record exists; the affix cut decides
       * whether its handles are people or branding; the per-channel floor
       * decides whether pre-launch footage may exist at all. Break any one and
       * the other two still report green — an online replay published under the
       * Tournament chip, a player page named "Marvel Tokon ➤ Nerdjosh", or ten
       * EVO matches silently absent — and none of the three shows up in a count.
       */
      const mtPath = join(ROOT, 'raw', 'marvelTokonYT.json');
      const mtOriginal = JSON.parse(await readFile(mtPath, 'utf8')) as Record<string, unknown>[];
      const mtFixture = (id: string, title: string, publishedAt: string) => ({
        id,
        channel: 'marvelTokonYT',
        title,
        description: 'control fixture',
        publishedAt,
        durationSec: 600,
        liveBroadcastContent: 'none',
      });
      await writeFile(
        mtPath,
        JSON.stringify(
          [
            // the ➤ affix, events form — the shape that died as bad-handle
            mtFixture(
              'CTLMT01',
              'CTLALPHA (Magik) vs CTLBETA (Storm) ➤ CEO 2026 - MARVEL Tokon - Top 192 Winners',
              '2026-08-16T00:00:00Z',
            ),
            // the ➤ … ✦ online form — must be DROPPED, not published
            mtFixture(
              'CTLMT02',
              'MARVEL Tokon ➤ CTLGAMMA (Blade) vs CTLDELTA (Hulk) ✦ High Level Match',
              '2026-08-16T00:00:00Z',
            ),
            // pre-launch EVO footage — admitted only because THIS channel
            // declares preReleaseFrom
            mtFixture(
              'CTLMT03',
              'Marvel Tokon ➤ CTLEPSILON (Loki) VS CTLZETA (Carnage) ➤ EVO 2026 Exhibitions',
              '2026-06-27T00:00:00Z',
            ),
            // an event brand nobody registered — must drop, and be COUNTABLE
            mtFixture(
              'CTLMT04',
              'CTLETA (Danger) vs CTLTHETA (Magneto) ➤ Tokon Invitational 2026 - Grand Final',
              '2026-08-16T00:00:00Z',
            ),
            ...mtOriginal,
          ],
          null,
          1,
        ),
      );
      // …and the floor stays HARD on a channel that declares no preReleaseFrom.
      const preRawPath = join(ROOT, 'raw', 'replaysHub.json');
      const preOriginal = JSON.parse(await readFile(preRawPath, 'utf8')) as Record<
        string,
        unknown
      >[];
      await writeFile(
        preRawPath,
        JSON.stringify(
          [
            {
              id: 'CTLPRE01',
              channel: 'replaysHub',
              title: 'MARVEL TOKON ▰ CTLIOTA (Magik) vs CTLKAPPA (Storm) ▰ High Level Gameplay',
              description: 'control fixture',
              publishedAt: '2026-06-27T00:00:00Z',
              durationSec: 600,
              liveBroadcastContent: 'none',
            },
            ...preOriginal,
          ],
          null,
          1,
        ),
      );
      parse();
      const mtVideos = JSON.parse(
        await readFile(join(ROOT, 'data', 'videos.json'), 'utf8'),
      ) as MatchVideo[];
      const mtQueue = JSON.parse(
        await readFile(join(ROOT, 'data', 'review-queue.json'), 'utf8'),
      ) as { id: string }[];
      const mtOf = (id: string) => mtVideos.find((v) => v.id === id);
      const mtHandles = (id: string) =>
        mtOf(id)
          ?.sides.map((sd) => sd.handle)
          .join(' | ') ?? '(record absent)';

      check(
        'the ➤ affix is cut, so an event suffix never reaches a handle',
        mtHandles('CTLMT01') === 'CTLALPHA | CTLBETA',
        `"${mtHandles('CTLMT01')}"`,
      );
      check(
        'and it publishes under the TOURNAMENT token, not the intake key',
        mtOf('CTLMT01')?.channel === 'marvelTokonTournament' &&
          mtOf('CTLMT01')?.intake === 'marvelTokonYT',
        `${mtOf('CTLMT01')?.channel} / ${mtOf('CTLMT01')?.intake}`,
      );
      check(
        'an online-branded upload on an events-only channel is DROPPED',
        !mtOf('CTLMT02'),
        `record ${mtOf('CTLMT02') ? 'present' : 'absent'}`,
      );
      check(
        'an unregistered event brand is dropped, never published as Tournament',
        !mtOf('CTLMT04'),
        `record ${mtOf('CTLMT04') ? 'present' : 'absent'}`,
      );
      // The floor and the era in one assertion, because passing the floor is
      // worthless if the record then has no era to file under: emit throws on a
      // patch token no group accounts for, so a floor without a matching
      // boundary fails the whole run rather than shipping an undated record.
      check(
        'pre-launch event footage passes the channel floor and files under S0',
        mtOf('CTLMT03')?.season === 0,
        `season ${mtOf('CTLMT03')?.season ?? '(record absent)'}`,
      );
      const mtGroups = JSON.parse(
        await readFile(join(ROOT, 'data', 'patchGroups.json'), 'utf8'),
      ) as { id: string; children?: { id: string }[] }[];
      check(
        'and the pre-release facet parent appears once the era is non-empty',
        mtGroups.some((g) => g.id === 'S0' && g.children?.some((c) => c.id === '2026-06-26')),
        mtGroups.map((g) => g.id).join(','),
      );
      check(
        'the floor stays HARD on a channel with no preReleaseFrom',
        !mtVideos.some((v) => v.id === 'CTLPRE01') && !mtQueue.some((q) => q.id === 'CTLPRE01'),
        'CTLPRE01 absent from videos and queue',
      );
      check(
        'no player handle anywhere carries an affix glyph',
        !(
          JSON.parse(await readFile(join(ROOT, 'data', 'players.json'), 'utf8')) as PlayerRecord[]
        ).some((pl) => /[▰➤✦]/u.test(pl.handle)),
        'clean',
      );
      await writeFile(mtPath, JSON.stringify(mtOriginal, null, 1));
      await writeFile(preRawPath, JSON.stringify(preOriginal, null, 1));

      // 4b — the collapse guard. Cut a channel to 20% and the run must refuse to
      // write, BEFORE touching anything.
      // Keep the OLDEST fifth, not the newest. raw/ is sorted newest-first and
      // this game launched days ago, so slicing off the tail would retain every
      // Tōkon upload and the guard would (correctly) stay silent — a control that
      // passes for the wrong reason is worse than no control.
      const big = JSON.parse(
        await readFile(join(ROOT, 'raw', 'hadoukenReplays.json'), 'utf8'),
      ) as unknown[];
      await writeFile(
        join(ROOT, 'raw', 'hadoukenReplays.json'),
        JSON.stringify(big.slice(-Math.floor(big.length * 0.2)), null, 1),
      );
      const collapsed = parse();
      check(
        'collapse guard exits non-zero on a truncated channel',
        collapsed.code !== 0 && /COLLAPSE GUARD/.test(collapsed.out),
        `exit ${collapsed.code}`,
      );
      const allowed = parse(['--allow-collapse=hadoukenReplays']);
      check(
        '--allow-collapse lets the same run through deliberately',
        allowed.code === 0,
        `exit ${allowed.code}`,
      );
    } finally {
      // restored by the global finally
    }
  }

  // ── 4d. the union slip ──────────────────────────────────────────────────────
  //
  // Two players swapping screen sides mid-match puts both portrait clusters on
  // both halves; reading the whole HUD then records all eight fighters on each
  // side. Nothing downstream questions it — a side over four is a legitimate
  // mid-set change, counted in usage and only excluded from pairing — so the
  // record counts sixteen appearances for a match that had eight and looks
  // healthy the entire way. Found twice in ~380 records.
  //
  // The controls that matter are the NEGATIVE ones: a four-fighter mirror match
  // is legal and present in this corpus, so identity alone must never fire.
  console.log('\n[4d] union slip — identical OVERSIZE sides, and only those');
  {
    const slip = (a: string[], b: string[]) =>
      a.length > 4 && [...a].sort().join(',') === [...b].sort().join(',');
    const eight = [
      'iron-man',
      'carnage',
      'danger',
      'ghost-rider',
      'champion',
      'blade',
      'loki',
      'spider-man',
    ];
    check(
      'catches identical 8+8 (the real etfJczrqGQ0 shape)',
      slip(eight, [...eight].reverse()),
      undefined,
    );
    check(
      'a 4-fighter MIRROR match is not a slip',
      !slip(
        ['spider-man', 'blade', 'carnage', 'magneto'],
        ['carnage', 'blade', 'spider-man', 'magneto'],
      ),
      'SPLYxPgwT5o is exactly this and is legal',
    );
    check(
      'a genuine 5-fighter mid-set change is not a slip',
      !slip(
        ['magik', 'storm', 'blade', 'carnage', 'loki'],
        ['danger', 'hulk', 'iron-man', 'magneto'],
      ),
      undefined,
    );
    check(
      'oversize sides that merely OVERLAP are not a slip',
      !slip(['magik', 'storm', 'blade', 'carnage', 'loki'], ['magik', 'storm', 'blade', 'carnage']),
      undefined,
    );
    // The corpus itself must be clean, so a future slip fails this run rather
    // than waiting for somebody to read report.md.
    const vids = JSON.parse(await readFile(join(ROOT, 'data', 'videos.json'), 'utf8')) as {
      id: string;
      sides: { characters: string[] }[];
    }[];
    const live = vids.filter((v) => slip(v.sides[0]!.characters, v.sides[1]!.characters));
    check(
      'no union slip survives in the committed corpus',
      live.length === 0,
      live.map((v) => v.id).join(', ') || 'clean',
    );
  }

  // ── 5. the review verdict — the only exit a queued record has ───────────────
  //
  // A character-completion record is held off the site entirely, and until the
  // verdict hook existed that was permanent by construction: absent from
  // videos.json, therefore absent from bench-queue.json, so neither the
  // extractor nor /dev/bench-review could reach it, and applyOverrides maps over
  // `records`, which it never enters. These controls drive a real parse run
  // through all three states.
  console.log('\n[5] review verdict — pending, rejected, adopted');
  {
    const parse = () => {
      try {
        execFileSync('npx', ['tsx', 'scripts/parse.ts'], {
          cwd: ROOT,
          stdio: 'pipe',
          encoding: 'utf8',
        });
        return 0;
      } catch (e) {
        return (e as { status?: number }).status ?? 1;
      }
    };
    const rawPath = join(ROOT, 'raw', 'proReplays.json');
    const ovPath = join(ROOT, 'data', 'overrides.json');
    const ID = 'CTLVERDICT1';
    // A title that PARSES as a match — two clean handles either side of a vs —
    // but names no fighter either side. That is exactly what reaches the queue.
    const bait = {
      id: ID,
      channel: 'proReplays',
      title: '🕹️ CTLALPHA vs CTLBETA 🕹️ MARVEL TOKON: Fighting Souls',
      description: 'MARVEL TOKON high level replay',
      publishedAt: '2026-08-11T00:00:00Z',
      durationSec: 600,
      viewCount: 10,
      liveBroadcastContent: 'none',
    };
    const original = JSON.parse(await readFile(rawPath, 'utf8')) as Record<string, unknown>[];
    const baseOv = JSON.parse(await readFile(ovPath, 'utf8')) as Record<string, unknown>;
    const readQueue = async () =>
      JSON.parse(await readFile(join(ROOT, 'data', 'review-queue.json'), 'utf8')) as {
        id: string;
      }[];
    const readVideos = async () =>
      JSON.parse(await readFile(join(ROOT, 'data', 'videos.json'), 'utf8')) as {
        id: string;
        sides: { characters: string[]; provenance: { tier: string } }[];
      }[];

    await writeFile(rawPath, JSON.stringify([...original, bait]));

    // 5a — PENDING. No verdict: it queues, and it must not reach the site. This
    // is the invariant e2e.ts asserts, restated here so it fails at the gate.
    await writeFile(ovPath, JSON.stringify(baseOv, null, 2));
    parse();
    let q = await readQueue();
    let vids = await readVideos();
    check(
      'with no verdict it queues for review',
      q.some((r) => r.id === ID),
      `${q.length} pending`,
    );
    check(
      'and a pending item NEVER reaches videos.json',
      !vids.some((r) => r.id === ID),
      undefined,
    );

    // 5b — REJECTED. `exclude` must remove it from the queue too, not just from
    // the corpus: a record nobody can publish and nobody can dismiss is the dead
    // end this whole surface exists to remove.
    await writeFile(ovPath, JSON.stringify({ ...baseOv, [ID]: { exclude: true } }, null, 2));
    parse();
    q = await readQueue();
    vids = await readVideos();
    check('a reject verdict clears it from the queue', !q.some((r) => r.id === ID), undefined);
    check('and it still never reaches videos.json', !vids.some((r) => r.id === ID), undefined);

    // 5c — ADOPTED. The verdict publishes the record at tier 'review', which
    // until now was a CharTier nothing in the codebase could produce.
    const sides = [0, 1].map((i) => ({
      player: `ctl${i}`,
      handle: `CTL${i === 0 ? 'ALPHA' : 'BETA'}`,
      characters: ['magik', 'storm', 'blade', 'carnage'],
      provenance: {
        tier: 'review',
        tiers: ['review'],
        fromTitle: [],
        fromHuman: ['magik', 'storm', 'blade', 'carnage'],
        slotOrder: 'handle-first',
        complete: true,
      },
    }));
    await writeFile(
      ovPath,
      JSON.stringify({ ...baseOv, [ID]: { sides, resolvedBy: 'human' } }, null, 2),
    );
    parse();
    q = await readQueue();
    vids = await readVideos();
    const adopted = vids.find((r) => r.id === ID);
    check('an adopted verdict publishes the record', !!adopted, adopted ? 'present' : 'ABSENT');
    check(
      "at tier 'review' — the tier nothing could reach before",
      adopted?.sides.every((sd) => sd.provenance.tier === 'review') === true,
      adopted?.sides.map((sd) => sd.provenance.tier).join(',') ?? '-',
    );
    check(
      'and it leaves the queue, so it is never both pending and published',
      !q.some((r) => r.id === ID),
      undefined,
    );

    /**
     * 5d — BENCH CONFLICT, the kind that used to publish while queued.
     *
     * The fixture states Magik in the title and a bench that omits her, on a
     * channel whose descriptions ARE read ('prose-comma'). The old behaviour
     * kept the union — Magik plus the whole bench — and shipped it, so the
     * record was pending and published at once. Nothing caught it for as long
     * as no channel produced a conflict; when fgcReplaysHub finally did, two
     * e2e assertions went red on data alone. A control belongs here so the next
     * regression fails at the gate instead of waiting on the corpus.
     */
    const CID = 'CTLCONFLICT1';
    const conflictBait = {
      id: CID,
      channel: 'proReplays',
      // Affix-fenced, unlike the 5a bait above: this control needs the HANDLES
      // to come out clean, because alignBench matches the description to the
      // title by handle correspondence first. Without the fence the game-name
      // tail rides into the second handle (38 chars — under the guard), the
      // alignment refuses, no bench is read, and the record publishes with no
      // conflict at all: a control that passes by never reaching its gate.
      title: 'Marvel Tokon ▰ CTLGAMMA (Magik) vs CTLDELTA (Storm) ▰ Pro level replays',
      // the bench for side 0 contradicts the title: no Magik
      description:
        'CTLGAMMA (Hulk, Blade, Carnage, Loki) vs CTLDELTA (Storm, Magneto, Danger, Doctor Doom)',
      publishedAt: '2026-08-11T00:00:00Z',
      durationSec: 600,
      viewCount: 10,
      liveBroadcastContent: 'none',
    };
    await writeFile(rawPath, JSON.stringify([...original, conflictBait]));
    await writeFile(ovPath, JSON.stringify(baseOv, null, 2));
    parse();
    q = await readQueue();
    vids = await readVideos();
    const queued = q.find((r) => r.id === CID) as
      | { conflict?: { fromTitle: string[]; fromDescription: string[] } }
      | undefined;
    check(
      'a title/description disagreement queues as bench-conflict',
      !!queued,
      queued ? 'queued' : 'ABSENT',
    );
    check(
      'and it is WITHHELD — the union never reaches videos.json',
      !vids.some((r) => r.id === CID),
      vids.some((r) => r.id === CID) ? 'PUBLISHED (the old bug)' : 'absent',
    );
    check(
      'the queue entry carries both tiers, so the reviewer sees the disagreement',
      queued?.conflict?.fromTitle.includes('magik') === true &&
        queued?.conflict?.fromDescription.includes('magik') === false,
      `title=${queued?.conflict?.fromTitle.join('/')} desc=${queued?.conflict?.fromDescription.join('/')}`,
    );

    /**
     * 5e — the OTHER char-completion branch, which had no control.
     *
     * parse.ts holds records back at three points: a title with no parens at
     * all (5a covers it), a title whose character slot resolves to NOTHING on
     * the roster, and a bench conflict (5d). Only the first was controlled.
     * Found by deleting the second's `continue` while proving 5d could fail —
     * every gate still reported green, which is the exact condition this file
     * exists to make impossible.
     *
     * "Sentinel" is the fixture on purpose: an unknown name is also what a real
     * DLC fighter looks like on the day it ships, so this doubles as the
     * control for the record NOT being published under a half-empty side while
     * the roster catches up.
     */
    const UID = 'CTLUNRESOLVED1';
    await writeFile(
      rawPath,
      JSON.stringify([
        ...original,
        {
          id: UID,
          channel: 'proReplays',
          title: 'Marvel Tokon ▰ CTLEPSILON (Sentinel) vs CTLZETA (Storm) ▰ Pro level replays',
          description: 'MARVEL TOKON high level replay',
          publishedAt: '2026-08-11T00:00:00Z',
          durationSec: 600,
          liveBroadcastContent: 'none',
        },
      ]),
    );
    await writeFile(ovPath, JSON.stringify(baseOv, null, 2));
    parse();
    q = await readQueue();
    vids = await readVideos();
    check(
      'a title naming an unknown fighter queues rather than publishing a short side',
      q.some((r) => r.id === UID) && !vids.some((r) => r.id === UID),
      `queued=${q.some((r) => r.id === UID)} published=${vids.some((r) => r.id === UID)}`,
    );

    await writeFile(rawPath, JSON.stringify(original, null, 1));
  }
} finally {
  await restoreAll();
  console.log('\n  … data/ and raw/ restored from the pre-control snapshot');
}

console.log(failures ? `\n✗ ${failures} CONTROL(S) FAILED` : '\n✓ EVERY GATE POSITIVE-CONTROLLED');
process.exit(failures ? 1 : 0);
