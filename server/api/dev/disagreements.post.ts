/**
 * Dev-only: record a verdict on one off-bench read.
 *
 * Body: { key, verdict: 'team-change' | 'misread' }
 *
 * TEAM CHANGE APPENDS; IT NEVER DISPLACES. `types/index.ts` treats a side of more
 * than four as legitimate — a mid-set roster swap, counted in `characterUsage` and
 * excluded from any pairing surface with the exclusion reported — so the honest
 * record of "the description named four and the footage showed a fifth" is five
 * members, not four with one overwritten. Dropping a described fighter to make room
 * would be inventing a correction nobody made.
 *
 * The append goes to the side the fighter was READ on, which is the screen side the
 * label's own key names, resolved through the plate's point fighter. Not to
 * whichever described bench looks closest — that would be reasoning from the prose
 * the read just contradicted.
 *
 * MISREAD deletes the label. It does not write a correction, because there is
 * nothing to correct to: the labeller saw something that was not there, and the
 * useful record of that is its absence.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Body {
  key?: unknown;
  verdict?: unknown;
  /** for `reassign`: the fighter actually in that diamond */
  char?: unknown;
}
interface SideRec {
  characters: string[];
  provenance: Record<string, unknown> & { tiers?: string[] };
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const body = (await readBody(event)) as Body;
  const key = String(body.key ?? '');
  const verdict = String(body.verdict ?? '');
  if (verdict !== 'team-change' && verdict !== 'misread' && verdict !== 'reassign') {
    throw createError({ statusCode: 400, statusMessage: `unknown verdict "${verdict}"` });
  }
  const item = offBench().find((o) => o.key === key);
  if (!item) {
    throw createError({ statusCode: 409, statusMessage: 'that reading is no longer off-bench — refresh' });
  }

  // REASSIGN corrects rather than deletes. `misread` throws the reading away, which
  // is right when the labeller saw something that was not there — but when the
  // diamond plainly holds a DIFFERENT fighter, deleting loses a true observation to
  // avoid recording a wrong one. The correction keeps it.
  if (verdict === 'reassign') {
    const char = String(body.char ?? '');
    const roster = readJson<{ id: string }[]>('data/characters.json', []);
    if (!roster.some((c) => c.id === char)) {
      throw createError({ statusCode: 400, statusMessage: `unknown fighter id "${char}"` });
    }
    const labels = readJson<Record<string, Record<string, unknown>>>('data/portrait-labels.json', {});
    const prev = labels[key];
    if (!prev) throw createError({ statusCode: 409, statusMessage: 'label is gone — refresh' });
    labels[key] = { ...prev, char, reassignedFrom: prev.char, at: new Date().toISOString().slice(0, 10) };
    writeFileSync(
      join(process.cwd(), 'data/portrait-labels.json'),
      `${JSON.stringify(labels, null, 2)}\n`,
      'utf8',
    );
    return { ok: true, verdict, char };
  }

  if (verdict === 'misread') {
    const labels = readJson<Record<string, unknown>>('data/portrait-labels.json', {});
    const kept = Object.fromEntries(Object.entries(labels).filter(([k]) => k !== key));
    writeFileSync(
      join(process.cwd(), 'data/portrait-labels.json'),
      `${JSON.stringify(kept, null, 2)}\n`,
      'utf8',
    );
    return { ok: true, verdict, crops: Object.keys(kept).length };
  }

  const videos = readJson<{ id: string; sides: SideRec[] }[]>('data/videos.json', []);
  const v = videos.find((x) => x.id === item.video);
  if (!v) throw createError({ statusCode: 404, statusMessage: 'video not in videos.json' });

  const path = join(process.cwd(), 'data/overrides.json');
  const overrides = readJson<Record<string, { sides?: SideRec[]; [k: string]: unknown }>>(
    'data/overrides.json',
    {},
  );
  const existing = overrides[item.video] ?? {};
  const baseSides = (existing.sides ?? v.sides) as SideRec[];
  const sides = baseSides.map((s, k) => {
    if (k !== item.sideIndex || s.characters.includes(item.read)) return s;
    const characters = [...s.characters, item.read];
    return {
      ...s,
      characters,
      provenance: {
        ...s.provenance,
        tier: 'human',
        tiers: [...(s.provenance.tiers ?? []), 'human'],
        fromHuman: characters,
        teamChange: true,
        complete: characters.length >= 4,
      },
    };
  });

  overrides[item.video] = {
    ...existing,
    '//': `mid-set team change read from footage [${new Date().toISOString().slice(0, 10)}]`,
    sides,
    resolvedBy: 'human',
  };
  writeFileSync(path, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
  return { ok: true, verdict, characters: sides[item.sideIndex]!.characters };
});
