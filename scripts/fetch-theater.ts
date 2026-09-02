// Stage 1 for the INDEX intake: pull Replay Theater's tagged Tōkon tournament
// matches, join each to the YouTube metadata of the VOD it points into, and
// dump the result to raw/replayTheater.json.
//
// Run: npm run data:theater   (and now: every morning, from the cron)
//
// THE POSTURE CHANGED ON 2026-08-31, and it is worth stating because this
// header used to argue the opposite. It said "a third party's uptime and
// goodwill should not become a cron dependency on day one of an integration",
// and that was right — on day one. The trust is re-measured on every pull and it
// has held: all 44 committed offsets land inside a chapter of the source VOD,
// and all 25 chapters that name a matchup agree with the catalogue on BOTH
// handles. The operator is a collaborator rather than a stranger.
// replaytheater.app/robots.txt read 2026-08-31 is `User-agent: * / Disallow:`;
// requests carry a contactable user-agent and the catalogue's own pacing. What
// the old policy costs now is a human remembering to run this.
//
// WHAT MAKES IT SAFE IS NOT THE RELATIONSHIP, THOUGH — it is two rules that
// hold even when the goodwill does not:
//
//   1. ADD-ONLY. This intake can only ADD records. A committed record is carried
//      whether or not the catalogue still lists it; entries that vanish are
//      COUNTED in report.md, never removed, and the pin only grows.
//   2. THE CRON NEVER DEPENDS ON THIS SUCCEEDING. The step runs LAST and is
//      allowed to fail. On any failure — network, non-200, malformed page, a
//      collision the collapse cannot explain — there is simply no dump, parse.ts
//      carries exactly as it does today, and the cron stays green. A bad day
//      upstream costs that day's new entries and nothing else.
//
// AND WHAT MAKES IT AFFORDABLE is the cursor below. This game's whole catalogue
// is 5 pages today (248 entries, measured 2026-08-31) and the daily path reads
// two or three of them; the same cursor is what keeps the sibling repos, where a
// sweep is hundreds of pages, from sending that every morning to a fellow fan
// project.
//
// WHAT IT IS NOT. Replay Theater hosts no video. It is an index: a match is a
// (videoId, startSeconds) pair plus players, characters and an event tag. So a
// record here is a SEGMENT — a median of 8 of them share one VOD — and its id
// is `${videoId}@${startSeconds}`, never a YouTube id.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNEL_BY_ID } from './channels';
import { fetchVideoMeta, requireApiKey, sleep } from './youtube';
import type { TheaterRawRecord } from '../types/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'raw');
const OUT = join(RAW_DIR, 'replayTheater.json');
/** What this pull did, for parse.ts to read. The collapse count below is the
 *  reason it exists at all — the collapsed entries are gone from the dump by the
 *  time parse sees it, so this is the only way report.md can state the collapse
 *  instead of absorbing it. The cursor fields joined it when the cron did.
 *  ABSENT on a run that never pulled, which report.md says rather than
 *  printing 0. */
const STATS = join(RAW_DIR, '.replayTheater.stats.json');
/** EVERY entry this run saw, tagged and untagged, in the catalogue's own shape.
 *  Kept OUT of raw/replayTheater.json on purpose: that file is the INTAKE and
 *  parse.ts builds one record per row of it, so an untagged row landing there
 *  would publish somebody's online ranked set as a tournament match. This file
 *  is the WITNESS — nothing reads it yet, and nothing that reads it may build. */
const WITNESS = join(RAW_DIR, 'replayTheater.witness.json');
/** The cursor's committed state: the highest catalogue entry id ever seen, so a
 *  run knows where "already seen" starts without re-reading the catalogue.
 *  Written by parse.ts — every data/ write is parse's — and read here. */
const CURSOR = join(ROOT, 'data', 'theater-cursor.json');
/** Resume cache for a --full sweep only. The cursor replaced it on the daily
 *  path: two resume mechanisms that can disagree are worse than one, and this
 *  one recorded page NUMBERS against a catalogue that grows at the FRONT, so a
 *  second run refetched page 1 and skipped 2..N as "seen". Deleted on every
 *  successful run.
 *
 *  READ 2026-08-31, BEFORE THIS FILE STARTED DELETING IT: the copy then in raw/
 *  held 15,286 "Street Fighter 6" entries beside 236 Tōkon ones, left over from
 *  an era before the endpoint filtered by game. Nothing downstream ever saw
 *  them, because the per-entry game gate below threw every one away — the
 *  clearest argument that gate has for existing. Past tense on purpose: a
 *  successful run now removes this file, raw/ is gitignored, and nobody who
 *  clones the repo ever had it, so a claim written as "look in raw/" would be
 *  unverifiable within a day of being written. */
const PARTIAL = join(RAW_DIR, '.replayTheater.partial.json');

const CH = CHANNEL_BY_ID.get('replayTheater');
if (!CH?.index) throw new Error('replayTheater is not registered as an index channel');
const INDEX = CH.index;
// Hoisted for the same reason INDEX is: the narrowing above holds at module
// scope, not inside main().
const KEY = CH.id;

// ── flags ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FRESH = argv.includes('--fresh');
/** THE DAILY PATH is the cursor. Page from the front and stop once the catalogue
 *  stops offering anything newer than the committed cursor. `--full` forces the
 *  whole-catalogue sweep, which is what `--fresh` has always meant and what a
 *  periodic reconciliation still wants. */
const FULL = argv.includes('--full') || FRESH;
const CURSOR_MODE = !FULL;
/** Two clean pages, not one. The catalogue orders `upload_date DESC, id ASC`, so
 *  one day's submissions can straddle a page boundary and a single clean page is
 *  not proof there is nothing behind it. */
const CLEAN_PAGES_TO_STOP = 2;
/** A hard ceiling on the daily path, so a catalogue-side reordering can never
 *  turn the cron into a full sweep.
 *
 *  STATED HONESTLY FOR THIS REPO: the whole Tōkon catalogue is 5 pages today
 *  (248 entries, measured 2026-08-31), so this bound is above the catalogue and
 *  cannot bite here yet. It is the same constant across the platform, where the
 *  sibling catalogues are hundreds of pages and it is the only thing standing
 *  between a reorder and a full sweep every morning. Hitting it is reported, not
 *  silent: under add-only nothing is lost, only late, and
 *  `npm run data:theater -- --full` reconciles. */
const CURSOR_MAX_PAGES = 10;
const opt = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};
// `--max-pages` with no value yields NaN, and Math.min(pages, NaN) is NaN — the
// loop then never runs and you silently get page 1. A flag that is present must
// carry a usable number or stop the run.
const maxPagesRaw = opt('--max-pages');
let MAX_PAGES = Infinity;
if (argv.includes('--max-pages')) {
  const n = Number(maxPagesRaw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`✖ --max-pages needs a positive integer (got ${JSON.stringify(maxPagesRaw)}).`);
    process.exit(1);
  }
  MAX_PAGES = n;
}

requireApiKey('data:theater');

const pct = (n: number, total: number) => (total === 0 ? '0.0' : ((n / total) * 100).toFixed(1));

// ── the index API ───────────────────────────────────────────────────────────

/** One entry exactly as the catalogue publishes it. Everything is nullable:
 *  this is someone else's schema and we do not get to assume. */
interface TheaterEntry {
  id?: number;
  game?: string | null;
  video_link?: string | null;
  tag?: string | null;
  upload_date?: string | null;
  p1_name?: string | null;
  p2_name?: string | null;
  p1_char?: string | null;
  p1_char2?: string | null;
  p1_char3?: string | null;
  p1_char4?: string | null;
  p2_char?: string | null;
  p2_char2?: string | null;
  p2_char3?: string | null;
  p2_char4?: string | null;
}
interface TheaterPage {
  matches?: TheaterEntry[];
  total_count?: number | string;
}

async function getPage(page: number, retries = 4): Promise<TheaterPage> {
  const url = `${INDEX.endpoint}?game=${encodeURIComponent(INDEX.slug)}&page=${page}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          // Identify the client. This is a fellow fan project, not a target.
          'user-agent': 'replay-database/tokon (+https://github.com/joeycf) data:theater',
        },
      });
      if (res.ok) return (await res.json()) as TheaterPage;
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status} (not retryable)\n${await res.text().catch(() => '')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= retries || msg.includes('not retryable')) {
        throw new Error(`Replay Theater page ${page} failed: ${msg}`, { cause: err });
      }
      const wait = Math.min(1500 * 2 ** (attempt - 1), 10_000);
      console.warn(
        `  ⚠ page ${page} (attempt ${attempt}/${retries}): ${msg}; retrying in ${wait}ms`,
      );
      await sleep(wait);
    }
  }
  throw new Error(`Exhausted retries for page ${page}`);
}

// ── video link → (videoId, startSeconds) ────────────────────────────────────
//
// THE LINKS ARE CONCATENATED, NOT BUILT. Replay Theater's submission form does
// `video_link = base + "&t=" + t + "s"` regardless of what `base` looks like,
// so a youtu.be submission produces `https://youtu.be/<id>&t=554s` — a PATH
// with no query string at all. 10 of the 44 tagged Tōkon entries are that
// shape, and it is half the catalogue in the sibling games. A URL-parsing
// extractor reads the id as "abcdefghijk&t=554s"; this matches the id shape
// explicitly and refuses anything else rather than guessing.
const VIDEO_ID =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/(?:live|shorts|embed)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

// GLOBAL, and the LAST match wins. The form appends its own offset last, so an
// earlier `t=` is whatever the submitter's clipboard carried in — a share link
// already carrying a timestamp. Taking the first reads the clipboard and throws
// away the catalogue's own value; measured in the sibling SF6 catalogue, that
// collapses four distinct matches onto one id, which the uniqueness check below
// would then report as a collision it cannot explain.
const START_ALL = /[?&]t=([^&#]*)/g;
const START_VALUE = /^(\d+)s?$/;

interface Link {
  videoId: string;
  startSeconds: number;
  /** How many `t=` params the link carried; >1 is worth seeing in recon. */
  tCount: number;
}

function parseLink(link: string): Link | { error: string } {
  const id = VIDEO_ID.exec(link ?? '');
  if (!id) return { error: 'no extractable YouTube id' };
  const values = [...(link ?? '').matchAll(START_ALL)].map((m) => m[1] ?? '');
  if (values.length === 0) return { videoId: id[1]!, startSeconds: 0, tCount: 0 };
  const last = values[values.length - 1]!;
  const m = START_VALUE.exec(last);
  // A `t=` we cannot read is NOT the same as no `t=`. Falling through to 0
  // would publish a segment that starts at the top of a three-hour VOD and
  // renders exactly like a correct one.
  if (!m) return { error: `unreadable t= value ${JSON.stringify(last)}` };
  return { videoId: id[1]!, startSeconds: Number(m[1]), tCount: values.length };
}

// ── chapters, derived from the description ──────────────────────────────────
//
// RECON ONLY — this produces no field and gates nothing. MatchVideo has no
// `round` and no `tournament`, so the reference's round-harvesting has no
// destination here and is not ported. What survives is the measurement this
// intake was admitted on: the catalogue's offsets against the uploaders' own
// chapter markers, re-run on every pull rather than trusted from the day it was
// first taken.
//
// The rule YouTube applies: timestamped lines, at least three, the first at
// 0:00. The last test matters — a description that merely mentions a time is
// not a chapter list.
const CHAPTER_LINE =
  /^\s*(?:\[|\()?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\]|\))?\s*[-–—:|]?\s*(.+?)\s*$/;

interface Chapter {
  start: number;
  title: string;
}

function chaptersOf(description: string): Chapter[] {
  const out: Chapter[] = [];
  for (const line of (description ?? '').split('\n')) {
    const m = CHAPTER_LINE.exec(line);
    if (!m) continue;
    const [, a, b, c, title] = m;
    const start = c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
    if (title?.trim()) out.push({ start, title: title.trim() });
  }
  if (out.length < 3 || out[0]!.start !== 0) return [];
  return out.sort((x, y) => x.start - y.start);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A side's declared fighters, in slot order, blanks dropped. Module-scope
 *  because the collapse below and the record builder must read the SAME four
 *  columns — a collapse that compared fewer fields than the record carries would
 *  merge records that differ. */
const chars = (e: TheaterEntry, side: 1 | 2): string[] =>
  ([`p${side}_char`, `p${side}_char2`, `p${side}_char3`, `p${side}_char4`] as const)
    .map((k) => (e as Record<string, unknown>)[k])
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    .map((c) => c.trim());

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });

  // CLEAR THE PREVIOUS RUN'S SELF-REPORT BEFORE FETCHING ANYTHING. parse.ts
  // reads .replayTheater.stats.json to learn what this pull did — its mode, its
  // page count and the cursor it reached — and a file left over from yesterday
  // answers those questions about the wrong run. Specifically: a pull that dies
  // on its first request writes nothing, so parse would find yesterday's stats,
  // report "the pull found no new entries" instead of "no pull this run", and
  // re-advance the cursor off a number this run never observed.
  //
  // Invisible in CI, where a fresh checkout has no raw/ at all — which is
  // exactly why it belongs here rather than being trusted to the environment.
  await rm(STATS, { force: true });
  await rm(WITNESS, { force: true });

  // Resume: a partial pull is keyed by Replay Theater's own entry id, so a
  // re-run after an interruption re-fetches only the pages it never saw and the
  // overlap merges rather than duplicating. --fresh discards it.
  //
  // A FULL SWEEP ONLY, now. On the cursor path the cache is actively wrong: it
  // marks page 2..N as seen against a catalogue that grows at the front, so the
  // daily run would read page 1 and stop having looked at nothing new.
  const byTheaterId = new Map<number, TheaterEntry>();
  let seenPages = new Set<number>();
  if (FULL && !FRESH && existsSync(PARTIAL)) {
    try {
      const prev = JSON.parse(await readFile(PARTIAL, 'utf8')) as {
        pages: number[];
        entries: TheaterEntry[];
      };
      for (const e of prev.entries) if (e.id != null) byTheaterId.set(e.id, e);
      seenPages = new Set(prev.pages);
      console.log(
        `  ↻ resuming: ${byTheaterId.size} entr(ies) from ${seenPages.size} cached page(s)`,
      );
    } catch {
      console.warn('  ⚠ unreadable partial cache — starting fresh');
    }
  }

  // ── the cursor ────────────────────────────────────────────────────────────
  // The catalogue orders `upload_date DESC, id ASC` and entry ids increase with
  // submission, so "have I seen everything new?" is answerable from the front of
  // the feed alone: keep paging until CLEAN_PAGES_TO_STOP consecutive pages
  // offer no id above the committed cursor.
  //
  // WHY NOT `?since=` OR A REAL CURSOR: there is not one. Probed live
  // 2026-08-31 — `since`, `limit`, `per_page`, `sort`, `order` and `after_id`
  // are all ACCEPTED and silently IGNORED (byte-identical responses). Only
  // `game` and `page` are honoured, and `game` is validated: an unrecognised
  // slug returns "Invalid game" rather than falling through to the unfiltered
  // catalogue. Worth knowing, because it means the per-entry game gate below is
  // a second line rather than the only one — `?game=tokon` returned 248 entries,
  // 100% of them Tōkon, on that same probe.
  //
  // WHAT THE CURSOR CANNOT SEE, stated rather than hidden: the ordering key is
  // the VIDEO's upload date, not the submission's. Someone submitting a 2024 VOD
  // today lands deep in the feed, behind the bound, and this run will not reach
  // it. Under add-only that is late, never lost — the entry keeps its id, a
  // --full sweep collects it, and nothing already committed is affected.
  const cursorFile = await readFile(CURSOR, 'utf8')
    .then((t) => JSON.parse(t) as Record<string, number>)
    .catch(() => ({}) as Record<string, number>);
  const cursorAt = cursorFile[KEY] ?? 0;

  console.log(`\n▶ Pulling the Replay Theater index (${INDEX.endpoint}, game=${INDEX.slug})…`);
  const first = await getPage(1);

  // ── THE CURSOR CANNOT BE AHEAD OF THE CATALOGUE ─────────────────────────────
  // Page 1 holds the newest entries, so the highest id ON IT is the highest id the
  // catalogue has. A committed cursor above that is not "nothing new today" — it is
  // impossible, and it is SILENT: every page reads as clean, the stop rule fires
  // after two, and this intake never ingests another entry for as long as the file
  // says so. The cron stays green the whole time.
  //
  // Not hypothetical. On 2026-09-01 a verification harness wrote synthetic
  // maxEntryId values (900002) into data/theater-cursor.json through the real parse
  // path; it restored raw/ afterwards and not data/. Three repos were committed
  // with a cursor a quarter-million ids past the end of the catalogue, and nothing
  // anywhere would have said a word — the pulls would simply have gone quiet
  // forever. The cursor only ever moves FORWARD, so it could not have healed
  // itself either.
  //
  // Refuse rather than clamp. Clamping would hide which entries were skipped while
  // the cursor was wrong, and a cursor that is wrong is a question about the
  // repository's history, not a number to round off.
  const newestOnPage1 = (first.matches ?? []).reduce((m, e) => Math.max(m, e.id ?? 0), 0);
  if (cursorAt > 0 && newestOnPage1 > 0 && cursorAt > newestOnPage1) {
    console.error(
      [
        `\n\u2716 The committed cursor is AHEAD of the catalogue.`,
        ``,
        `  data/theater-cursor.json  ${cursorAt}`,
        `  newest id on page 1       ${newestOnPage1}`,
        ``,
        `  Page 1 is the newest entries, so nothing in the catalogue can be above it.`,
        `  Left alone this is silent: every page reads as already-seen, the pull stops`,
        `  after two, and this intake never ingests again while the file says so.`,
        ``,
        `  Set data/theater-cursor.json to the highest id this repo has actually SEEN`,
        `  \u2014 the maxEntryId of its last full sweep \u2014 and re-run. If in doubt, 0 is`,
        `  always safe: a full sweep re-reads everything and the intake is add-only.`,
      ].join('\n'),
    );
    process.exit(1);
  }

  const total = Number(first.total_count ?? 0);
  const fullPages = Math.ceil(total / INDEX.pageSize);
  const pages = Math.min(CURSOR_MODE ? CURSOR_MAX_PAGES : fullPages, MAX_PAGES);
  console.log(
    CURSOR_MODE
      ? `  catalogue reports ${total} match(es) (${fullPages} page(s) of ${INDEX.pageSize}); cursor at entry id ${cursorAt || '—'}, reading at most ${pages}`
      : `  catalogue reports ${total} match(es) → ${pages} page(s) of ${INDEX.pageSize}`,
  );
  for (const e of first.matches ?? []) if (e.id != null) byTheaterId.set(e.id, e);
  seenPages.add(1);

  let cleanRun = (first.matches ?? []).some((e) => (e.id ?? 0) > cursorAt) ? 0 : 1;
  let pagesRead = 1;
  let stoppedEarly = false;
  for (let p = 2; p <= pages; p++) {
    if (CURSOR_MODE && cleanRun >= CLEAN_PAGES_TO_STOP) {
      stoppedEarly = true;
      break;
    }
    if (seenPages.has(p)) continue;
    await sleep(INDEX.pacingMs);
    const data = await getPage(p);
    const rows = data.matches ?? [];
    for (const e of rows) if (e.id != null) byTheaterId.set(e.id, e);
    seenPages.add(p);
    pagesRead++;
    cleanRun = rows.some((e) => (e.id ?? 0) > cursorAt) ? 0 : cleanRun + 1;
    // An empty page is the END of the catalogue, not a clean page to count
    // towards the stop rule — reaching it means there was nothing more to read,
    // which is a different fact from "nothing here was new".
    if (rows.length === 0) {
      stoppedEarly = true;
      break;
    }
    if (!CURSOR_MODE && (p % 10 === 0 || p === pages)) {
      console.log(`  … page ${p}/${pages} (${byTheaterId.size} unique entries)`);
      await writeFile(
        PARTIAL,
        JSON.stringify({ pages: [...seenPages], entries: [...byTheaterId.values()] }),
        'utf8',
      );
    }
  }
  if (CURSOR_MODE && cleanRun >= CLEAN_PAGES_TO_STOP) stoppedEarly = true;
  const hitBound = CURSOR_MODE && !stoppedEarly && pagesRead >= pages;
  const catalogue = [...byTheaterId.values()];
  const maxEntryId = catalogue.reduce((m, e) => Math.max(m, e.id ?? 0), cursorAt);
  console.log(
    CURSOR_MODE
      ? `  read ${pagesRead} page(s), ${catalogue.length} entr(ies); ${catalogue.filter((e) => (e.id ?? 0) > cursorAt).length} newer than the cursor → new cursor ${maxEntryId}`
      : `  pulled ${catalogue.length} unique entr(ies)`,
  );
  if (hitBound) {
    console.log(
      `  ⚠ the cursor hit its ${CURSOR_MAX_PAGES}-page bound without going quiet — entries may be\n` +
        `    unreached this run. Nothing is lost (add-only), only late; run\n` +
        `    \`npm run data:theater -- --full\` to reconcile.`,
    );
  }

  // ── the game gate, PER ENTRY ──────────────────────────────────────────────
  // `?game=tokon` is a query someone else answers, and an index is a strictly
  // weaker guarantee than a channel: a mistagged submission would arrive
  // looking exactly like a real one. Every entry states its own game, so check
  // that instead of the query.
  //
  // IT HAS ALREADY EARNED ITS PLACE ONCE. raw/.replayTheater.partial.json, read
  // 2026-08-31, held a pull from an era when this endpoint returned everything:
  // 15,286 "Street Fighter 6" rows beside 236 Tōkon ones. Not one of them
  // reached the corpus, and this line is the reason. That file is evidence
  // nobody can check now — a successful run deletes it and raw/ is gitignored —
  // which is why the reading is recorded here with its date instead of as a
  // pointer at a path. The endpoint filters correctly today — probed live
  // 2026-08-31, `?game=tokon` returned 248 entries, all Tōkon — but "correct
  // today" is precisely the assumption this gate declines to make.
  const want = INDEX.gameLabel.toUpperCase();
  const wrongGame = catalogue.filter((e) => (e.game ?? '').trim().toUpperCase() !== want);
  const rightGame = catalogue.filter((e) => (e.game ?? '').trim().toUpperCase() === want);
  if (wrongGame.length) {
    console.log(
      `  ⚠ ${wrongGame.length} entr(ies) rejected — entry.game is not ${INDEX.gameLabel}:`,
    );
    for (const e of wrongGame.slice(0, 10)) {
      console.log(`      #${e.id} game=${JSON.stringify(e.game)} ${e.video_link ?? ''}`);
    }
    if (wrongGame.length > 10) console.log(`      … ${wrongGame.length - 10} more`);
  }

  // ── scope: tagged tournament matches only ─────────────────────────────────
  // The untagged remainder is online play. This repo already carries six
  // channels of that; what it has none of is tournament sets.
  const tagged = rightGame.filter((e) => (e.tag ?? '').trim() !== '');
  console.log(
    `  ${tagged.length} tagged tournament match(es); ${rightGame.length - tagged.length} untagged (out of scope)`,
  );

  // ── links ─────────────────────────────────────────────────────────────────
  const linked: Array<{ e: TheaterEntry; link: Link }> = [];
  const unparseable: Array<{ e: TheaterEntry; why: string }> = [];
  for (const e of tagged) {
    const got = parseLink(e.video_link ?? '');
    if ('error' in got) unparseable.push({ e, why: got.error });
    else linked.push({ e, link: got });
  }
  if (unparseable.length) {
    console.error(`\n✖ ${unparseable.length} tagged entr(ies) have an unusable video link:`);
    for (const u of unparseable.slice(0, 10)) {
      console.error(`    #${u.e.id} ${u.why} — ${JSON.stringify(u.e.video_link)}`);
    }
    console.error('  Refusing rather than guessing — an id and an offset are not approximations.');
    process.exit(1);
  }

  // ── the same event, submitted twice ───────────────────────────────────────
  //
  // A (videoId, startSeconds) pair IS the record id, so two entries sharing one
  // would mean two records competing for it and one silently overwriting the
  // other. This used to exit on the first collision and name the two shapes that
  // cause it. One of those shapes is tractable and does not need a person: the
  // same match submitted twice under two tag spellings, identical in players,
  // characters, video and offset. The sibling SF6 catalogue carries 35 of them;
  // this one carries none today, which is exactly why the handling is written
  // now rather than the morning it first appears in the cron.
  //
  // So they are COLLAPSED, deterministically, and COUNTED — a silent collapse is
  // indistinguishable from a reader that lost records. The tie breaks on the tag
  // SPELLING rather than on the catalogue's entry ids, because entry ids reflect
  // submission order and would make the surviving copy depend on which of two
  // identical rows happened to be typed first.
  //
  // THE SAMENESS TEST READS THE FULL CHARACTER TUPLE, not just the point
  // fighter. The reference compares p1_char and p2_char alone, which is enough
  // for a game whose entries usually declare one fighter a side; every one of
  // the 88 committed sides here declares FOUR, so a first-slot comparison would
  // read two genuinely different teams sharing a point character as the same
  // match and collapse a record that should have stopped the run.
  //
  // The assert still runs afterwards on what is left. Anything the collapse
  // cannot explain — two different matches whose links defeat the offset reader
  // — still stops the run, which is the case that needs a person.
  const byKey = new Map<string, Array<{ e: TheaterEntry; link: Link }>>();
  for (const l of linked) {
    const key = `${l.link.videoId}@${l.link.startSeconds}`;
    byKey.set(key, [...(byKey.get(key) ?? []), l]);
  }
  const deduped: Array<{ e: TheaterEntry; link: Link }> = [];
  const collapsedTags = new Map<string, number>();
  let collapsed = 0;
  const collisions: string[] = [];
  for (const [key, group] of byKey) {
    if (group.length === 1) {
      deduped.push(group[0]!);
      continue;
    }
    const head = group[0]!.e;
    const sameMatch = group.every(
      (g) =>
        (g.e.p1_name ?? '') === (head.p1_name ?? '') &&
        (g.e.p2_name ?? '') === (head.p2_name ?? '') &&
        chars(g.e, 1).join('|') === chars(head, 1).join('|') &&
        chars(g.e, 2).join('|') === chars(head, 2).join('|'),
    );
    if (sameMatch) {
      const sorted = [...group].sort((a, b) =>
        (a.e.tag ?? '').trim().localeCompare((b.e.tag ?? '').trim()),
      );
      deduped.push(sorted[0]!);
      collapsed += group.length - 1;
      const pair = [...new Set(group.map((g) => (g.e.tag ?? '').trim()))].sort().join('  ||  ');
      collapsedTags.set(pair, (collapsedTags.get(pair) ?? 0) + group.length - 1);
      continue;
    }
    collisions.push(
      [
        `  ${key}`,
        ...group.map(
          (g) => `    #${g.e.id}  ${g.e.p1_name} vs ${g.e.p2_name}  [${(g.e.tag ?? '').trim()}]`,
        ),
      ].join('\n'),
    );
    deduped.push(group[0]!);
  }
  if (collapsed > 0) {
    console.log(`\n  collapsed ${collapsed} double-submitted entr(ies) — same match, two tags:`);
    for (const [pair, n] of [...collapsedTags].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${n}×  ${pair}`);
    }
  }
  if (collisions.length) {
    console.error(
      `\n✖ ${collisions.length} (videoId, startSeconds) collision(s) this cannot explain:`,
    );
    console.error(collisions.join('\n'));
    console.error(
      [
        '  That pair IS the record id, so one entry would silently overwrite the other.',
        '  These are NOT the same match under two tag spellings, which is handled above.',
        '  Two genuinely different matches whose links defeat the offset reader need the',
        '  reader fixed, not the assert loosened.',
      ].join('\n'),
    );
    process.exit(1);
  }

  // ── join to YouTube ───────────────────────────────────────────────────────
  const vodIds = [...new Set(deduped.map((l) => l.link.videoId))];
  console.log(`\n▶ Fetching YouTube metadata for ${vodIds.length} source VOD(s)…`);
  const vods = await fetchVideoMeta(vodIds);
  const missingVods = vodIds.filter((id) => !vods.has(id));
  if (missingVods.length) {
    // Reported, never silent. A VOD gone private or deleted takes its matches
    // with it, and that is a fact about the corpus, not noise.
    console.log(`  ⚠ ${missingVods.length} VOD(s) no longer resolve (private/deleted):`);
    for (const id of missingVods) {
      const n = deduped.filter((l) => l.link.videoId === id).length;
      const tag = deduped.find((l) => l.link.videoId === id)?.e.tag ?? '?';
      console.log(`      ${id}  ${n} match(es)  [${tag}]`);
    }
  }

  const records: TheaterRawRecord[] = [];
  for (const { e, link } of deduped) {
    const vod = vods.get(link.videoId);
    if (!vod) continue; // unresolvable VOD, already reported
    const c1 = chars(e, 1);
    const c2 = chars(e, 2);
    records.push({
      id: `${link.videoId}@${link.startSeconds}`,
      channel: 'replayTheater',
      // SYNTHESIZED — the catalogue carries no title. It follows this corpus's
      // ▰ shape so cards read consistently, and it carries the event tag
      // because `title` is the engine's search haystack: that placement is what
      // makes "TNS Beta Tournament" find these records with no new facet, field
      // or render surface. Handles keep their sponsor prefixes; stripping is
      // the parser's job.
      title: `MARVEL Tokon ▰ ${e.p1_name ?? '?'} (${c1.join('/')}) vs ${e.p2_name ?? '?'} (${c2.join('/')}) ▰ ${(e.tag ?? '').trim()}`,
      description: '',
      // The VOD's real publish time. Deliberately NOT offset by startSeconds:
      // that would shift a record by up to several hours and could cross a
      // day-grained patch boundary, which is the authority era and patch are
      // derived from. Sets within one VOD therefore share a timestamp — which
      // is exactly why parse.ts sorts with a tie-break.
      publishedAt: vod.publishedAt,
      // The catalogue publishes no per-match duration and there is nothing
      // honest to derive one from: the gap to the next set includes the
      // downtime between them. 0 means unknown; emit omits the field.
      durationSec: 0,
      liveBroadcastContent: 'none',
      theaterId: e.id!,
      videoId: link.videoId,
      startSeconds: link.startSeconds,
      tag: (e.tag ?? '').trim(),
      uploader: vod.uploader,
      players: [(e.p1_name ?? '').trim(), (e.p2_name ?? '').trim()],
      characters: [c1, c2],
    });
  }

  // Stable, TOTAL order: newest VOD first, then by offset within the VOD, then
  // by id. Sets inside one VOD share a publishedAt, so a comparator without the
  // final tie-break would be free to return a different permutation per run and
  // a re-pull that changed nothing would still produce a diff.
  records.sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.startSeconds - b.startSeconds ||
      a.id.localeCompare(b.id),
  );

  // ── the floor, on a FULL sweep only ───────────────────────────────────────
  // A cursor run's dump is a DELTA and is legitimately tiny — a quiet day writes
  // zero records — so "materially smaller than the pin" means nothing there.
  // parse.ts merges it add-only and that is what does the protecting. A FULL
  // sweep is a different claim: it says this IS the catalogue, so a collapse in
  // it says most of the catalogue is gone.
  //
  // The shape this guards against is not hypothetical. `records` is filtered by
  // the per-entry game gate, and that gate compares against a string the
  // catalogue controls: today it is "Marvel Tokon: Fighting Souls". The day it
  // is renamed upstream, `rightGame` is 0, `records` is 0, and the old code
  // wrote `[]` over a good dump without comment. Downstream that reads as n → 0
  // into a collapse guard this repo already documents as asleep below 20
  // records — so the cron would go red, or worse quiet, for a reason nothing
  // names. Refuse here, where the cause is still in front of us.
  //
  // THE 0.9 IS SIZED FOR A THOUSAND RECORDS, NOT FOR 44, and it is said here for
  // the reason CURSOR_MAX_PAGES states its own bound rather than leaving it to
  // be discovered. It came in from a sibling repo's 1,065-record corpus. At this
  // pin the threshold is 39.6, and the five source VODs hold 18 / 10 / 8 / 6 / 2
  // records (measured 2026-08-31) — so ANY of them going private except the
  // 2-record one puts a legitimate sweep under the floor and makes it demand
  // --allow-shrink.
  //
  // Left as a bare ratio anyway, deliberately. It is not a data risk: the dump
  // is merged add-only, so a refused sweep costs that morning's new entries and
  // nothing committed, and the cron runs the CURSOR path, where this floor is
  // skipped entirely. Pairing the ratio with an absolute allowance would buy a
  // quieter refusal at the price of loosening the one thing it is really here to
  // stop, which is n → 0 on a rename. A noisy refusal on a real 6-record loss is
  // the trade being taken, not an oversight.
  if (FULL) {
    const pins = await readFile(join(ROOT, 'data', 'source-pins.json'), 'utf8')
      .then((t) => JSON.parse(t) as Record<string, number>)
      .catch(() => ({}) as Record<string, number>);
    const pinned = pins[KEY] ?? 0;
    if (pinned > 0 && records.length < pinned * 0.9) {
      console.error(
        [
          `\n✖ A full sweep produced ${records.length} record(s) against a committed pin of ${pinned}.`,
          `  That is a claim that ${pinned - records.length} tournament matches left the catalogue at once.`,
          ``,
          `  The likeliest cause is not deletion. Every entry is checked against`,
          `  gameLabel ${JSON.stringify(INDEX.gameLabel)}, and ${wrongGame.length} of ${catalogue.length} entr(ies)`,
          `  failed that check this run — if the catalogue renamed the game, every row`,
          `  fails and this file would be overwritten with almost nothing.`,
          ``,
          `  Refusing to write. The committed records are untouched and the cron`,
          `  carries them exactly as it does on a day this never ran.`,
          `  If the drop is real: npm run data:theater -- --full --allow-shrink`,
        ].join('\n'),
      );
      if (!argv.includes('--allow-shrink')) process.exit(1);
    }
  }

  await writeFile(OUT, JSON.stringify(records, null, 1) + '\n', 'utf8');

  // ── the witness ───────────────────────────────────────────────────────────
  // EVERY entry the run saw, tagged and untagged, in the catalogue's own shape.
  // The untagged remainder is online play and is out of INGESTION scope by
  // design — this repo already carries six channels of it — but out of scope as
  // an ingest is not out of scope as EVIDENCE: those rows name a video, two
  // handles and up to eight fighters, which is an independent second reading of
  // what this repo's own title parser says about the same uploads.
  //
  // Written SEPARATELY from raw/replayTheater.json, and that separation is the
  // whole safety property: parse.ts builds one record per row of the intake
  // dump, so an untagged row landing there would publish a ranked ladder set as
  // a tournament match. Nothing reads this file yet.
  await writeFile(
    WITNESS,
    JSON.stringify(
      {
        mode: CURSOR_MODE ? 'cursor' : 'full',
        maxEntryId,
        pagesRead,
        hitBound,
        // BEHIND THE PER-ENTRY GAME GATE, not the raw catalogue. The gate is this
        // intake's only real defence against a response that is not what was asked
        // for, and the witness has to sit behind it too — it feeds a comparison
        // whose whole claim is that it is reading THIS game.
        //
        // Not hypothetical. On 2026-08-31 a `--full` sweep in tokon-replay-database
        // resumed from a partial cache left over from an era when this endpoint
        // returned everything, and wrote 15,286 Street Fighter 6 rows into a
        // 266-entry Tokon witness. The intake was untouched — the gate did its job
        // there — but the witness was 98% another game, and nothing downstream
        // would have said so.
        entries: rightGame,
      },
      null,
      1,
    ) + '\n',
    'utf8',
  );

  await writeFile(
    STATS,
    JSON.stringify(
      {
        // THE MODE IS LOAD-BEARING, not a diagnostic. parse.ts reads it to
        // decide whether this dump is the whole catalogue or a delta, which
        // decides whether "committed but absent from the dump" means "vanished
        // upstream" or "simply not in the pages we read".
        mode: CURSOR_MODE ? 'cursor' : 'full',
        maxEntryId,
        pagesRead,
        hitBound,
        catalogue: catalogue.length,
        rightGame: rightGame.length,
        tagged: tagged.length,
        collapsed,
        collapsedTags: Object.fromEntries(collapsedTags),
        unresolvableVods: missingVods.length,
        records: records.length,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // The resume cache existed to make a long sweep restartable, and it recorded
  // page NUMBERS against a catalogue that grows at the FRONT — so a second run
  // refetched page 1 and skipped 2..N as "seen", making everything past the
  // first page of new entries invisible until someone remembered --fresh. The
  // cursor is the resume mechanism now, and two that can disagree is worse than
  // one, so a successful run clears it.
  await rm(PARTIAL, { force: true });

  console.log(
    `\n  → wrote raw/replayTheater.json (${records.length} record(s)${CURSOR_MODE ? ', a delta' : ''})`,
  );
  // `rightGame`, not `catalogue`: the witness is written from behind the
  // per-entry game gate a few lines up, so the pre-gate count overstates the
  // file by however many rows the gate rejected — 15,286 of them on the
  // 2026-08-31 run the gate's own comment describes. Report what was written.
  console.log(`  → wrote raw/replayTheater.witness.json (${rightGame.length} catalogue entr(ies))`);

  // ── reconnaissance ────────────────────────────────────────────────────────
  console.log(`\n${'█'.repeat(72)}`);
  console.log('  RECONNAISSANCE — replayTheater');
  console.log('█'.repeat(72));
  console.log(`\n  catalogue (game=${INDEX.slug}):     ${catalogue.length}`);
  console.log(`  rejected by the per-entry gate:  ${wrongGame.length}`);
  console.log(`  tagged tournament matches:       ${tagged.length}`);
  console.log(`  written (VOD resolvable):        ${records.length}`);

  const malformed = linked.filter((l) => {
    const s = l.e.video_link ?? '';
    if (!s.includes('youtu.be/')) return false;
    const tail = s.split('youtu.be/')[1] ?? '';
    return tail.includes('&t=') && !tail.includes('?');
  }).length;
  const multiT = linked.filter((l) => l.link.tCount > 1).length;
  console.log(
    `\n  concatenated youtu.be/<id>&t=Ns links: ${malformed} (${pct(malformed, linked.length)}%)`,
  );
  console.log(`  links carrying more than one t=:       ${multiT} (last one wins)`);
  console.log(
    `  records at offset 0:                   ${records.filter((r) => r.startSeconds === 0).length}`,
  );

  const byTag = new Map<string, number>();
  for (const r of records) byTag.set(r.tag, (byTag.get(r.tag) ?? 0) + 1);
  const byVod = new Map<string, number>();
  for (const r of records) byVod.set(r.videoId, (byVod.get(r.videoId) ?? 0) + 1);
  const perVod = [...byVod.values()].sort((a, b) => a - b);
  console.log(`\n  distinct event tags:  ${byTag.size}`);
  console.log(
    `  distinct source VODs: ${byVod.size}  (min ${perVod[0] ?? 0} / median ${perVod[perVod.length >> 1] ?? 0} / max ${perVod[perVod.length - 1] ?? 0} matches per VOD)`,
  );
  const dates = records.map((r) => r.publishedAt.slice(0, 10)).sort();
  console.log(`  date range:           ${dates[0] ?? '—'} … ${dates[dates.length - 1] ?? '—'}`);

  // Character slot occupancy — the fact that decides whether these records need
  // the bench machinery at all. Observed, never assumed.
  const occ = new Map<number, number>();
  for (const r of records)
    for (const side of r.characters) occ.set(side.length, (occ.get(side.length) ?? 0) + 1);
  console.log(
    `\n  characters per side: ${[...occ.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, n]) => `${k}→${n}`)
      .join(' · ')}`,
  );

  // ── trust, re-measured every pull ─────────────────────────────────────────
  let inChapter = 0;
  let exact = 0;
  let within30 = 0;
  let vsChapters = 0;
  let namesAgree = 0;
  let chaptered = 0;
  for (const [id, meta] of vods) {
    const cs = chaptersOf(meta.description);
    if (cs.length) chaptered++;
    if (!cs.length) continue;
    for (const r of records.filter((x) => x.videoId === id)) {
      let hit: Chapter | undefined;
      for (const c of cs) {
        if (c.start <= r.startSeconds) hit = c;
        else break;
      }
      if (!hit) continue;
      inChapter++;
      const d = r.startSeconds - hit.start;
      if (d === 0) exact++;
      if (Math.abs(d) <= 30) within30++;
      // Condition on the chapter naming a MATCHUP, not on a name having
      // already hit: the looser denominator silently excludes total
      // disagreement, which is the one failure that matters.
      if (/\bvs\.?\b/i.test(hit.title)) {
        vsChapters++;
        const t = norm(hit.title);
        const [p1, p2] = r.players.map(norm);
        if (p1 && p2 && t.includes(p1) && t.includes(p2)) namesAgree++;
      }
    }
  }
  console.log(`\n  VODs carrying a chapter list: ${chaptered}/${vods.size}`);
  console.log(
    `  offsets inside a chapter:     ${inChapter} — ${within30} within 30s (${pct(within30, inChapter)}%), ${exact} exact (${pct(exact, inChapter)}%)`,
  );
  console.log(
    `  chapters naming a matchup:    ${vsChapters} — both handles agree ${namesAgree} (${pct(namesAgree, vsChapters)}%)`,
  );
  console.log(`  records with no chapter to check against: ${records.length - inChapter}`);

  const uploaders = new Map<string, number>();
  for (const r of records) uploaders.set(r.uploader, (uploaders.get(r.uploader) ?? 0) + 1);
  console.log(`\n  host channels (${uploaders.size}):`);
  for (const [name, n] of [...uploaders.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${name}`);
  }
  console.log(`\n  events (${byTag.size}):`);
  for (const [tag, n] of [...byTag.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${tag}`);
  }

  console.log(
    `\n✔ Stage 1 (index) complete — ${records.length} tagged tournament match(es) over ${byVod.size} VOD(s).`,
  );
  console.log('  Next: npm run data:parse');
}

main().catch((err) => {
  console.error(
    `\n✖ data:theater failed:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exit(1);
});
