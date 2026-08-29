// Stage 1: fetch every upload from the tracked Tōkon channels via the YouTube
// Data API v3, dump raw metadata to raw/<channel>.json, and print a
// reconnaissance report. The API key is LOCAL/CI-ONLY (never on Vercel — the
// site builds from committed JSON).
//
// NO GAME GATE HERE. raw/ holds everything the channels publish, including the
// 439 Fighting Station X uploads that are CPU matches and shorts, and parse.ts
// does the filtering. That choice has one important consequence: the collapse
// guard must compare PARSED-vs-COMMITTED, never raw-vs-committed, or it would
// be measuring the game filter instead of the channel's health.
//
// Run: npm run data:fetch   (tsx --env-file-if-exists=.env scripts/fetch.ts)

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACTIVE_CHANNELS, CHANNELS } from './channels';
import { apiGet, parseDuration, requireApiKey } from './youtube';
import type { ChannelConfig, RawVideoRecord } from '../types/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'raw');
requireApiKey('data:fetch');

// ── typed slices of the API responses (only the fields we read) ──────────────
interface PlaylistItemsResponse {
  items: { contentDetails: { videoId: string } }[];
  nextPageToken?: string;
}
interface VideosResponse {
  items: {
    id: string;
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      liveBroadcastContent: string;
      tags?: string[];
    };
    contentDetails: { duration?: string };
    statistics?: { viewCount?: string };
  }[];
}

async function fetchChannel(ch: ChannelConfig): Promise<RawVideoRecord[]> {
  // An index source has no channel and no playlist; it is pulled by
  // `npm run data:theater` and skipped by the caller. Asserted rather than
  // assumed, because reaching here with one would otherwise page YouTube for
  // `playlistId=undefined` and return an empty dump that looks like a dead
  // channel.
  if (!ch.uploadsPlaylist) {
    throw new Error(
      `${ch.id} has no uploadsPlaylist — an index source must be skipped before fetchChannel.`,
    );
  }

  // 1) every videoId from the uploads playlist (50/page)
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page: PlaylistItemsResponse = await apiGet('playlistItems', {
      part: 'contentDetails',
      playlistId: ch.uploadsPlaylist,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const it of page.items) ids.push(it.contentDetails.videoId);
    pageToken = page.nextPageToken;
  } while (pageToken);

  // 2) hydrate in chunks of 50 (title/description/duration/views)
  const records: RawVideoRecord[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res: VideosResponse = await apiGet('videos', {
      part: 'snippet,contentDetails,statistics',
      id: chunk.join(','),
      maxResults: '50',
    });
    for (const v of res.items) {
      records.push({
        id: v.id,
        channel: ch.id,
        title: v.snippet.title,
        description: v.snippet.description,
        publishedAt: v.snippet.publishedAt,
        durationSec: parseDuration(v.contentDetails.duration),
        ...(v.statistics?.viewCount ? { viewCount: Number(v.statistics.viewCount) } : {}),
        liveBroadcastContent: v.snippet.liveBroadcastContent,
        ...(v.snippet.tags ? { tags: v.snippet.tags } : {}),
      });
    }
    if ((i / 50) % 20 === 19) console.log(`  …${ch.id}: ${records.length}/${ids.length}`);
  }
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONNAISSANCE — console only, and deliberately NOT a gate.
//
// Its job is to make a grammar drift visible the DAY it lands rather than the
// week someone notices the counts sagging. This is not hypothetical: running an
// approximate shape check over the corpus is exactly what revealed that Tōkon's
// ▰ grammar has three variants and that one channel reverses its second slot.
//
// It must never gate parsing. An approximate regex that rejects a real title is
// a silent data loss; the same regex printing a line a human reads is free.
// ─────────────────────────────────────────────────────────────────────────────
const EXPECTED_SHAPE = /▰[^▰]*\([^)]*\)[^▰]*\bvs\.?\b[^▰]*\([^)]*\)/iu;
const ROSTER_HINT =
  /\b(magik|storm|blade|carnage|loki|hulk|magneto|wolverine|deadpool|champion|doom|goblin|spider|panther|danger)\b/i;

function recon(ch: ChannelConfig, records: RawVideoRecord[]): void {
  const shaped = records.filter((r) => EXPECTED_SHAPE.test(r.title.normalize('NFC')));
  const bar = records.filter((r) => r.title.includes('▰'));
  // A title that names a fighter but does NOT match the shape is the signal
  // that matters: it is match-shaped content the parser will drop.
  const suspicious = records.filter(
    (r) => !EXPECTED_SHAPE.test(r.title.normalize('NFC')) && ROSTER_HINT.test(r.title),
  );
  const benched = ch.descriptionBench
    ? records.filter((r) => /\([^)]*,[^)]*\)|\band\b[^)]*\)/i.test(r.description.slice(0, 900)))
        .length
    : 0;

  console.log(`    recon: ${bar.length} with ▰ · ${shaped.length} match the expected shape`);
  if (ch.descriptionBench) {
    console.log(
      `           description bench (${ch.descriptionBench}): ~${benched}/${records.length} carry a multi-name paren`,
    );
  }
  if (suspicious.length) {
    console.log(`           ⚠ ${suspicious.length} title(s) name a fighter but miss the shape:`);
    for (const r of suspicious.slice(0, 8)) console.log(`             · ${r.title.slice(0, 96)}`);
    if (suspicious.length > 8) console.log(`             … and ${suspicious.length - 8} more`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
await mkdir(RAW_DIR, { recursive: true });
const frozen = CHANNELS.filter((c) => c.frozen);
console.log(
  `Fetching ${ACTIVE_CHANNELS.length} channel(s)` +
    (frozen.length
      ? `; skipping ${frozen.length} frozen (${frozen.map((f) => f.id).join(', ')})`
      : '') +
    '…',
);
for (const ch of ACTIVE_CHANNELS) {
  const t0 = Date.now();
  const records = await fetchChannel(ch);
  records.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  await writeFile(join(RAW_DIR, `${ch.id}.json`), JSON.stringify(records, null, 1) + '\n', 'utf8');
  const dates = records.map((r) => r.publishedAt.slice(0, 10));
  console.log(
    `✔ ${ch.id} (${ch.name}): ${records.length} uploads, ${dates[dates.length - 1] ?? '—'} → ${dates[0] ?? '—'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  recon(ch, records);
}
console.log('Done. Next: npm run data:parse');
