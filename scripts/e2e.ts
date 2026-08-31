/**
 * The audit suite — substrate invariants, then the BUILT site in a browser,
 * then the cron guard in a scratch git repo.
 *
 * Prereq: npm run generate        Run: npm run test:e2e
 *
 * Three things about the shape, each learned rather than chosen:
 *
 *  · It does NOT build. It serves `.vercel/output/static` exactly as Vercel
 *    does — from the STATIC ROOT, addressing pages under the base — because
 *    re-rooting the server at the base dir resolves the site's own absolute
 *    `/tokon/_nuxt/…` URLs to 404s and turns a passing suite into a lie.
 *  · The harness counts, it does not throw. Every assertion runs even after one
 *    fails, so a run tells you everything that is wrong rather than the first
 *    thing.
 *  · Anything that can be checked WITHOUT a browser is checked first. A
 *    desynced queue or a fabricated usage total fails in seconds instead of
 *    after a Chrome launch.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from 'playwright-core';

import { idKey } from './roster';
import { CHAR_TIERS } from '../types/index';
import { DISTINCT_KEYS } from './players';
import { CHANNELS } from './channels';
import { PATCHES, SEASONS, seasonToken } from './patches';
import type {
  BenchQueueItem,
  CharacterRecord,
  MatchVideo,
  PlayerRecord,
  ReviewQueueItem,
} from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.vercel/output/static');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

function detectBase(): string {
  if (existsSync(join(OUT, 'index.html'))) return '';
  for (const name of readdirSync(OUT)) {
    if (existsSync(join(OUT, name, 'index.html'))) return `/${name}`;
  }
  throw new Error(
    `no prerendered index.html under ${OUT} — run \`npm run generate\` before \`npm run test:e2e\``,
  );
}
const BASE = detectBase();

// ── the committed substrate ─────────────────────────────────────────────────
const read = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, 'data', p), 'utf8')) as T;
const videos = read<MatchVideo[]>('videos.json');
const replays = read<
  {
    id: string;
    sides: { player: string; characters: string[] }[];
    patch?: string;
    source: string;
    date: string;
    /** Present only on a segment record — see the segment blocks below. */
    videoId?: string;
    startSeconds?: number;
  }[]
>('replays.json');
const characters = read<CharacterRecord[]>('characters.json');
const players = read<PlayerRecord[]>('players.json');
const stats = read<{
  totals: Record<string, unknown>;
  characterUsage: Record<string, number>;
  byPatchUsage: Record<string, Record<string, number>>;
  playerCharacters: Record<string, Record<string, number>>;
}>('stats.json');
const summary = read<{
  game: string;
  name: string;
  replays: number;
  players: number;
  characters: number;
  updated: string | null;
}>('summary.json');
const queue = read<ReviewQueueItem[]>('review-queue.json');
const bench = read<BenchQueueItem[]>('bench-queue.json');
const reportMd = readFileSync(join(ROOT, 'data', 'report.md'), 'utf8');

const charIds = new Set(characters.map((c) => c.id));
const playerIds = new Set(players.map((p) => p.id));
const videoIds = new Set(videos.map((v) => v.id));
const emittedIds = new Set(replays.map((r) => r.id));
const SOURCES = CHANNELS.map((c) => c.source);

// ── harness ─────────────────────────────────────────────────────────────────
let passed = 0;
const failures: string[] = [];
const expect = (ok: boolean, label: string): void => {
  if (ok) passed += 1;
  else failures.push(label);
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serve(): Promise<{ at: (p: string) => string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    for (const file of [join(OUT, path), join(OUT, path, 'index.html'), join(OUT, '404.html')]) {
      try {
        const body = readFileSync(file);
        res.writeHead(file.endsWith('404.html') && !path.endsWith('404.html') ? 404 : 200, {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        });
        res.end(body);
        return;
      } catch {
        /* next candidate */
      }
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      const origin = `http://127.0.0.1:${port}`;
      // Serve the static ROOT (as Vercel does) and address pages under the
      // base — never re-root the server at the base dir, which would resolve
      // the site's own absolute /<base>/_nuxt/… asset URLs to 404s.
      resolve({ at: (p: string) => `${origin}${BASE}${p}`, close: () => server.close() });
    });
  });
}

const gotoIdle = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
};

// ════════════════════════════════════════════════════════════════════════════
// 0. SUBSTRATE — Node only, before any browser
// ════════════════════════════════════════════════════════════════════════════
function testSubstrate(): void {
  console.log('\n— substrate (no browser)');

  // config ↔ pipeline mirror
  const appConfig = readFileSync(join(ROOT, 'app/app.config.ts'), 'utf8');
  for (const token of SOURCES) {
    expect(appConfig.includes(`'${token}'`), `app.config declares source '${token}'`);
  }
  expect(
    characters.every(
      (c) => appConfig.includes(`'${c.id}'`) || appConfig.includes(`\n      ${c.id}:`),
    ),
    'app.config carries an accent for every roster id',
  );

  // ── player identity ───────────────────────────────────────────────────────
  // One player, one page. idKey collapses spelling variants at parse time; this
  // asserts the result, because the failure is invisible from the site — two
  // profiles for one person both render correctly, each holding some of the
  // matches, and nothing looks broken from either one.
  expect(
    players.every((p) => p.id.length > 0),
    'every player id is non-empty',
  );
  expect(new Set(players.map((p) => p.id)).size === players.length, 'player ids are unique');
  const keyCollisions = new Map<string, string[]>();
  for (const p of players) {
    const k = idKey(p.handle);
    keyCollisions.set(k, [...(keyCollisions.get(k) ?? []), p.handle]);
  }
  const undeclared = [...keyCollisions.entries()].filter(
    ([k, hs]) => hs.length > 1 && !DISTINCT_KEYS.has(k),
  );
  expect(
    undeclared.length === 0,
    `no two players share a normalised key undeclared${
      undeclared.length
        ? ` (${undeclared.map(([k, hs]) => `${k}: ${hs.join('/')}`).join(', ')})`
        : ''
    }`,
  );
  // union round-trip: videos.json → replays.json, IN ORDER
  const drift = videos.filter((v, i) =>
    v.sides.some(
      (s, j) => s.characters.join(',') !== (replays[i]?.sides[j]?.characters ?? []).join(','),
    ),
  );
  expect(
    drift.length === 0,
    `every side round-trips videos.json → replays.json in order (${drift.length} drifted)`,
  );

  // the contract: 1..N, hard-fail only on 0
  expect(
    replays.every((r) => r.sides.every((s) => s.characters.length > 0)),
    'no emitted record has a side with zero characters',
  );
  expect(
    replays.every((r) => r.sides.every((s) => s.characters.every((c) => charIds.has(c)))),
    'every emitted character id is on the roster',
  );
  expect(
    replays.every((r) => r.sides.every((s) => playerIds.has(s.player))),
    'every emitted player id is in players.json',
  );

  // THE 4v4 ASSERTION. At charactersPerSide 4 this is the only thing that
  // catches a side of four being counted once — `records × N` would be wrong
  // in both directions here, since sides are 1..4 while the bench fills in.
  const usageSum = Object.values(stats.characterUsage).reduce((a, b) => a + b, 0);
  const expectedUsage = videos.reduce(
    (n, v) => n + v.sides.reduce((m, s) => m + s.characters.length, 0),
    0,
  );
  expect(
    usageSum === expectedUsage,
    `characterUsage is the summed side lengths, not records × N (${usageSum} === ${expectedUsage})`,
  );
  expect(
    usageSum !== videos.length * 8,
    'characterUsage is NOT records × 8 (would mean fabricated fills)',
  );

  // provenance — substrate only, and it must never reach the public contract
  const provDrift = videos.filter((v) =>
    v.sides.some((s) => !s.provenance || !s.provenance.fromTitle),
  );
  expect(provDrift.length === 0, 'every side carries provenance');

  // `complete` MUST be `length >= charactersPerSide`, never `=== `. `characters`
  // is a union of 1..N in first-appearance order, so a mid-set team change
  // legitimately pushes a side past the cap — this corpus carries 7 such sides
  // and emit.ts accepts them by design. A side above the cap is MORE than
  // complete; calling it incomplete puts finished work back in the bench queue
  // and tells /dev a reviewer still owes it a bench.
  //
  // Latent rather than historical: every oversize side here arrived through a
  // /dev override, and those endpoints already said `>= 4`. parse.ts said
  // `=== 4`, so the same side meant different things depending on which path
  // last touched it, and a title+description union that overshot the cap on its
  // own — fromTitle naming a fighter the description bench omits — would have
  // been born incomplete. This is the invariant, checked over what is committed
  // rather than over which writer happened to run.
  const miscounted = videos.flatMap((v) =>
    v.sides
      .filter((s) => s.characters.length >= 4 && s.provenance?.complete === false)
      .map((s) => `${v.id} (${s.characters.length} chars)`),
  );
  expect(
    miscounted.length === 0,
    `no side at or above the cap is marked incomplete${miscounted.length ? ` — ${miscounted.slice(0, 3).join(', ')}` : ''}`,
  );
  const oversize = videos.flatMap((v) => v.sides.filter((s) => s.characters.length > 4));
  expect(
    oversize.every((s) => s.provenance?.complete === true),
    `every oversize side (${oversize.length}) is complete, not incomplete`,
  );
  const conflictFree = videos.filter((v) =>
    v.sides.some(
      (s) =>
        !s.provenance.conflict && !s.provenance.fromTitle.every((c) => s.characters.includes(c)),
    ),
  );
  expect(conflictFree.length === 0, 'fromTitle ⊆ characters on every non-conflicted side');
  expect(
    !JSON.stringify(replays).includes('provenance'),
    'provenance never reaches replays.json (substrate/contract boundary holds)',
  );
  const tiers = new Set(videos.flatMap((v) => v.sides.map((s) => s.provenance.tier)));
  expect(
    [...tiers].every((t) => (CHAR_TIERS as readonly string[]).includes(t)),
    `every provenance tier is in the union (${[...tiers].sort().join(', ')})`,
  );

  // THE ASSERTION THAT CAUGHT THE FIFTH GRAMMAR. Player handles came from a
  // title slot that actually held fighter names; nothing else noticed.
  //
  // SOME PEOPLE ARE JUST NAMED AFTER A FIGHTER, and the check cannot tell that
  // from a parse error — both produce a player whose handle is a roster name.
  // So the exception is a NAMED LIST WITH ITS EVIDENCE rather than a softened
  // rule: the assertion keeps its full strength for every handle nobody has
  // vouched for, and each entry here records who confirmed it and from what.
  //
  // Adding to this list is a human verdict, not a way to make the suite green.
  // The test is: does the TITLE parse cleanly with the fighter in its own slot?
  // If it does, the handle is really that person's name. If it does not, the
  // handle is wreckage from a slot boundary and belongs in the review queue.
  const CONFIRMED_FIGHTER_HANDLES = new Map<string, string>([
    [
      'deadpool',
      // "MARVEL TOKON ▰ GR7 (#1 Ranked Peni Parker) vs DEADPOOL (Magik) ▰ …"
      // (fcUF-QsUdz0, replaysHub). Handle-then-paren, Magik in its own slot —
      // the parse is right and the player is called DEADPOOL. Confirmed by the
      // maintainer 2026-08-26.
      'fcUF-QsUdz0 — clean handle/paren split, player is genuinely named DEADPOOL',
    ],
  ]);
  const rosterNames = new Set(characters.map((c) => c.name.toLowerCase()));
  const collisions = players.filter(
    (p) =>
      rosterNames.has(p.handle.toLowerCase()) &&
      !CONFIRMED_FIGHTER_HANDLES.has(p.handle.toLowerCase()),
  );
  expect(
    collisions.length === 0,
    `no player handle is a fighter name (${collisions.map((c) => c.handle).join(', ') || 'clean'}` +
      `${CONFIRMED_FIGHTER_HANDLES.size ? `; ${CONFIRMED_FIGHTER_HANDLES.size} confirmed real` : ''})`,
  );

  // ITS SIBLING, AND THE ONE THAT WOULD HAVE CAUGHT THE BRACKET TAIL. A title
  // affix that survives into a handle is invisible in every count: it mints a
  // plausible-looking player page, and once it pushes the handle past 40 chars
  // the bad-handle guard deletes the record instead. 12 handles carried
  // "[MARVEL TŌKON: Fighting Souls]" until BRACKET_TAIL_RE covered both bracket
  // families; 3 records were being dropped outright.
  const bracketed = players.filter((p) => /[[\]【】「」《》]/u.test(p.handle));
  expect(
    bracketed.length === 0,
    `no player handle contains a bracket (${bracketed.map((b) => b.handle).join(', ') || 'clean'})`,
  );

  // queues — two of them, and they mean different things
  const KINDS = new Set(['character-completion', 'bench-conflict', 'slot-ambiguous']);
  expect(
    queue.every(
      (q) =>
        typeof q.id === 'string' && KINDS.has(q.kind) && /^\d{4}-\d{2}-\d{2}T/.test(q.publishedAt),
    ),
    `review-queue.json schema validates (${queue.length} pending)`,
  );
  expect(
    queue.every((q) => !videoIds.has(q.id)),
    'pending review items never reach videos.json',
  );
  expect(
    queue.every((q) => !emittedIds.has(q.id)),
    'pending review items never reach replays.json',
  );
  // The bench queue is the INVERSE invariant: those records MUST ship.
  expect(
    bench.every((b) => emittedIds.has(b.id)),
    `every bench-queue record IS published (${bench.length} incomplete but publishable)`,
  );
  expect(
    bench.every((b) => b.known.some((n) => n < 4) && b.known.every((n) => n >= 1)),
    'every bench-queue record is genuinely partial (1..3 on a side), never empty',
  );

  // report.md is generated from these numbers — assert it agrees
  const qm = /review queue \(never published\): \*\*(\d+)\*\*/.exec(reportMd);
  expect(
    qm !== null && Number(qm[1]) === queue.length,
    `report.md review count matches the queue (${queue.length})`,
  );
  const bm = /bench queue \(published, incomplete\): \*\*(\d+)\*\*/.exec(reportMd);
  expect(
    bm !== null && Number(bm[1]) === bench.length,
    `report.md bench count matches the queue (${bench.length})`,
  );

  // patch tokens
  const tokens = new Set([
    ...PATCHES.map((p) => p.version),
    ...SEASONS.map((s) => seasonToken(s.season)),
  ]);
  expect(
    replays.every((r) => tokens.has(r.patch!)),
    'every emitted patch token is declared',
  );
  expect(
    Object.keys(stats.byPatchUsage).every((k) => tokens.has(k)),
    'byPatchUsage keys are declared tokens',
  );

  // summary
  expect(
    summary.game === 'tokon' && summary.name === 'MARVEL Tōkon: Fighting Souls',
    'summary identity matches app.config',
  );
  expect(summary.replays === replays.length, `summary.replays matches (${summary.replays})`);
  expect(
    summary.characters === characters.length && summary.players === players.length,
    'summary registry counts match',
  );
  const newest = videos.reduce((m, v) => (v.publishedAt > m ? v.publishedAt : m), '').slice(0, 10);
  expect(
    summary.updated === newest,
    `summary.updated is the newest replay date, not build time (${summary.updated})`,
  );

  // ── segment records ───────────────────────────────────────────────────────
  // An INDEX intake publishes many records per VOD, so its ids are composite
  // and its records are the only ones here whose `id` is not a YouTube id.
  // Every number below is COMPUTED from the committed data — there is no
  // hardcoded 44 — so the block keeps meaning the same thing as the catalogue
  // grows, and it self-skips if the intake is ever removed.
  const segments = videos.filter((v) => v.videoId !== undefined);
  if (segments.length > 0) {
    const COMPOSITE = /^([A-Za-z0-9_-]{11})@(\d+)$/;
    const malformed = segments.filter((v) => {
      const m = COMPOSITE.exec(v.id);
      return !m || m[1] !== v.videoId || Number(m[2]) !== (v.startSeconds ?? 0);
    });
    expect(
      malformed.length === 0,
      `every segment id is \`videoId@startSeconds\` and agrees with its own fields (${malformed
        .slice(0, 3)
        .map((v) => v.id)
        .join(', ')})`,
    );

    // A composite id can never equal an 11-character YouTube id, which is what
    // makes the ignore-if-known rule key on videoId rather than id — assert the
    // property that reasoning rests on rather than trusting it.
    const wholeVideoIds = new Set(videos.filter((v) => v.videoId === undefined).map((v) => v.id));
    const clashing = segments.filter((v) => wholeVideoIds.has(v.id));
    expect(clashing.length === 0, 'no segment id collides with a whole-video record id');

    const perVod = new Map<string, number>();
    for (const v of segments) perVod.set(v.videoId!, (perVod.get(v.videoId!) ?? 0) + 1);
    expect(
      [...perVod.values()].some((n) => n > 1),
      `at least one VOD is shared by several records (max ${Math.max(...perVod.values())})`,
    );

    // The whole point of the intake: these VODs are NOT in the corpus as
    // records of their own. If one ever is, ignore-if-known should have
    // dropped its segments.
    const vodAlsoARecord = [...perVod.keys()].filter((id) => wholeVideoIds.has(id));
    expect(
      vodAlsoARecord.length === 0,
      `no source VOD is also a record in its own right (${vodAlsoARecord.join(', ') || 'clean'})`,
    );

    // ROUND-TRIP INTO THE EMITTED CONTRACT. videoId must survive independently
    // of startSeconds: 0 is falsy, and the engine resolves `videoId ?? id`, so
    // a first-segment record that lost videoId would derive its thumbnail and
    // its embed from the literal string "abc@0".
    const byId = new Map(replays.map((r) => [r.id, r]));
    const missingVideoId = segments.filter((v) => byId.get(v.id)?.videoId !== v.videoId);
    expect(
      missingVideoId.length === 0,
      `every segment carries videoId into replays.json (${missingVideoId.length} missing)`,
    );
    const badStart = segments.filter((v) => {
      const r = byId.get(v.id);
      return (v.startSeconds ?? 0) > 0
        ? r?.startSeconds !== v.startSeconds
        : r?.startSeconds !== undefined;
    });
    expect(
      badStart.length === 0,
      'startSeconds is emitted when non-zero and omitted when zero (the falsy-0 contract)',
    );

    // The pin is the carry's only check on a cron run, so a pin that has
    // drifted from the committed corpus is the failure the carry cannot see.
    const pins = JSON.parse(readFileSync(join(ROOT, 'data/source-pins.json'), 'utf8')) as Record<
      string,
      number
    >;
    for (const ch of CHANNELS.filter((c) => c.localFirst)) {
      const n = videos.filter((v) => v.intake === ch.id).length;
      expect(
        pins[ch.id] === n,
        `data/source-pins.json pins ${ch.id} at its committed count (${pins[ch.id]} vs ${n})`,
      );
    }

    // Duration-less records are exactly the index intakes, and the dupe audit
    // knows it. If a fetched channel ever starts emitting 0s durations, the
    // third pass in replay-dupes.ts silently becomes the wrong tool for them.
    const indexIntakes = new Set(CHANNELS.filter((c) => c.index).map((c) => c.id));
    const zeroDurOutside = videos.filter((v) => v.durationSec <= 0 && !indexIntakes.has(v.intake));
    expect(
      zeroDurOutside.length === 0,
      `only an index intake publishes records with no duration (${zeroDurOutside.length} outside)`,
    );
  }

  // dupe audit — the signature MUST stay semantically identical to
  // scripts/replay-dupes.ts, or this gate stops checking what that finds
  const signature = (v: MatchVideo) =>
    v.sides
      .map((s) => `${s.player}|${[...s.characters].sort().join(',')}`)
      .sort()
      .join('~');
  const bySig = new Map<string, MatchVideo[]>();
  for (const v of videos) {
    if (v.durationSec <= 0) continue;
    if (!v.sides.every((s) => s.characters.length >= 2)) continue;
    const k = signature(v);
    bySig.set(k, [...(bySig.get(k) ?? []), v]);
  }
  const offenders: string[] = [];
  for (const list of bySig.values()) {
    if (list.length < 2) continue;
    const s = [...list].sort((a, b) => a.durationSec - b.durationSec);
    for (let i = 1; i < s.length; i++) {
      if (s[i]!.durationSec - s[i - 1]!.durationSec <= 1 && s[i]!.intake !== s[i - 1]!.intake) {
        offenders.push(`${s[i - 1]!.id} ~ ${s[i]!.id}`);
      }
    }
  }
  expect(
    offenders.length === 0,
    `no unresolved cross-channel duplicate (${offenders.join(', ') || 'clean'})`,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// the cron commit guard — shell, so only shell can test it
// ════════════════════════════════════════════════════════════════════════════
function testCronGuard(): void {
  console.log('\n— cron commit guard (extracted from the real workflow)');
  const wf = readFileSync(join(ROOT, '.github/workflows/data-refresh.yml'), 'utf8').split('\n');
  const start = wf.findIndex((l) => l.includes('git config user.name'));
  expect(start > 0, 'workflow contains the commit guard block');
  // Indentation-driven, not YAML-parsed: keep the lines at exactly 10 spaces.
  const guard = wf
    .slice(start)
    .filter((l) => l.startsWith('          '))
    .map((l) => l.slice(10))
    .filter((l) => l.trim() !== 'git push')
    .join('\n');
  expect(
    guard.includes('git restore --staged --worktree data/report.md'),
    'guard drops a timestamp-only report.md',
  );

  const dir = mkdtempSync(join(tmpdir(), 'tokon-cron-'));
  const sh = (cmd: string) =>
    execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: 'pipe', shell: '/bin/bash' });
  const guardPath = join(dir, 'guard.sh');
  sh('git init -q .');
  sh('git config user.email t@t && git config user.name t');
  execSync(`mkdir -p ${join(dir, 'data')}`);
  const write = (p: string, s: string) => writeFileSync(join(dir, p), s);
  // The fixture must carry EVERY file the workflow's `git add` names, or the
  // add fails and the whole guard mis-reports.
  // The seed list is READ OUT OF THE WORKFLOW, not restated here. `git add`
  // fails on a path that does not exist, which aborts the guard and produces no
  // commit — so a hand-maintained copy of this list turns "someone staged a new
  // artifact" into "case B: real change commits" going red, with nothing in the
  // failure naming the actual cause. Adding data/player-redirects.json to the
  // workflow is exactly how that was found.
  const staged = (guard.match(/git add ((?:data\/\S+\s*)+)/)?.[1] ?? '')
    .split(/\s+/)
    // .md as well as .json: report.md is a pipeline output like any other and
    // the .json-only filter silently exempted it from the staging check below.
    .filter((f) => f.startsWith('data/') && (f.endsWith('.json') || f.endsWith('.md')));
  expect(staged.length > 0, `workflow's git add names data files (${staged.length})`);
  // Every file the pipeline WRITES must be staged, or the cron regenerates it
  // and throws it away. Checked by name rather than by count so adding a
  // pipeline output and forgetting the workflow is a failure here, not a
  // mystery three weeks later. source-pins.json is the case that prompted it:
  // the cron only ever reads it, but an unstaged file that does change is a
  // change discarded in silence.
  for (const f of [
    'videos.json',
    'replays.json',
    'summary.json',
    'report.md',
    'source-pins.json',
  ]) {
    expect(
      staged.some((p) => p.endsWith(f)),
      `workflow stages data/${f}`,
    );
  }
  for (const f of staged) write(f, '[]\n');
  write('data/report.md', '# r\n\n_Generated 2026-01-01T00:00:00.000Z_\n');
  // Written to a FILE and run as `bash guard.sh`: passing it via `bash -c` puts
  // it through /bin/sh first, which mangles the newlines and $(…) forms.
  writeFileSync(guardPath, guard);
  sh('git add -A && git commit -q -m base');

  // case A: only the generated timestamp moved → must NOT commit
  write('data/report.md', '# r\n\n_Generated 2026-01-02T00:00:00.000Z_\n');
  const a = sh(`bash ${guardPath}`);
  expect(a.includes('No data changes'), 'case A: timestamp-only diff does not commit');
  expect(sh('git rev-list --count HEAD').trim() === '1', 'case A: still one commit');

  // case B: a real data change → must commit, and report.md rides along
  write('data/replays.json', '[{"id":"x"}]\n');
  write('data/report.md', '# r\n\n153 replays\n\n_Generated 2026-01-03T00:00:00.000Z_\n');
  sh(`bash ${guardPath}`);
  expect(sh('git rev-list --count HEAD').trim() === '2', 'case B: real change commits');
  expect(
    sh('git show --stat --name-only HEAD').includes('data/report.md'),
    'case B: report.md ships with the real change',
  );
}

// ════════════════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  testSubstrate();

  const server = await serve();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 960 } })
  ).newPage();

  // ── /health ───────────────────────────────────────────────────────────────
  console.log('\n— /health');
  await gotoIdle(page, server.at('/health'));
  const health = await page.evaluate(() => document.body.innerText);
  expect(
    /charactersPerSide\s*4/.test(health.replace(/\s+/g, ' ')),
    'health reports charactersPerSide 4',
  );
  expect(health.includes('tokon'), 'health reports the game slug');

  // ── browse ────────────────────────────────────────────────────────────────
  console.log('\n— browse');
  await gotoIdle(page, server.at('/'));
  await page.waitForSelector('[data-replay-id]');
  const cards = await page.locator('[data-replay-id]').count();
  expect(cards > 0, `browse renders cards (${cards})`);

  // 8 badges at real density — the surface this game exists to prove
  const eight = replays.find((r) => r.sides.every((s) => s.characters.length === 4));
  if (eight) {
    const density = await page.evaluate((id: string) => {
      const c = document.querySelector(`[data-replay-id="${id}"]`);
      if (!c) return null;
      const vs = [...c.querySelectorAll('span')].find((s) => s.textContent!.trim() === 'VS');
      if (!vs) return null;
      const grid = vs.parentElement!;
      const cb = c.getBoundingClientRect();
      const vb = vs.getBoundingClientRect();
      return {
        badges: grid.querySelectorAll('span[aria-label]').length,
        vsOffset: Math.abs(vb.left + vb.width / 2 - (cb.left + cb.width / 2)),
      };
    }, eight.id);
    expect(
      density !== null && density.badges === 8,
      `a full 4v4 card renders EIGHT badges (${density?.badges})`,
    );
    expect(
      density !== null && density.vsOffset <= 2,
      `VS stays centred on an 8-badge card (${density?.vsOffset.toFixed(2)}px)`,
    );
  } else {
    expect(false, 'corpus contains at least one full 4v4 record to measure');
  }

  // gated facets — the inversions that make this game different
  const body = await page.evaluate(() => document.body.innerText.toLowerCase());
  expect(
    !/same\s+team|co-?occurrence/.test(body),
    'co-occurrence filter is ABSENT (coOccurrence: false)',
  );
  expect(
    !/\brank\b.*(?:master|diamond|platinum)/.test(body),
    'rank facet is ABSENT (filters.rank unset)',
  );
  expect(body.includes('fighter'), 'vocabulary reads "fighter", not "character"');

  // ── segment playback ──────────────────────────────────────────────────────
  // A segment record is the only kind whose id is not a YouTube id, so every
  // URL the engine builds for it goes through `videoId ?? id`. This asserts the
  // three places that matters — the derived thumbnail, the embed and the watch
  // link — on a record chosen from the committed data rather than hardcoded.
  // A SAMPLE, not one record: one per source VOD plus the two shapes most
  // likely to break — the @0 case, whose startSeconds is omitted as falsy, and
  // the largest offset in the corpus. Computed, so it grows with the catalogue.
  const segmentsAll = replays.filter((r) => r.videoId);
  const perVodPick = new Map<string, (typeof replays)[number]>();
  for (const r of segmentsAll) if (!perVodPick.has(r.videoId!)) perVodPick.set(r.videoId!, r);
  const sample = [
    ...new Map(
      [
        ...perVodPick.values(),
        ...segmentsAll.filter((r) => (r.startSeconds ?? 0) === 0).slice(0, 1),
        ...[...segmentsAll]
          .sort((a, b) => (b.startSeconds ?? 0) - (a.startSeconds ?? 0))
          .slice(0, 1),
      ].map((r) => [r.id, r]),
    ).values(),
  ];
  for (const segment of sample) {
    await gotoIdle(page, server.at(`/?v=${encodeURIComponent(segment.id)}`));
    await page.waitForSelector('[data-testid="video-modal"], dialog, [role="dialog"]', {
      timeout: 8000,
    });
    const shown = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="video-modal"], dialog, [role="dialog"]');
      if (!root) return null;
      const iframe = root.querySelector('iframe');
      const watch = [...root.querySelectorAll('a')]
        .map((a) => a.getAttribute('href') ?? '')
        .find((h) => h.includes('youtube.com/watch') || h.includes('youtu.be/'));
      const img = root.querySelector('img');
      return {
        iframe: iframe?.getAttribute('src') ?? '',
        watch: watch ?? '',
        img: img?.getAttribute('src') ?? '',
        text: (root as HTMLElement).innerText,
      };
    });
    expect(shown !== null, `?v=${segment.id} opens the modal for a segment record`);
    if (shown) {
      // The embed may be lazy (LiteYouTube renders a facade until clicked), so
      // an absent iframe is not a failure — an iframe pointing at the WRONG
      // video is. Same for the poster image.
      if (shown.iframe) {
        expect(
          shown.iframe.includes(`/embed/${segment.videoId}`),
          `the embed loads videoId, not the composite id (${shown.iframe.slice(0, 60)})`,
        );
        expect(
          shown.iframe.includes(`start=${segment.startSeconds}`),
          `the embed starts at the record's offset (start=${segment.startSeconds})`,
        );
      }
      expect(
        shown.watch.includes(`v=${segment.videoId}`) || shown.watch.includes(`/${segment.videoId}`),
        `the watch link points at the VOD (${shown.watch.slice(0, 70)})`,
      );
      // A zero offset is the whole video, and its record omits startSeconds
      // entirely — so the correct link has NO t= at all. Asserting its absence
      // is the check that matters here: a link reading "t=undefineds" would
      // still open the video and still look right in a screenshot.
      const secs = segment.startSeconds ?? 0;
      expect(
        secs > 0 ? shown.watch.includes(`t=${secs}s`) : !/[?&]t=/.test(shown.watch),
        secs > 0
          ? `the watch link carries the offset (t=${secs}s)`
          : 'a zero-offset record links to the VOD with no t= at all',
      );
      expect(
        !shown.img.includes('@'),
        `the derived thumbnail uses videoId, never the composite id (${shown.img.slice(0, 70)})`,
      );
    }
  }
  if (sample.length > 0) {
    console.log(`  … ${sample.length} segment record(s) checked, one per source VOD`);
    // and reachable by browsing, not only by deep link. Asserted on the newest
    // record overall when that record is a segment — otherwise its absence from
    // the first page is paging, not a bug.
    const newest = [...replays].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (newest?.videoId) {
      await gotoIdle(page, server.at('/'));
      await page.waitForSelector('[data-replay-id]');
      const reachable = await page.evaluate(
        (id: string) => document.querySelector(`[data-replay-id="${id}"]`) !== null,
        newest.id,
      );
      expect(reachable, 'the newest segment record renders a card on the first browse page');
    }
  }

  // ── source chips: TWO GROUPS, not seven channels ──────────────────────────
  // Inverted when marvelTokonYT arrived and app.config.ts declared
  // sourceGroups. It used to assert the opposite ("chips render per channel,
  // not grouped") and that assertion was correct for as long as every channel
  // was an online re-uploader.
  //
  // Asserting the ABSENCE of the channel names matters as much as the presence
  // of the group labels: with sourceGroups set the engine renders ONLY group
  // chips, so a channel name leaking back into the filter bar means the config
  // silently stopped being read — which looks like nothing at all on a page
  // that still filters correctly.
  //
  // Read the CHIPS, not document.innerText: every card carries a SourceBadge
  // printing the same channel names, so a body-text search cannot tell a filter
  // chip from a badge and would report the grouping as broken while it works.
  const chipLabels = new Set(
    await page.evaluate(() =>
      [...document.querySelectorAll('button[aria-pressed]')].map((b) =>
        (b.textContent ?? '').trim(),
      ),
    ),
  );
  expect(chipLabels.has('Online'), 'source facet renders the Online group chip');
  expect(chipLabels.has('Tournament'), 'source facet renders the Tournament group chip');
  const leaked = CHANNELS.filter((c) => chipLabels.has(c.name)).map((c) => c.name);
  expect(
    leaked.length === 0,
    `no per-channel source chip renders when grouped${leaked.length ? ` (leaked: ${leaked.join(', ')})` : ''}`,
  );
  const chipText = await page.evaluate(() => document.body.innerText);

  // patch facet — S1 parent with date children
  expect(chipText.includes('Season 1'), 'patch facet shows the Season 1 parent label');
  // S0 is the era that is emitted CONDITIONALLY — emit.ts prunes an era with no
  // records so its chip cannot advertise an empty filter, which means the chip
  // being here is the only proof the pre-release footage actually published.
  // Its label is asserted rather than its token: `buildPatchGroups` would
  // otherwise default it to "Season 0", naming a balance era the game never had.
  expect(chipText.includes('Pre-release'), 'patch facet shows the S0 Pre-release parent label');
  expect(!chipText.includes('Season 0'), 'the pre-release era is never labelled "Season 0"');

  // deep link round-trip
  const topChar = Object.entries(stats.characterUsage).sort((a, b) => b[1] - a[1])[0];
  if (topChar) {
    await gotoIdle(page, server.at(`/?character=${topChar[0]}`));
    await page.waitForSelector('[data-replay-id]');
    const filtered = await page.locator('[data-replay-id]').count();
    expect(
      filtered > 0 && filtered <= cards,
      `?character=${topChar[0]} filters the grid (${filtered}/${cards})`,
    );
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  console.log('\n— /stats');
  await gotoIdle(page, server.at('/stats'));
  const statsText = await page.evaluate(() => document.body.innerText.toLowerCase());
  expect(!statsText.includes('pairing'), 'duo/pairing panels are ABSENT (no pairingUsage emitted)');
  expect(!statsText.includes('synergy'), 'synergy matrix is ABSENT');
  expect(statsText.includes('fighter'), 'stats headings use the fighter vocabulary');

  // ── roster + entities ─────────────────────────────────────────────────────
  console.log('\n— roster and entity pages');
  await gotoIdle(page, server.at('/fighters'));
  const rosterCount = await page.locator('a[href*="/fighters/"]').count();
  expect(
    rosterCount >= characters.length,
    `roster lists all ${characters.length} fighters (${rosterCount} links)`,
  );
  expect(
    existsSync(join(OUT, BASE.slice(1), 'fighters/champion/index.html')),
    'the hidden 21st fighter prerenders',
  );

  const someChar = characters.find((c) => (stats.characterUsage[c.id] ?? 0) > 0) ?? characters[0]!;
  await gotoIdle(page, server.at(`/fighters/${someChar.id}`));
  const charH1 = await page.locator('h1').first().innerText();
  expect(charH1.trim().length > 0, `/fighters/${someChar.id} renders an h1 (${charH1.trim()})`);
  const portraitOk = await page.evaluate(() =>
    [...document.images].every((i) => !i.src.includes('/img/characters/') || i.naturalWidth > 0),
  );
  expect(portraitOk, 'no character image 404s on the fighter page');

  // ComboForge cross-link (engine v0.11.0). Every fighter id maps 1:1 to theirs,
  // but the GAME id does not — ours is 'tokon', theirs is 'marveltokon'.
  const cfHref = await page.locator('[data-testid="comboforge-link"]').first().getAttribute('href');
  expect(
    cfHref ===
      `https://comboforge.gg/browse?gameId=marveltokon&characterId=marveltokon-${someChar.id}`,
    `ComboForge band deep-links the fighter (${cfHref})`,
  );

  // ComboForge nav item + leaving-site dialog (engine v0.12.0). The nav link is
  // a REAL <a href> — the interstitial is a click handler, not a replacement —
  // so the raw url must survive into the prerendered HTML for crawlers.
  const navCombos = page.locator('[data-testid="nav-combos"]');
  expect((await navCombos.count()) > 0, 'nav carries the Combos item');
  expect(
    (await navCombos.first().getAttribute('href')) ===
      'https://comboforge.gg/browse?gameId=marveltokon',
    'nav Combos points at this game on ComboForge',
  );
  const urlBeforeCombos = page.url();
  await navCombos.first().click();
  await page.waitForSelector('[data-testid="leaving-site-dialog"]', { timeout: 5000 });
  expect(page.url() === urlBeforeCombos, 'clicking Combos shows the dialog instead of navigating');
  expect(
    ((await page.textContent('[data-testid="leaving-site-dialog"]')) ?? '').includes('ComboForge'),
    'the dialog names the partner',
  );
  expect(
    (await page.getAttribute('[data-testid="leaving-site-continue"]', 'href')) ===
      'https://comboforge.gg/browse?gameId=marveltokon',
    'the dialog continues to the same url the link carried',
  );
  await page.click('text=Stay here');
  await page.waitForSelector('[data-testid="leaving-site-dialog"]', {
    state: 'detached',
    timeout: 5000,
  });
  expect(page.url() === urlBeforeCombos, '"Stay here" closes it and stays put');
  const somePlayer = players[0];
  if (somePlayer) {
    await gotoIdle(page, server.at(`/players/${somePlayer.id}`));
    expect(
      (await page.locator('h1').first().innerText()).trim().length > 0,
      `/players/${somePlayer.id} renders`,
    );
  }

  // ── theme + the Ō gate ────────────────────────────────────────────────────
  console.log('\n— theme (built bundle) and the Ō gate');
  await gotoIdle(page, server.at('/'));
  const theme = await page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return {
      primary: s.getPropertyValue('--color-primary').trim().toLowerCase(),
      surface: s.getPropertyValue('--color-surface').trim().toLowerCase(),
      display: s.getPropertyValue('--font-display').trim(),
    };
  });
  expect(theme.primary === '#03a5fe', `--color-primary is the Tōkon blue (${theme.primary})`);
  expect(theme.surface === '#101627', `--color-surface is the AA reference (${theme.surface})`);
  expect(theme.display.includes('Bangers'), `--font-display is Bangers (${theme.display})`);

  // Per-subset, against a family that cannot exist so both measurements resolve
  // to the SAME default face. `document.fonts.check` alone returns true for a
  // family whose unicode-range does not cover the text, and a width comparison
  // against `serif` also passes because a half-loaded family draws a MIXED
  // string — the OG card shipped a serif wordmark past both of those once.
  const font = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const NOPE = '__no_such_family__';
    ctx.font = `400 64px Bangers, ${NOPE}`;
    const asciiB = ctx.measureText('REPLAY').width;
    const macronB = ctx.measureText('Ō').width;
    ctx.font = `400 64px ${NOPE}`;
    return {
      asciiB,
      macronB,
      asciiS: ctx.measureText('REPLAY').width,
      macronS: ctx.measureText('Ō').width,
    };
  });
  expect(Math.abs(font.asciiB - font.asciiS) > 1, 'Bangers latin subset is drawing (A–Z)');
  expect(
    Math.abs(font.macronB - font.macronS) > 1,
    'Bangers latin-ext subset is drawing (Ō — the wordmark)',
  );
  const wordmark = await page.evaluate(() => document.body.innerText.includes('TŌKON'));
  expect(wordmark, 'the macron survives into the rendered wordmark');

  // ── artifacts under the subpath ───────────────────────────────────────────
  console.log('\n— subpath artifacts');
  const at = (p: string) => join(OUT, BASE.slice(1), p);
  for (const f of ['sitemap.xml', 'robots.txt', 'manifest.webmanifest', '404.html']) {
    expect(existsSync(at(f)), `${f} emitted under ${BASE}`);
  }
  const sm = readFileSync(at('sitemap.xml'), 'utf8');
  expect(sm.includes(`${BASE}/fighters/`), 'sitemap carries /fighters/ routes');
  expect(!sm.includes('/characters'), 'sitemap must not leak /characters routes');
  expect(
    existsSync(at('data/replays.json')) && existsSync(at('data/summary.json')),
    'the client-fetched data files ship in the build',
  );

  // ── observability ─────────────────────────────────────────────────────────
  const reqs: string[] = [];
  page.on('request', (r) => reqs.push(r.url()));
  await gotoIdle(page, server.at('/stats'));
  expect(
    !reqs.some((u) => /\/_vercel\/insights/.test(u) && !u.includes('/tokon-insights')),
    'analytics resolves under /tokon-insights, not the shell-owned default',
  );

  await browser.close();
  server.close();

  // ── emit determinism ──────────────────────────────────────────────────────
  console.log('\n— emit determinism');
  const before = [
    'replays.json',
    'stats.json',
    'patchGroups.json',
    'patchBoundaries.json',
    'summary.json',
  ].map((f) => readFileSync(join(ROOT, 'data', f), 'utf8'));
  execSync('npx tsx scripts/emit.ts', { cwd: ROOT, stdio: 'pipe' });
  const after = [
    'replays.json',
    'stats.json',
    'patchGroups.json',
    'patchBoundaries.json',
    'summary.json',
  ].map((f) => readFileSync(join(ROOT, 'data', f), 'utf8'));
  expect(
    before.every((s, i) => s === after[i]),
    'a second emit is byte-identical (no timestamps, stable sort)',
  );

  testCronGuard();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

await main();
