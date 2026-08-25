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

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { buildAliasMatcher, loadCharacters, stripLeaderboard } from './roster';
import { alignBench, readBench } from './bench';
import { emitGeneric } from './emit';
import { buildPatchGroups, validatePatches } from './patches';
import type { MatchVideo, PlayerRecord } from '../types/index';

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
    const good = [
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
    bad((p) => ((p[1]!.version = '2026-08-11'), p), 'token !== start is rejected');
    bad(
      (p) => ((p[1]!.start = '2030-01-01'), (p[1]!.version = '2030-01-01'), p),
      'a future date is rejected',
    );
    bad(
      (p) => ((p[1]!.start = '2026-08-05'), (p[1]!.version = '2026-08-05'), p),
      'a pre-launch date is rejected',
    );
    bad((p) => [p[1]!], 'an era with no opening patch is rejected');

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
} finally {
  await restoreAll();
  console.log('\n  … data/ and raw/ restored from the pre-control snapshot');
}

console.log(failures ? `\n✗ ${failures} CONTROL(S) FAILED` : '\n✓ EVERY GATE POSITIVE-CONTROLLED');
process.exit(failures ? 1 : 0);
