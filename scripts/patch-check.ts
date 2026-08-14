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
 * NETWORK, MANUAL, NEVER IN THE CRON. A daily job that reached out to a
 * storefront API would fail on their outage rather than ours, and a patch table
 * is a human decision anyway — the script names the row, a person adds it.
 *
 * The cadence check that makes this discoverable lives in scripts/expiries.ts:
 * if the newest row here goes 21 days stale, the workflow goes red and names
 * this command.
 *
 * Run: npm run data:patch-check
 */

import { PATCHES } from './patches';

const APPID = '3787240'; // MARVEL Tōkon: Fighting Souls
const FEED = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APPID}&count=50&maxlength=1`;

/** "Patch Update 8/10/2026" → 2026-08-10. Also tolerates "8-10-2026". */
const TITLE_DATE = /patch\s*update\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i;
const iso = (m: RegExpMatchArray) => `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;

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
for (const it of items) {
  const m = TITLE_DATE.exec(it.title);
  if (m) announced.set(iso(m), it);
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
