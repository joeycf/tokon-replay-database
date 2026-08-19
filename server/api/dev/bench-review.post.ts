/**
 * Dev-only: write one hand-read side into data/overrides.json.
 *
 * Body: { i, a: [3 ids], b: [3 ids], force? }  — the three assists read from each
 * of the item's two frames.
 *
 * THE TWO FRAMES ARE COMPARED AS SETS, NOT CELL BY CELL. The icons permute between
 * cells as the point fighter changes, so "cell A disagrees with cell A" would fire
 * constantly on frames that agree perfectly about who is on the team. What must
 * match is {point} + {three assists} from each frame. A mismatch is refused rather
 * than silently merged, because a side that reads two different benches is exactly
 * the case a person should look at again — `force` exists for when one frame is
 * genuinely occluded and the labeller has decided which to trust.
 *
 * A HUMAN READ REPLACES THE SIDE. It does not merge with the description: 4 of 189
 * hand-read slots named a fighter absent from BOTH described benches, and when the
 * pixels and the prose disagree the pixels win. Existing tiers stay recorded in
 * `tiers` and in `fromDescription`, so nothing is lost — only superseded.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Body {
  /** identity of the side, as handed out by the GET — NOT a list position */
  video?: unknown;
  side?: unknown;
  i?: unknown;
  a?: unknown;
  b?: unknown;
  force?: unknown;
}
interface SideRec {
  characters: string[];
  provenance: Record<string, unknown> & { tiers?: string[] };
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const body = (await readBody(event)) as Body;
  const work = buildBenchList();
  // RESOLVE BY IDENTITY. The worklist is derived from extracted.json and grows
  // while a fetch runs, so a position captured when the page rendered can name a
  // different side by the time the save arrives — measured live, a list loaded at
  // 160 sides answered a save against 192. An index is accepted only as a legacy
  // fallback when no identity was sent.
  const wantVideo = String(body.video ?? '');
  const wantSide = String(body.side ?? '');
  const w = wantVideo
    ? work.find((x) => x.video === wantVideo && x.side === wantSide)
    : work[Number(body.i)];
  if (!w) {
    throw createError({
      statusCode: 409,
      statusMessage: 'that side is no longer in the bench queue — refresh the page',
    });
  }

  const roster = new Set(readJson<{ id: string }[]>('data/characters.json', []).map((c) => c.id));
  const trio = (raw: unknown, which: string): string[] => {
    if (!Array.isArray(raw) || raw.length !== 3) {
      throw createError({ statusCode: 400, statusMessage: `${which}: expected three fighters` });
    }
    const ids = raw.map(String);
    for (const id of ids) {
      if (!roster.has(id)) {
        throw createError({ statusCode: 400, statusMessage: `unknown fighter id "${id}"` });
      }
    }
    return ids;
  };
  const a = trio(body.a, 'frame A');
  const b = trio(body.b, 'frame B');

  const setOf = (point: string, three: string[]) => [...new Set([point, ...three])].sort().join(',');
  const setA = setOf(w.points[0], a);
  const setB = setOf(w.points[1], b);
  if (setA !== setB && body.force !== true) {
    return {
      ok: false,
      disagree: true,
      a: setA.split(','),
      b: setB.split(','),
      message: 'the two frames read different benches — resolve, or resend with force',
    };
  }

  // point first: they held the plate at the moment the frame was taken
  const characters = [...new Set([w.points[0], ...a])];

  const path = join(process.cwd(), 'data/overrides.json');
  const overrides = readJson<Record<string, { sides?: SideRec[]; [k: string]: unknown }>>(
    'data/overrides.json',
    {},
  );
  const videos = readJson<{ id: string; sides: SideRec[] }[]>('data/videos.json', []);
  const v = videos.find((x) => x.id === w.video);
  if (!v) throw createError({ statusCode: 404, statusMessage: 'video not in videos.json' });

  // start from any existing override so the OTHER side's work is never clobbered
  const existing = overrides[w.video] ?? {};
  const baseSides = (existing.sides ?? v.sides) as SideRec[];
  const sides = baseSides.map((s, k) =>
    k !== w.sideIndex
      ? s
      : {
          ...s,
          characters,
          provenance: {
            ...s.provenance,
            tier: 'human',
            tiers: [...(s.provenance.tiers ?? []), 'human'],
            fromHuman: characters,
            /** WHAT WAS PICKED, per frame, beside WHAT WAS CONCLUDED.
             *
             *  `fromHuman` is the answer; this is the evidence for it. Frame A's
             *  reading is recoverable from the answer alone — it is the characters
             *  minus that frame's point fighter — but which cell held whom, and
             *  what the second frame showed when a save was FORCED past a
             *  disagreement, are not. Recording them lets a side be reopened and
             *  seen exactly as it was read. */
            humanPicks: { a, b, forced: setA !== setB },
            complete: characters.length >= 4,
            forced: setA !== setB ? true : undefined,
          },
        },
  );

  overrides[w.video] = {
    ...existing,
    '//': `bench-completion: read by a person from the HUD portrait cluster [${new Date().toISOString().slice(0, 10)}]`,
    sides,
    resolvedBy: 'human',
  };
  writeFileSync(path, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
  return { ok: true, characters, complete: characters.length >= 4 };
});
