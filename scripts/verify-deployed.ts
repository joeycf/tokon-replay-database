/**
 * Post-deploy smoke check — the collapse guard's downstream twin.
 *
 * scripts/parse.ts protects the REPOSITORY: it refuses to write when a channel
 * loses records. This protects what visitors actually get, which is a different
 * thing — the repo can be perfect while production serves a build from before
 * the push, or from a build that failed.
 *
 * IT POLLS, deliberately. Vercel builds asynchronously off the git push and
 * there is no post-deploy hook to run after, so a single fetch races the build
 * and reports yesterday's payload as a collapse.
 *
 * A slow build is NOT a failure while the shortfall is inside the SAME band the
 * collapse guard uses (>10% AND >20 records) — the two gates agree on what the
 * word "collapse" means, which is the point of duplicating the constants rather
 * than importing a different pair. Out of band at the deadline is a hard fail.
 *
 * THE FETCH IS CACHE-COLD. `no-store` plus a cache-busting query is not
 * paranoia: a cached probe once produced a confident, wrong, nine-hour-old
 * conclusion about production on this platform.
 *
 * IT COMPARES CONTENT, NOT ONLY THE RECORD COUNT. Counting records catches the
 * failure this script was written for — an archive collapsing — and is blind to
 * the one that actually happens most often here, which is a record's CHARACTERS
 * changing while the count does not. Measured: a push that completed 227 sides
 * left the count at 228 either side of it, and this check reported "✓ Production
 * serves the committed archive" against a build that had none of the work. Two
 * polls served stale content before the third matched, so the green was not even
 * momentary.
 *
 * So the comparison is a digest: count, complete-side total, and a hash over every
 * record's id and characters. Failure semantics are deliberately UNCHANGED — a
 * count collapse past the band is still the only hard failure, because a hash
 * mismatch cannot tell a slow build from a wrong one and builds here are async.
 * What changes is that the success claim is now true when it is made.
 *
 * Run: npm run verify:deployed
 *   SMOKE_HOST     default https://replaydatabase.com — point at the game's own
 *                  *.vercel.app before the shell rewrite exists
 *   SMOKE_TIMEOUT_SEC (900) · SMOKE_INTERVAL_SEC (20)
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** This app's URL segment — app/app.config.ts game.slug. */
const SLUG = 'tokon';
/** The apex the shell owns; it edge-rewrites /<slug>/* to this project. */
const HOST = (process.env.SMOKE_HOST ?? 'https://replaydatabase.com').replace(/\/$/, '');

const TIMEOUT_SEC = Number(process.env.SMOKE_TIMEOUT_SEC ?? 900);
const INTERVAL_SEC = Number(process.env.SMOKE_INTERVAL_SEC ?? 20);

// The collapse guard's thresholds, deliberately identical (scripts/parse.ts).
// Both are required: a percentage alone punishes a small archive for ordinary
// churn, an absolute alone misses a large one bleeding slowly.
//
// Worth knowing at this archive's size: 20 records is ~13% of 153, so the
// ABSOLUTE term dominates here and the percentage never binds. That is the
// guard being honest about a young corpus rather than a mis-tuning — see the
// same note in parse.ts.
const COLLAPSE_PCT = 0.1;
const COLLAPSE_ABS = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Digest {
  count: number;
  complete: number;
  hash: string;
}

/** Digest of a replays payload: how many records, how many saturated sides, and a
 *  hash over the characters themselves. The hash is what makes a completeness-only
 *  change visible; `complete` is carried beside it so a mismatch is legible rather
 *  than just two different hex strings. */
function digest(payload: unknown): Digest | null {
  if (!Array.isArray(payload)) return null;
  const h = createHash('sha256');
  let complete = 0;
  for (const r of payload as { id?: string; sides?: { characters?: string[] }[] }[]) {
    h.update(String(r.id ?? ''));
    for (const s of r.sides ?? []) {
      const cs = s.characters ?? [];
      if (cs.length >= 4) complete++;
      h.update('|' + cs.join(','));
    }
    h.update(';');
  }
  return { count: payload.length, complete, hash: h.digest('hex').slice(0, 12) };
}

const same = (a: Digest, b: Digest): boolean => a.count === b.count && a.hash === b.hash;
const show = (d: Digest): string =>
  `${d.count.toLocaleString('en-US')} replays · ${d.complete} complete sides · ${d.hash}`;

async function servedDigest(url: string): Promise<Digest | null> {
  try {
    const res = await fetch(`${url}?_cb=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
      redirect: 'follow',
    });
    if (!res.ok) {
      console.log(`   … HTTP ${res.status}`);
      return null;
    }
    const d = digest(await res.json());
    if (!d) console.log('   … payload is not an array');
    return d;
  } catch (e) {
    console.log(`   … ${(e as Error).message}`);
    return null;
  }
}

const local = digest(JSON.parse(readFileSync(join(ROOT, 'data', 'replays.json'), 'utf8')));
if (!local) {
  console.error('✖ data/replays.json is not an array — nothing to compare against.');
  process.exit(1);
}
const committed = local.count;
const url = `${HOST}/${SLUG}/data/replays.json`;

console.log(`Smoke check: ${url}`);
console.log(`  committed ${show(local)} · polling ${TIMEOUT_SEC}s`);

const deadline = Date.now() + TIMEOUT_SEC * 1000;
let last: Digest | null = null;

for (let attempt = 1; ; attempt++) {
  const d = await servedDigest(url);
  if (d !== null) {
    last = d;
    const lost = committed - d.count;
    const pct = committed > 0 ? (lost / committed) * 100 : 0;
    // A count that matches while the hash does not is the case this script used to
    // call success: same records, different characters. Named explicitly so the
    // log says which of the two it is waiting on.
    const why =
      lost !== 0
        ? `  (${lost > 0 ? '-' : '+'}${Math.abs(lost)} records, ${pct.toFixed(1)}%)`
        : `  (same count, content differs — ${d.complete} complete vs ${local.complete})`;
    console.log(`  [${attempt}] served ${show(d)}${same(local, d) ? '  ✓ matches' : why}`);
    if (same(local, d)) {
      console.log(`\n✓ Production serves the committed archive — ${show(d)}.`);
      process.exit(0);
    }
  }
  if (Date.now() + INTERVAL_SEC * 1000 >= deadline) break;
  await sleep(INTERVAL_SEC * 1000);
}

if (last === null) {
  console.error(
    `\n✖ Never got a readable payload from ${url} in ${TIMEOUT_SEC}s.\n` +
      '  That is not a slow deploy — the file is missing, unparseable, or the\n' +
      '  route is broken. Check the deployment and the shell rewrite.',
  );
  process.exit(1);
}

const lost = committed - last.count;
// Signed on purpose: a LARGER served count (negative `lost`) means the local
// checkout is behind production, which is not a collapse.
const collapsed = lost > COLLAPSE_ABS && lost / committed > COLLAPSE_PCT;

if (!collapsed) {
  console.warn(
    `\n⚠ Deploy has not landed within ${TIMEOUT_SEC}s.\n` +
      `  committed ${show(local)}\n` +
      `  served    ${show(last)}\n` +
      (lost === 0
        ? '  The record count matches and the CONTENT does not, so this is a build\n' +
          '  that has not shipped the latest characters yet — the failure mode a\n' +
          '  count-only check reported as success.\n'
        : '  That is inside the collapse band, so what is live is a stale build, not\n' +
          '  a lost archive.\n') +
      '  Re-run this check, or watch the Vercel deployment.',
  );
  process.exit(0);
}

console.error(
  `\n✖ PRODUCTION IS SERVING A COLLAPSED ARCHIVE.\n` +
    `  committed ${committed.toLocaleString('en-US')} · served ${last.count.toLocaleString('en-US')} · lost ${lost.toLocaleString('en-US')} (${((lost / committed) * 100).toFixed(1)}%)\n` +
    `  Past the ${COLLAPSE_PCT * 100}% AND ${COLLAPSE_ABS}-record band after ${TIMEOUT_SEC}s, so this is\n` +
    '  not a build still in flight. Visitors are seeing this right now.\n\n' +
    '  Check the latest Vercel deployment for this project, and confirm\n' +
    '  data/replays.json in the repo is the archive you meant to publish.',
);
process.exit(1);
