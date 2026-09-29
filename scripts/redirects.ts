/**
 * Keep retired player URLs alive.
 *
 * Merging two spellings of one player deletes a page. Every player profile is
 * PRERENDERED and listed in sitemap.xml (nuxt.config.ts seeds the routes;
 * replay-engine/modules/static-artifacts.ts writes the sitemap), so a retired id
 * is an indexed URL that becomes a hard 404 — replay-engine's players/[id].vue
 * throws createError({ statusCode: 404 }) the moment the registry has no entry.
 *
 * There is no redirect layer anywhere on this platform. This is it.
 *
 * THE DESTINATION MUST BE RELATIVE. The shell rewrites /tokon/:path* to this
 * deployment (replay-database-shell/vercel.json), so an absolute destination
 * would answer a request for replaydatabase.com with a Location pointing at
 * tokon-replay-database.vercel.app and throw the visitor off the real site. A
 * leading-slash destination resolves against whatever origin the browser is on,
 * which is the shell's.
 *
 * THE CRON WRITES vercel.json NOW, and this paragraph used to say the opposite:
 * "MANUAL, not part of the cron — vercel.json is build configuration, and the
 * daily data commit has no business touching it", because a data refresh that
 * quietly changes routing was judged worse than one that changes data. That rule
 * left the routing to a human while the ledger it is derived from moved on its
 * own (below), and it cost live 404s twice in one week — five merged players
 * here, found and fixed on 2026-09-24 (693007b), then Tekken's voila-99 on
 * 2026-09-27. Across 2026-07-28 → 09-28 a ledger row sat in
 * a commit without its vercel.json rule on 17 commit-days here (five rows at the
 * worst) and 5 in Tekken. The rule is derived mechanically from a row parse.ts
 * has already written, so leaving it out is not caution; it IS the 404. So since
 * 2026-09-28 the cron runs `npm run data:redirects` before its commit, stages
 * vercel.json with the ledger, and then runs `--drift`, which refuses the commit
 * outright — holding the whole day's data — if anything cannot ship. A held run
 * must be a two-minute fix from the log alone, so every refusal names the row
 * and its fix.
 *
 * WHY THE LEDGER MOVES ON ITS OWN, and why an older version of this header got
 * it wrong: it said the retired set only changes when a person edits
 * scripts/players.ts. It does not. parse.ts grows data/player-redirects.json
 * from its OWN automatic player merges (see the ledger comment there — "the
 * ledger MERGES with what is already committed and never shrinks"), and the cron
 * commits that file nightly. That misreading is how seventeen redirects went
 * missing here by 2026-09-10 before anyone looked, and `--check` living only
 * inside `npm run typecheck`, which the cron does not run, is why nobody did.
 *
 * NO RETIREMENT GUARD HERE, unlike Tekken's: nothing refuses an id that leaves
 * data/players.json without a ledger row at all (22 did across 2026-07-28 →
 * 09-28). That is its own design problem — a merge wants a redirect, an upstream
 * deletion has nowhere to point — and it is not this file's yet.
 *
 * Run: npm run data:redirects   write vercel.json from the ledger (the cron's
 *                               "Regenerate player redirects" step)
 *      --drift                  verify, never write: bad rows, lost rows,
 *                               vercel.json out of step with the ledger (the
 *                               cron's pre-commit "Refuse redirect drift" step)
 *      --check                  the same checks, for npm run typecheck
 */

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/tokon';

interface Redirect {
  source: string;
  destination: string;
  permanent: boolean;
}

// --drift and --check verify the same things and never write. They stay two
// names so the cron's step reads the same in every repo; in Tekken --check also
// runs a retirement guard that this repo does not have.
const drift = process.argv.includes('--drift');
const check = drift || process.argv.includes('--check');

// A person can let a lost row go once, in the open — for the rare row a
// retarget cannot save — named the way this platform's other refusals are
// (`--allow-collapse`, `--allow-shrink`, Tekken's `--allow-retire`).
const allowIdx = process.argv.indexOf('--allow-retire');
const allowed = new Set(
  allowIdx === -1 ? [] : (process.argv[allowIdx + 1] ?? '').split(',').map((x) => x.trim()),
);

// Read the LEDGER, never recompute from the corpus: the retired spellings are
// gone from data/videos.json by the time this runs, and an id whose last record
// was deleted upstream still needs its redirect. parse.ts maintains it.
const ledger = JSON.parse(
  await readFile(join(ROOT, 'data', 'player-redirects.json'), 'utf8'),
) as Record<string, string>;

/**
 * YESTERDAY'S COPY OF A DATA FILE, and the baseline is git because there is no
 * other record of it: the working tree when the file is uncommitted (the moment
 * a change is about to be committed, which is when the cron's gate fires for
 * real), and HEAD~1 when it is not. Both are absent in a shallow or non-git
 * checkout, and the caller SAYS SO rather than passing quietly — a guard that
 * reports nothing is indistinguishable from a guard that found nothing.
 */
function baseline(path: string): { where: string; text: string } | null {
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    // Uncommitted edits mean HEAD still holds yesterday's; with a clean tree the
    // change is already committed, so yesterday's is HEAD~1.
    const where = git('status', '--porcelain', '--', path).trim() !== '' ? 'HEAD' : 'HEAD~1';
    return { where, text: git('show', `${where}:${path}`) };
  } catch {
    return null;
  }
}

// Where a retired id's redirect should land: follow the ledger until it reaches
// a live player. null when the trail ends in an id that is neither live nor
// redirected (the player left the corpus outright), or loops.
function successor(id: string, live: Set<string>, led: Record<string, string>): string | null {
  const seen = new Set<string>();
  let at = id;
  while (!live.has(at)) {
    if (seen.has(at) || led[at] === undefined) return null;
    seen.add(at);
    at = led[at];
  }
  return at;
}

/**
 * A ROW THAT CANNOT SHIP, named with its fix. A row goes bad two ways, and each
 * is a URL answering wrong:
 *   - its SOURCE is a live player: the redirect would send a real profile away.
 *     A merge that stops happening leaves exactly this behind, because parse.ts
 *     only ever drops a row for its destination.
 *   - its DESTINATION is not a live player: a redirect into a 404, which is worse
 *     than the 404 it replaces because it spends the visitor's request to arrive
 *     at the same place. parse.ts drops those rather than writing them, so this
 *     fires on a hand-added row, or on a destination merged away since.
 * The fix for a dead destination is almost always a RETARGET to wherever the
 * ledger now sends it, so the refusal works that out instead of leaving the
 * reader to.
 */
function rowsThatCannotShip(live: Set<string>, led: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [from, to] of Object.entries(led)) {
    if (live.has(from)) {
      out.push(
        `"${from}": "${to}"\n` +
          `      ${from} is a live player, so this redirect would send its profile away.\n` +
          `      fix: retire the row (delete it).`,
      );
    } else if (!live.has(to)) {
      const next = successor(to, live, led);
      out.push(
        `"${from}": "${to}"\n` +
          `      ${to} is not a player, so this redirect would land on a 404.\n` +
          (next
            ? `      fix: retarget it to "${next}" (the ledger sends ${to} on to ${next}),\n`
            : `      fix: retarget it to the live id ${from} belongs to,\n`) +
          `           or retire it (delete the row; ${BASE}/players/${from} then answers 404).`,
      );
    }
  }
  return out;
}

/**
 * A ROW THAT LEFT THE LEDGER is a redirect that stopped, and parse.ts can do that
 * on its own despite "a row leaves it only by hand": its write drops a row whose
 * DESTINATION is no longer a player, so when a merge target is itself merged
 * later (x → y, then y → z) the x → y row is dropped rather than carried on to
 * z, and x's indexed URL 404s with the ledger and vercel.json in perfect
 * agreement — the one failure a sync check cannot see.
 *
 * Two kinds of drop are fine, and both are let through: the source is live again
 * (a flip — mr-marben on 2026-09-09 and majin-burno on 09-12 here, and g-bob in
 * Tekken, are every drop so far), or the trail ends in a player who left the
 * corpus, where the dropped redirect pointed at a 404 anyway. Refused is the one
 * a retarget would have kept.
 */
function lostRows(live: Set<string>, led: Record<string, string>): string[] | null {
  const base = baseline('data/player-redirects.json');
  if (!base) return null;
  const was = JSON.parse(base.text) as Record<string, string>;
  const out: string[] = [];
  for (const [from, to] of Object.entries(was)) {
    if (led[from] !== undefined || live.has(from) || allowed.has(from)) continue;
    const next = successor(to, live, led);
    if (next === null) continue;
    out.push(
      `"${from}": "${to}"  (in the ledger at ${base.where}, gone now)\n` +
        `      ${from} is still retired, so ${BASE}/players/${from} loses its redirect and answers 404.\n` +
        (next === to
          ? `      fix: put the row back.`
          : `      fix: put the row back retargeted: "${from}": "${next}".`),
    );
  }
  return out;
}

const playerRedirects: Redirect[] = Object.entries(ledger)
  .map(([from, to]) => ({
    source: `${BASE}/players/${from}`,
    destination: `${BASE}/players/${to}`,
    permanent: true,
  }))
  .sort((a, b) => a.source.localeCompare(b.source));

const cfgPath = join(ROOT, 'vercel.json');
const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as {
  redirects?: Redirect[];
  [k: string]: unknown;
};

// Everything that is NOT a generated player redirect is hand-authored and kept
// verbatim — the "/" → "/tokon" entry lives here too.
const manual = (cfg.redirects ?? []).filter((r) => !r.source.startsWith(`${BASE}/players/`));
const next = [...manual, ...playerRedirects];

const before = JSON.stringify(cfg.redirects ?? []);
const after = JSON.stringify(next);

// vercel.json against the ledger, rule by rule, so the refusal can say WHICH.
function outOfStep(): string[] {
  const want = new Map(playerRedirects.map((r) => [r.source, r.destination]));
  const have = new Map(
    (cfg.redirects ?? [])
      .filter((r) => r.source.startsWith(`${BASE}/players/`))
      .map((r) => [r.source, r.destination]),
  );
  const out: string[] = [];
  for (const [source, destination] of want) {
    const is = have.get(source);
    if (is === undefined) out.push(`vercel.json is missing  ${source} → ${destination}`);
    else if (is !== destination) out.push(`vercel.json sends  ${source} → ${is}, but the ledger says ${destination}`);
  }
  for (const [source, is] of have) {
    if (!want.has(source)) out.push(`vercel.json still has  ${source} → ${is}, which no ledger row asks for`);
  }
  if (out.length === 0 && before !== after) out.push('vercel.json has every player redirect, but not in the generated form');
  return out;
}

if (check) {
  const live = new Set(
    (
      JSON.parse(await readFile(join(ROOT, 'data', 'players.json'), 'utf8')) as { id: string }[]
    ).map((p) => p.id),
  );
  const bad = rowsThatCannotShip(live, ledger);
  const lostOrSkipped = lostRows(live, ledger);
  if (lostOrSkipped === null) {
    console.log('  (no git baseline for data/player-redirects.json — lost-row check skipped)');
  }
  const lost = lostOrSkipped ?? [];
  const stale = outOfStep();
  if (bad.length > 0 || lost.length > 0 || stale.length > 0) {
    const blocks: string[] = [];
    if (bad.length > 0) {
      blocks.push(
        `  ${bad.length} row(s) in data/player-redirects.json cannot ship:\n\n` +
          bad.map((r) => `    ${r}`).join('\n\n'),
      );
    }
    if (lost.length > 0) {
      blocks.push(
        `  ${lost.length} row(s) left data/player-redirects.json and took a live redirect with them:\n\n` +
          lost.map((r) => `    ${r}`).join('\n\n'),
      );
    }
    if (stale.length > 0) blocks.push(stale.map((s) => `  ${s}`).join('\n'));
    console.error(
      `✖ REDIRECT DRIFT — ${drift ? 'this run commits nothing' : 'not shippable as it stands'}.\n\n` +
        blocks.join('\n\n'),
    );
    console.error(
      '\n  To clear it (a two-minute fix, from a fresh pull):\n' +
        (bad.length > 0 || lost.length > 0
          ? '    1. Edit data/player-redirects.json as above. parse.ts carries hand edits\n' +
            '       forward: its write merges with the committed ledger.\n'
          : '    1. (No row to edit; vercel.json only needs regenerating.)\n') +
        '    2. npm run data:redirects                  (rewrites vercel.json from the ledger)\n' +
        '    3. npx tsx scripts/redirects.ts --drift    (must print ✓)\n' +
        '    4. Commit both files and push, then re-run "Daily data refresh" from the\n' +
        "       Actions tab, or leave it to tomorrow's run. A held day loses nothing:\n" +
        '       every run re-fetches every upload.',
    );
    process.exit(1);
  }
  console.log(
    `✓ all ${Object.keys(ledger).length} ledger row(s) ship, and vercel.json carries every one`,
  );
  process.exit(0);
}

cfg.redirects = next;
await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

console.log(
  `✓ vercel.json — ${manual.length} hand-authored redirect(s) kept, ` +
    `${playerRedirects.length} player redirect(s) generated`,
);
for (const r of playerRedirects) console.log(`    ${r.source}  →  ${r.destination}`);
