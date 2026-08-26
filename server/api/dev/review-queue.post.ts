/**
 * Dev-only: record ONE verdict on a queued `character-completion` record, into
 * data/overrides.json — the only file this endpoint may touch.
 *
 * Body:  { id, verdict: 'complete', sides: [string[], string[]] }
 *        { id, verdict: 'reject' }
 *
 * The verdict is not applied here. It is written to overrides.json and consulted
 * by scripts/parse.ts at the point where the record would otherwise be queued,
 * which is the only place it can still become a record. So a save is inert until
 * the next parse, exactly like every other override in this project.
 *
 * A VERDICT MAY NEVER MINT A FIGHTER. Every id is checked against the roster and
 * an unknown one is a 400, not a silently shorter side. That check is the whole
 * reason this endpoint takes ids rather than free text: the failure mode of a
 * completion surface is not a crash, it is a record that looks authoritative and
 * names somebody who was never on screen.
 *
 * HANDLES ARE NOT ACCEPTED FROM THE CLIENT. They come from the queue entry,
 * which types/index.ts documents as already canonicalised against players.json.
 * Taking them from the form would let a typo mint a second player page for an
 * existing player — the one thing a human verdict is least able to notice,
 * because both spellings look right to the person who typed one of them.
 *
 * `resolvedBy: 'human'` is load-bearing beyond bookkeeping: VideoOverride
 * documents it as conferring dedupe priority, which is correct here — a
 * hand-adjudicated record should win a cross-post tie against an automatic one.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// THE SAME playerId THE PIPELINE USES, not a second copy. A verdict that
// derived an id by any other rule would fork the player page: the record would
// publish under an id no other record on that player shares, and the split would
// look exactly like two people with similar handles. Same import route as
// portrait-review.post.ts and portrait-crop.get.ts.
import { buildAliasMatcher, playerId } from '../../../scripts/roster';
import type {
  CharacterRecord,
  MatchSide,
  ReviewQueueItem,
  VideoOverride,
} from '../../../types/index';

interface Body {
  id?: unknown;
  verdict?: unknown;
  sides?: unknown;
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const root = process.cwd();
  const body = (await readBody(event)) as Body;
  const id = String(body.id ?? '');
  const verdict = String(body.verdict ?? '');
  if (verdict !== 'complete' && verdict !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: `unknown verdict "${verdict}"` });
  }

  // The record must be IN the queue. Writing a verdict for anything else would
  // reach past this surface into records the parser already resolved.
  const queue = readJson<ReviewQueueItem[]>('data/review-queue.json', []);
  const item = queue.find((q) => q.id === id && q.kind === 'character-completion');
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: `${id} is not a queued completion` });
  }

  const path = join(root, 'data/overrides.json');
  const overrides = JSON.parse(readFileSync(path, 'utf8')) as Record<string, VideoOverride>;
  const stamp = new Date().toISOString().slice(0, 10);

  if (verdict === 'reject') {
    overrides[id] = {
      '//': `review verdict: not a competitive match [${stamp}]`,
      exclude: true,
    };
    writeFileSync(path, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
    return { ok: true, verdict };
  }

  const roster = readJson<CharacterRecord[]>('data/characters.json', []);
  const known = new Set(roster.map((c) => c.id));

  /**
   * A HANDLE THAT CONTAINS A FIGHTER IS NOT A HANDLE.
   *
   * Some queued titles state their fighters with no parentheses at all —
   * "GLIDER Ranked #13 Magik vs Senshii Ranked #9 Spider Man" — so the slot
   * boundary falls in the wrong place and the whole span becomes the handle.
   * The characters are not unknown there; the PARSE is wrong, and no answer
   * about characters can fix it.
   *
   * Accepting one anyway is the expensive mistake, because it does not look like
   * an error afterwards. playerId() would mint `glider-ranked-13-magik` and
   * `senshii-ranked-9-spider-man` beside the `glider` and `senshii` who already
   * exist — four real players silently split across eight pages, each half
   * carrying some of their matches. types/index.ts calls this out as the thing
   * `handles` exists to prevent; it is simply not true of this branch.
   *
   * So refuse, and say which record needs a grammar rather than a verdict.
   */
  const matcher = buildAliasMatcher(roster);
  for (const [i, h] of (item.handles ?? ['', '']).entries()) {
    const inside = matcher.ids(h);
    if (inside.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage:
          `handle ${i} ("${h}") still contains ${inside.join('/')} — this title's slot ` +
          `boundary is wrong, so it needs a parser fix, not a character verdict`,
      });
    }
  }
  const raw = Array.isArray(body.sides) ? body.sides : [];
  if (raw.length !== 2)
    throw createError({ statusCode: 400, statusMessage: 'need exactly 2 sides' });

  const sides = raw.map((side, i) => {
    const ids = (Array.isArray(side) ? side : []).map(String).filter(Boolean);
    // Order-preserving de-dupe: a side lists each fighter once, and a repeated
    // pick is a slip at the keyboard rather than a claim about the match.
    const chars = [...new Set(ids)];
    if (chars.length === 0) {
      throw createError({ statusCode: 400, statusMessage: `side ${i} names no fighter` });
    }
    for (const c of chars) {
      if (!known.has(c)) {
        throw createError({ statusCode: 400, statusMessage: `unknown fighter "${c}"` });
      }
    }
    return chars;
  });

  const built: MatchSide[] = sides.map((characters, i) => ({
    player: playerId(item.handles?.[i] ?? ''),
    handle: item.handles?.[i] ?? '',
    characters,
    provenance: {
      tier: 'review',
      tiers: ['review'],
      // The title resolved NOTHING here — that is why the record was queued —
      // so fromTitle is empty rather than a guess, and `fromTitle ⊆ characters`
      // holds trivially instead of by luck.
      fromTitle: [],
      fromHuman: characters,
      slotOrder: 'handle-first',
      complete: characters.length >= 4,
    },
  }));

  overrides[id] = {
    '//': `review verdict: characters read by a person [${stamp}]`,
    sides: [built[0]!, built[1]!],
    resolvedBy: 'human',
  };
  writeFileSync(path, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
  return { ok: true, verdict, sides };
});
