/**
 * Diff the vendor's own patch announcements against scripts/patches.ts.
 *
 * SF6 does this against a wiki that pages every version. There is no such page
 * for this game — the vendor publishes no version string at all — so the source
 * of truth is the Steam news feed, where patches arrive as date-titled posts:
 *
 *     "Patch Update 8/10/2026"
 *
 * That IS the version grammar (see scripts/patches.ts), so this reads the feed,
 * normalises those dates to ISO, and reports anything the table is missing.
 *
 * THE TITLE IS NOT A STABLE FORMAT, and this script learned that the hard way.
 * After 8/10 the vendor switched to
 *
 *     "Patch Update - 21 August 2026"
 *
 * which the numeric pattern does not match. Unmatched titles were skipped in
 * silence, so the run printed "✓ the patch table matches every patch-titled
 * Steam post" while 2026-08-21 and 2026-08-28 were both missing — a checker
 * confirming exactly the staleness it exists to catch. Two lessons, both
 * implemented below: parse BOTH spellings, and treat a post titled "Patch
 * Update" whose date will not parse as a HARD FAILURE. A title we cannot read
 * is indistinguishable from a patch that did not happen, and only one of those
 * is safe to assume.
 *
 * NETWORK, MANUAL, NEVER IN THE CRON. A daily job that reached out to a
 * storefront API would fail on their outage rather than ours, and a patch table
 * is a human decision anyway — the script names the row, a person adds it.
 *
 * The cadence check that makes this discoverable lives in scripts/expiries.ts:
 * if the newest row here goes STALE_PATCH_DAYS stale, the workflow goes red and
 * names this command. That alarm was the only thing that fired when the parser
 * went blind, which is the argument for keeping it tighter than comfortable.
 *
 * Run: npm run data:patch-check
 */

import { PATCHES } from './patches';

const APPID = '3787240'; // MARVEL Tōkon: Fighting Souls
const FEED = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APPID}&count=50&maxlength=1`;

/** Anything the vendor calls a patch. Deliberately looser than either date
 *  pattern, so a title we cannot read still reaches the hard failure below
 *  instead of falling through as "not a patch". */
const PATCH_TITLE = /patch\s*update/i;
/** "Patch Update 8/10/2026" → 2026-08-10. Also tolerates "8-10-2026". */
const TITLE_NUMERIC = /patch\s*update\s*[-–—]?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i;
/** "Patch Update - 21 August 2026" → 2026-08-21, the spelling used since 8/21. */
const TITLE_LONG = /patch\s*update\s*[-–—]?\s*(\d{1,2})\s+([a-z]+)\s+(\d{4})/i;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const pad = (n: string) => n.padStart(2, '0');

/** The post's date as ISO, or null if neither spelling reads. */
function titleDate(title: string): string | null {
  const n = TITLE_NUMERIC.exec(title);
  if (n) return `${n[3]}-${pad(n[1]!)}-${pad(n[2]!)}`;
  const l = TITLE_LONG.exec(title);
  if (l) {
    const month = MONTHS.indexOf(l[2]!.toLowerCase());
    if (month >= 0) return `${l[3]}-${pad(String(month + 1))}-${pad(l[1]!)}`;
  }
  return null;
}

interface NewsItem {
  title: string;
  url: string;
  date: number;
}

const res = await fetch(FEED, { headers: { 'user-agent': 'tokon-replay-database/patch-check' } });
if (!res.ok) {
  console.error(`✖ Steam news feed returned HTTP ${res.status}`);
  process.exit(1);
}
const body = (await res.json()) as { appnews?: { newsitems?: NewsItem[] } };
const items = body.appnews?.newsitems ?? [];
if (!items.length) {
  console.error('✖ feed returned no items — the appid or the endpoint has moved');
  process.exit(1);
}

const announced = new Map<string, NewsItem>();
const unreadable: NewsItem[] = [];
for (const it of items) {
  if (!PATCH_TITLE.test(it.title)) continue;
  const day = titleDate(it.title);
  if (day) announced.set(day, it);
  else unreadable.push(it);
}

if (unreadable.length) {
  console.error(`✖ ${unreadable.length} post(s) titled "Patch Update" whose date will not parse:\n`);
  for (const it of unreadable) {
    console.error(`    ${JSON.stringify(it.title)}`);
    console.error(`    ${it.url}\n`);
  }
  console.error('  Refusing to report on the rest of the feed. A patch title this script');
  console.error('  cannot read is indistinguishable from a patch that never shipped, and');
  console.error('  skipping it quietly is precisely how 2026-08-21 and 2026-08-28 stayed');
  console.error('  missing while this command printed a tick. Teach titleDate() the new');
  console.error('  spelling first; every other number below is untrustworthy until then.');
  process.exit(1);
}

const known = new Set(PATCHES.map((p) => p.version));
const missing = [...announced.keys()].filter((d) => !known.has(d)).sort();
const unannounced = [...known].filter((d) => !announced.has(d)).sort();

console.log(`Steam news: ${items.length} posts, ${announced.size} patch-titled`);
console.log(`Table:      ${PATCHES.length} rows, newest ${PATCHES.at(-1)?.version}\n`);

if (missing.length) {
  console.log(`⚠ ${missing.length} announced patch(es) NOT in scripts/patches.ts:\n`);
  for (const d of missing) {
    console.log(`  { version: '${d}', start: '${d}', announcedOn: 'steam',`);
    console.log(`    note: ${JSON.stringify(announced.get(d)!.title)} },`);
    console.log(`    ${announced.get(d)!.url}\n`);
  }
  console.log('  Add them in date order, then re-run `npm run data:emit`.');
  console.log('  Every replay published since a missing patch is currently filed');
  console.log('  under the previous token — it renders and filters cleanly, and is wrong.\n');
}

if (unannounced.length) {
  // Not an error: the launch build has no Steam post at all (its notes went to
  // X and Discord), which is exactly why PatchBoundary carries `announcedOn`.
  console.log(`ⓘ ${unannounced.length} table row(s) with no matching Steam post:`);
  for (const d of unannounced) {
    const row = PATCHES.find((p) => p.version === d)!;
    console.log(`    ${d}  announcedOn: '${row.announcedOn}'${row.note ? ` — ${row.note}` : ''}`);
  }
  console.log('    Fine when announcedOn is launch/x/discord; suspicious when it says steam.\n');
}

if (!missing.length) console.log('✓ the patch table matches every patch-titled Steam post');
process.exit(missing.length ? 1 : 0);
