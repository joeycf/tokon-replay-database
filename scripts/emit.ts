/**
 * Emit the engine-facing artifacts from the parse substrate.
 *
 * data/videos.json (rich, pipeline-shaped) → data/replays.json + stats.json +
 * summary.json + patchGroups.json + patchBoundaries.json (narrow,
 * engine-shaped). This is the two-schema boundary the platform runs on, and
 * every contract assertion below is a throw: a silent schema drift here is
 * invisible until a panel renders wrong.
 *
 * Run: npm run data:emit   (parse.ts also calls emitGeneric directly)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PATCHES,
  buildPatchGroups,
  patchForDate,
  patchWindows,
  seasonToken,
  validatePatches,
  validateSeasons,
} from './patches';
import { buildStats, CHARACTERS_PER_SIDE, sort1 } from './stats';
import type { CharacterRecord, MatchVideo, PlayerRecord, VideoOverride } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Mirrors app/app.config.ts, which is the authority. The shell's
 *  verify:cutover asserts these two values against its own GAMES table, so a
 *  drift fails at the apex rather than here. */
const GAME_ID = 'tokon';
const GAME_NAME = 'MARVEL Tōkon: Fighting Souls';

// ── the engine contract, restated locally ────────────────────────────────────
// The pipeline can't resolve the Nuxt `@engine` alias, so the emitted shapes
// are declared here. They must mirror replay-engine/types/replay.ts.
//
// Note what is NOT here: `provenance`. The substrate's MatchSide carries it and
// the emitted GenericSide does not, which is the whole point — the rich
// pipeline record projects DOWN to the narrow public contract. toReplay() below
// builds sides field-by-field rather than spreading, so provenance cannot leak
// by construction; the assertion further down proves it anyway, because
// "cannot happen by construction" is exactly what people say before it does.
export interface GenericSide {
  player: string;
  characters: string[];
}
export interface GenericReplay {
  id: string;
  sides: [GenericSide, GenericSide];
  date: string;
  patch?: string;
  source: string;
  title: string;
  views?: number;
  durationSec?: number;
}

/**
 * The fine patch token for a capture date, with the era token as the documented
 * "era known, patch unknown" fallback (the grouped facet expands a parent
 * selection to itself PLUS its children, so an era-token replay still matches
 * `?patch=S1`).
 *
 * For Tōkon the fine token is a DATE — the vendor publishes no version string
 * (see scripts/patches.ts). Nothing in the corpus names a patch, so the token
 * is a pure function of publishedAt against the table and is derived here
 * rather than stored on the substrate; storing it would be a second copy of a
 * date lookup that can never disagree with the first.
 */
function patchToken(v: MatchVideo, windows = patchWindows()): string {
  const w = patchForDate(v.publishedAt, windows);
  return w && w.season === v.season ? w.version : seasonToken(v.season);
}

/** `thumb` is deliberately NEVER emitted: Replay.id is a YouTube id and the
 *  engine derives the thumbnail URL at render time. Emitting it would add
 *  ~1 MB to the whale for a string every client can compute. */
function toReplay(v: MatchVideo, windows = patchWindows()): GenericReplay {
  return {
    id: v.id,
    sides: v.sides.map((s) => ({
      player: s.player,
      characters: s.characters,
    })) as [GenericSide, GenericSide],
    date: v.publishedAt,
    patch: patchToken(v, windows),
    source: v.channel,
    title: v.title,
    ...(v.viewCount !== undefined ? { views: v.viewCount } : {}),
    ...(v.durationSec ? { durationSec: v.durationSec } : {}),
  };
}

/** Manual corrections, applied last. A hand verdict beats every automatic tier. */
export function applyOverrides(
  records: MatchVideo[],
  overrides: Record<string, VideoOverride>,
): MatchVideo[] {
  const excluded = new Set(
    Object.entries(overrides)
      .filter(([, ov]) => ov.exclude === true)
      .map(([id]) => id),
  );
  const out: MatchVideo[] = [];
  for (const v of records) {
    if (excluded.has(v.id)) continue;
    const ov = overrides[v.id];
    out.push(
      ov
        ? {
            ...v,
            ...(ov.season ? { season: ov.season } : {}),
            ...(ov.sides ? { sides: ov.sides } : {}),
            ...(ov.channel ? { channel: ov.channel } : {}),
          }
        : v,
    );
  }
  if (excluded.size > 0) {
    console.log(`  overrides.json excludes ${records.length - out.length} record(s)`);
  }
  return out;
}

export async function emitGeneric(
  records: MatchVideo[],
  characters: CharacterRecord[],
  players: PlayerRecord[],
  sources: string[],
): Promise<void> {
  validateSeasons();
  validatePatches();

  const windows = patchWindows();
  const replays = records.map((v) => toReplay(v, windows));

  /**
   * EMPTY-CORPUS MODE.
   *
   * Guarded on `records.length === 0` alone — never an env flag, so it cannot
   * be switched on by accident in production. It exists because the site must
   * be provably buildable and gate-green BEFORE any corpus is committed, which
   * is the whole deliverable of a corpus-independent stage. Several assertions
   * below are correct precisely because they fire on an empty registry; those
   * are SKIPPED here rather than weakened, and the roster assertion is
   * tightened instead — a zero-record build with a zero-length roster is a
   * broken build, not an empty one.
   */
  const empty = records.length === 0;
  if (empty) {
    if (characters.length === 0) {
      throw new Error('emit: empty corpus is fine; an empty ROSTER is not — run data:characters');
    }
    console.log('  ⓘ empty-corpus mode: 0 records. Registry + patch assertions still run.');
  }

  /**
   * The facet hierarchy, minus any era the corpus cannot fill.
   *
   * An era with no records renders as a chip that filters to nothing — the
   * exact failure scripts/patches.ts refuses to pre-declare a future season
   * for. S0 (pre-release) is the live case, and it is not hypothetical: it is
   * REAL AND EMPTY at the same time, because its ten EVO exhibition matches
   * name no fighters in their titles and sit in the review queue until a person
   * reads them off the footage. Shipping its chip meanwhile advertises a filter
   * with nothing behind it.
   *
   * Derived from the records rather than authored, so nothing has to remember
   * to switch it back on: the day the first pre-release verdict lands, the
   * era's own count stops being zero and the chip appears. Children are pruned
   * on the same rule for the same reason.
   *
   * Empty-corpus mode is exempt — with zero records this would prune everything,
   * and the patch assertions below are correct precisely because they run
   * against the full hierarchy on an empty registry.
   */
  const liveTokens = new Set(replays.map((r) => r.patch!));
  const groups = buildPatchGroups()
    .map((g) => ({
      ...g,
      ...(g.children ? { children: g.children.filter((c) => liveTokens.has(c.id)) } : {}),
    }))
    .filter((g) => empty || liveTokens.has(g.id) || (g.children?.length ?? 0) > 0);

  // ── contract assertions: every one a throw ────────────────────────────────
  if (replays.length !== records.length) {
    throw new Error(`emit: replay count ${replays.length} !== record count ${records.length}`);
  }

  const charIds = new Set(characters.map((c) => c.id));
  const playerIds = new Set(players.map((p) => p.id));
  const sourceIds = new Set(sources);
  const patchTokens = new Set<string>([
    ...PATCHES.map((p) => p.version),
    ...groups.map((g) => g.id),
  ]);

  for (const r of replays) {
    if (r.sides.length !== 2) throw new Error(`emit: ${r.id} lost its two-sides invariant`);
    for (const s of r.sides) {
      // HARD-FAIL ONLY ON ZERO. A side of 1..3 is a partially-known bench —
      // true, publishable data that the extractor fills in over time. A side
      // of 5+ is a mid-set team change, which is also legal. Zero is the only
      // state that means "we know nothing", and it must never ship.
      if (s.characters.length === 0) {
        throw new Error(`emit: ${r.id} has a side with no character`);
      }
      for (const c of s.characters) {
        if (!charIds.has(c)) throw new Error(`emit: ${r.id} references unknown character '${c}'`);
      }
      if (!playerIds.has(s.player)) {
        throw new Error(`emit: ${r.id} references unknown player '${s.player}'`);
      }
    }
    if (!sourceIds.has(r.source)) {
      throw new Error(`emit: ${r.id} references untracked source '${r.source}'`);
    }
    if (!patchTokens.has(r.patch!)) {
      throw new Error(`emit: ${r.id} carries unknown patch token '${r.patch}'`);
    }
  }

  // No provenance may reach the public contract. This is asserted on the
  // SERIALIZED payload, not the objects, because that is what ships.
  const serialized = JSON.stringify(replays);
  if (serialized.includes('"provenance"')) {
    throw new Error(
      'emit: provenance leaked into replays.json — toReplay must project, not spread',
    );
  }

  // patchGroups ids must be unique across parents AND children. The engine
  // documents this as a MUST and does not validate it; a collision makes one
  // token unreachable in the facet while everything still renders.
  const seenIds = new Set<string>();
  for (const g of groups) {
    if (seenIds.has(g.id)) throw new Error(`emit: patchGroups id '${g.id}' appears twice`);
    seenIds.add(g.id);
    for (const c of g.children ?? []) {
      if (seenIds.has(c.id)) throw new Error(`emit: patchGroups id '${c.id}' appears twice`);
      seenIds.add(c.id);
    }
  }
  const ungrouped = [...new Set(replays.map((r) => r.patch!))].filter((t) => !seenIds.has(t));
  if (ungrouped.length) {
    throw new Error(`emit: patch token(s) no group accounts for: ${ungrouped.join(', ')}`);
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  const pipelineStats = buildStats(records);
  const byPatchUsage = sort1(
    Object.fromEntries(
      Object.entries(pipelineStats.bySeasonUsage).map(([s, m]) => [seasonToken(Number(s)), m]),
    ),
  );
  const byPatch = sort1(
    Object.fromEntries(
      Object.entries(pipelineStats.totals.bySeason).map(([s, n]) => [seasonToken(Number(s)), n]),
    ),
  );
  const genericStats = {
    totals: {
      replays: records.length,
      characters: characters.length,
      players: players.length,
      byPatch,
    },
    characterUsage: pipelineStats.characterUsage,
    byPatchUsage,
    playerCharacters: pipelineStats.playerCharacters,
  };

  // THE UNIT ASSERTION. characterUsage counts side appearances, so the total is
  // the sum of every side's list length. NOT records × 8 — Tōkon's sides are
  // 1..4 long while the bench fills in, and a future mid-set team change makes
  // one longer still. See scripts/stats.ts before "fixing" this.
  const usageTotal = Object.values(pipelineStats.characterUsage).reduce((a, b) => a + b, 0);
  const expectedUsage = records.reduce(
    (n, r) => n + r.sides.reduce((m, s) => m + s.characters.length, 0),
    0,
  );
  if (usageTotal !== expectedUsage) {
    throw new Error(
      `emit: characterUsage sums to ${usageTotal}, expected ${expectedUsage} side appearances`,
    );
  }

  // ── the shell selector's payload ──────────────────────────────────────────
  // `updated` is the newest replay's DATE, never build time. A build timestamp
  // would rewrite this file on a zero-new-video day and defeat the cron's
  // commit guard, turning every no-op day into a commit and a deploy.
  const newest = records.reduce((max, v) => (v.publishedAt > max ? v.publishedAt : max), '');
  const summary = {
    game: GAME_ID,
    name: GAME_NAME,
    replays: genericStats.totals.replays,
    players: genericStats.totals.players,
    characters: genericStats.totals.characters,
    updated: empty ? null : newest.slice(0, 10),
  };
  if (summary.replays !== replays.length) {
    throw new Error(`emit: summary.replays ${summary.replays} !== emitted count ${replays.length}`);
  }
  if (summary.characters < 1) {
    throw new Error(`emit: summary has an empty character registry`);
  }
  if (!empty) {
    // Both of these fire correctly at zero records, which is why they are
    // skipped above rather than loosened.
    if (summary.players < 1) throw new Error('emit: summary has an empty player registry');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(summary.updated!)) {
      throw new Error(`emit: summary.updated is not a replay date ("${summary.updated}")`);
    }
  }

  const dataDir = join(ROOT, 'data');
  const publicDataDir = join(ROOT, 'public', 'data');
  await mkdir(publicDataDir, { recursive: true });

  // no indent on the whale — it is fetched by every visitor
  const whale = JSON.stringify(replays) + '\n';
  await writeFile(join(dataDir, 'replays.json'), whale, 'utf8');
  await writeFile(join(publicDataDir, 'replays.json'), whale, 'utf8');
  const summaryJson = JSON.stringify(summary, null, 2) + '\n';
  await writeFile(join(dataDir, 'summary.json'), summaryJson, 'utf8');
  await writeFile(join(publicDataDir, 'summary.json'), summaryJson, 'utf8');
  await writeFile(
    join(dataDir, 'stats.json'),
    JSON.stringify(genericStats, null, 2) + '\n',
    'utf8',
  );
  await writeFile(
    join(dataDir, 'patchGroups.json'),
    JSON.stringify(groups, null, 2) + '\n',
    'utf8',
  );
  // The patch table mirrored to data/, so the e2e can derive its expected
  // per-patch counts from a committed artifact by walking the windows itself,
  // instead of importing the module it is meant to be testing.
  await writeFile(
    join(dataDir, 'patchBoundaries.json'),
    JSON.stringify(PATCHES, null, 2) + '\n',
    'utf8',
  );

  const byToken = replays.reduce<Record<string, number>>((acc, r) => {
    acc[r.patch!] = (acc[r.patch!] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `✔ emitted ${replays.length} replays, ${characters.length} fighters, ${players.length} players`,
  );
  console.log(
    `  eras:    ${
      Object.entries(byPatch)
        .map(([k, n]) => `${k}=${n}`)
        .join(' ') || '—'
    }`,
  );
  console.log(
    `  patches: ${PATCHES.map((p) => `${p.version}=${byToken[p.version] ?? 0}`).join(' ')}`,
  );
  const sideCount = records.length * 2;
  console.log(
    `  unit:    ${usageTotal} side appearances over ${sideCount} sides` +
      (sideCount
        ? ` (mean ${(usageTotal / sideCount).toFixed(2)} of ${CHARACTERS_PER_SIDE})`
        : '') +
      (pipelineStats.oversizeSides
        ? `  ·  ${pipelineStats.oversizeSides} oversize (pairing-excluded)`
        : ''),
  );
  console.log(`  summary: ${summary.replays} replays, newest ${summary.updated ?? '—'}`);
}

// ── standalone entry ─────────────────────────────────────────────────────────
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const read = async <T>(p: string, fallback?: T): Promise<T> => {
    try {
      return JSON.parse(await readFile(join(ROOT, 'data', p), 'utf8')) as T;
    } catch (e) {
      if (fallback !== undefined) return fallback;
      throw e;
    }
  };

  const videos = await read<MatchVideo[]>('videos.json', []);
  const characters = await read<CharacterRecord[]>('characters.json');
  const players = await read<PlayerRecord[]>('players.json', []);
  const overrides = await read<Record<string, VideoOverride>>('overrides.json', {});
  const { CHANNELS } = await import('./channels');

  await emitGeneric(
    applyOverrides(videos, overrides),
    characters,
    players,
    CHANNELS.map((c) => c.source),
  );
}
