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
// The pipeline's own constant, not a second 4. stats.ts owns it and emit's
// oversize accounting keys off the same value.
import { CHARACTERS_PER_SIDE } from '../../../scripts/stats';

interface Body {
  /** identity of the side, as handed out by the GET — NOT a list position */
  video?: unknown;
  side?: unknown;
  /** which record side this screen side is, when the plate could not say */
  sideIndex?: unknown;
  i?: unknown;
  a?: unknown;
  b?: unknown;
  force?: unknown;
  /** the two frames disagree because the TEAM CHANGED — keep both readings */
  union?: unknown;
  /** the title names a fighter the footage never showed — keep BOTH */
  keepTitled?: unknown;
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

  // WHICH RECORD SIDE. The plate supplies it when a title-known fighter appears on
  // exactly one side; otherwise the reviewer reads the player's handle off the HUD
  // and says. Never guessed from title ORDER — one uploader reverses its second
  // slot on 27 of 34 uploads.
  const sideIndex = w.sideIndex ?? Number(body.sideIndex);
  if (sideIndex !== 0 && sideIndex !== 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'this side could not be attributed automatically — say which player it is',
    });
  }

  const roster = new Set(readJson<{ id: string }[]>('data/characters.json', []).map((c) => c.id));
  // three picks when the plate named the point fighter, four when it did not and
  // the bust is read by the same person reading the diamonds
  const picks = (raw: unknown, which: string, want: number): string[] => {
    if (!Array.isArray(raw) || raw.length !== want) {
      throw createError({ statusCode: 400, statusMessage: `${which}: expected ${want} fighters` });
    }
    const ids = raw.map(String);
    for (const id of ids) {
      if (!roster.has(id)) {
        throw createError({ statusCode: 400, statusMessage: `unknown fighter id "${id}"` });
      }
    }
    return ids;
  };
  const a = picks(body.a, 'frame A', w.points[0] ? 3 : 4);
  const b = picks(body.b, 'frame B', w.points[1] ? 3 : 4);

  const membersOf = (point: string | null, rest: string[]) => [
    ...new Set([...(point ? [point] : []), ...rest]),
  ];
  const setOf = (point: string | null, rest: string[]) => membersOf(point, rest).sort().join(',');
  const setA = setOf(w.points[0], a);
  const setB = setOf(w.points[1], b);

  // A MID-SET TEAM CHANGE IS NOT A CONFLICT TO BE RESOLVED — it is two true
  // readings of a side that really did field more than four fighters. Forcing one
  // frame would discard an observation as good as the one it keeps, and the
  // contract already counts sides of more than four: legal, counted in usage,
  // excluded from pairing so C(n,2) cannot fabricate pairs never played.
  if (setA !== setB && body.union === true) {
    const characters = [...new Set([...membersOf(w.points[0], a), ...membersOf(w.points[1], b)])];
    return writeSide(w, sideIndex, characters, { teamChange: true });
  }

  if (setA !== setB && body.force !== true) {
    return {
      ok: false,
      disagree: true,
      a: setA.split(','),
      b: setB.split(','),
      message: 'the two frames read different benches — resolve, or resend with force',
    };
  }

  // point first when known: they held the plate at the moment the frame was taken
  const characters = [...new Set([...(w.points[0] ? [w.points[0]] : []), ...a])];

  // THE FREE POSITIVE CONTROL, CHECKED AT THE POINT OF ENTRY.
  //
  // The title names a fighter that side demonstrably played, so a read omitting it
  // is a misread or a mis-attribution. That check already exists at the emit gate,
  // where it correctly refused to publish — but it fired at BUILD time, hours after
  // the reading, on a side that had by then dropped out of the worklist. Catching
  // it here costs nothing and tells the reviewer while the frames are still on
  // screen. `force` remains available, because a genuine mid-set change can drop a
  // fighter the title named.
  const vids = readJson<{ id: string; sides: { provenance: { fromTitle: string[] } }[] }[]>(
    'data/videos.json',
    [],
  );
  const titled = vids.find((x) => x.id === w.video)?.sides[sideIndex]?.provenance.fromTitle ?? [];
  const missingTitled = titled.filter((t) => !characters.includes(t));

  // KEEPING BOTH IS USUALLY RIGHT, AND FORCING USUALLY IS NOT.
  //
  // The uploader's title is evidence the player used that fighter; the frames are
  // evidence of who was on the bench when they were sampled. When those disagree
  // the ordinary cause is a mid-set team change, and BOTH observations are true —
  // so the side had more than four over the set, which the contract already counts
  // and excludes from pairing. Forcing would drop a fighter the title witnesses,
  // which discards a true observation to make a check pass.
  if (missingTitled.length && body.keepTitled === true) {
    return writeSide(w, sideIndex, [...characters, ...missingTitled], {
      teamChange: true,
      humanPicks: { a, b, forced: false },
    });
  }

  if (missingTitled.length && body.force !== true) {
    return {
      ok: false,
      titleMissing: missingTitled,
      message:
        `the title names ${missingTitled.join(', ')} on this side, and the reading does not ` +
        'include them — check the attribution first; if it is right, keep both',
    };
  }
  return writeSide(w, sideIndex, characters, {
    forced: setA !== setB ? true : undefined,
    humanPicks: { a, b, forced: setA !== setB },
  });
});

function writeSide(
  w: import('../../utils/portraitWork').BenchItem,
  sideIndex: number,
  characters: string[],
  extra: Record<string, unknown>,
) {
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

  /**
   * THE UNION SLIP: both screen clusters read onto one side.
   *
   * When two players SWAP SCREEN SIDES mid-match, both portrait clusters appear
   * on both halves over the course of the set. Reading the whole HUD then puts
   * all eight fighters on each side, and the result is two "oversize" sides
   * holding an identical set — which nothing downstream questions, because
   * `types/index.ts` treats a side longer than four as a legitimate mid-set team
   * change, `emit` counts it in usage and only excludes it from pairing. The
   * record looks healthy the whole way through while counting sixteen side
   * appearances for a match that had eight.
   *
   * Found twice in ~380 records — once live on the site for days before anyone
   * noticed, because there was no signature to look for.
   *
   * The refusal is narrow on purpose. A four-fighter mirror match is legal and
   * common (SPLYxPgwT5o is one), so identity alone must not fire; it takes
   * identity AND exceeding charactersPerSide, which a mirror cannot reach. A
   * genuine mid-set change also cannot reach it: to trip this, a player would
   * have to field more than four AND land on exactly the same set as the
   * opponent, which is the union and nothing else.
   */
  const otherSide = baseSides[1 - sideIndex];
  if (otherSide && characters.length > CHARACTERS_PER_SIDE) {
    const key = (xs: string[]) => [...xs].sort().join(',');
    if (key(characters) === key(otherSide.characters)) {
      return {
        ok: false,
        unionSlip: true,
        message:
          `this side reads ${characters.length} fighters and is the SAME SET as the other side — ` +
          'that is what a mid-match side swap looks like when both clusters get read onto one ' +
          'side. Record the four this player actually fielded, not everything on screen.',
      };
    }
  }
  const sides = baseSides.map((s, k) =>
    k !== sideIndex
      ? s
      : {
          ...s,
          characters,
          provenance: {
            ...s.provenance,
            tier: 'human',
            tiers: [...(s.provenance.tiers ?? []), 'human'],
            fromHuman: characters,
            /** WHICH SCREEN SIDE THIS READ CAME FROM.
             *
             *  The plate cannot always say which record side a screen side is, and
             *  when a person supplies that instead, nothing else records the link.
             *  Without it the page cannot tell a saved side from an unsaved one —
             *  every tick stayed grey while the writes landed perfectly, which is
             *  worse than not writing: it invites the same work to be done twice. */
            humanScreenSide: w.side,
            complete: characters.length >= 4,
            ...extra,
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
}
