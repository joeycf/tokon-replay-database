/**
 * Player identity AUDIT. Read-only: nothing here edits data/.
 *
 * scripts/roster.ts `idKey` already collapses the whole spacing-and-punctuation
 * class automatically — "SONIC FOX" and "SonicFox" can no longer be two pages.
 * What it cannot reach is anything where the ALPHANUMERICS differ: a dropped
 * letter ("Crome" for "Chrome"), a team tag, a trailing tag ("BSG"), an
 * abbreviated first word. This finds those.
 *
 * IT NEVER MERGES ANYTHING, AND THAT IS THE DESIGN — the same rule
 * scripts/replay-dupes.ts states for footage, and it matters more here. A wrong
 * replay merge loses one video; a wrong PLAYER merge rewrites a real person's
 * page to hold matches they did not play, and the page looks entirely normal
 * afterwards. Tekken's own parser says the same thing where it keeps its org
 * prefixes curated: "a wrong merge silently rewrites a real player's page".
 *
 * So this prints candidates ranked by how much merging would fix, with the
 * evidence beside each, and a paste-ready HANDLE_ALIASES fragment. A person
 * decides, in scripts/players.ts.
 *
 * Ported from 2xko-replay-database/scripts/player-dupes.ts, minus the `slug`
 * heuristic that idKey made unreachable here.
 *
 * Run: npm run data:player-dupes
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { idKey } from './roster';
import { DISTINCT_KEYS, HANDLE_ALIASES } from './players';
import type { MatchVideo, PlayerRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async <T>(f: string): Promise<T> =>
  JSON.parse(await readFile(join(ROOT, 'data', f), 'utf8')) as T;

const players = await readJson<PlayerRecord[]>('players.json');
const videos = await readJson<MatchVideo[]>('videos.json');

const counts = new Map<string, number>();
const fightersOf = new Map<string, Map<string, number>>();
for (const v of videos) {
  for (const s of v.sides) {
    counts.set(s.player, (counts.get(s.player) ?? 0) + 1);
    const m = fightersOf.get(s.player) ?? new Map<string, number>();
    for (const c of s.characters) m.set(c, (m.get(c) ?? 0) + 1);
    fightersOf.set(s.player, m);
  }
}
const countOf = (id: string): number => counts.get(id) ?? 0;
const topFighters = (id: string, n = 3): string[] =>
  [...(fightersOf.get(id) ?? new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };
const deleet = (s: string): string => s.replace(/[013457]/g, (c) => LEET[c]!);

/** Optimal String Alignment, capped — the caller only cares about ≤1. */
function osa(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) d[i]![0] = i;
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + cost);
      }
    }
  }
  return d[a.length]![b.length]!;
}

const wordsOf = (handle: string): string[] =>
  handle
    .split(/[\s|/\\]+|(?<=[a-z])-(?=[A-Z])/)
    .map((w) => idKey(w))
    .filter(Boolean);

interface Candidate {
  keep: PlayerRecord;
  drop: PlayerRecord;
  kinds: string[];
  note: string;
}
const candidates = new Map<string, Candidate>();
const add = (a: PlayerRecord, b: PlayerRecord, kind: string, note: string): void => {
  if (a.id === b.id) return;
  const key = [a.id, b.id].sort().join(' ');
  const hit = candidates.get(key);
  if (hit) {
    if (!hit.kinds.includes(kind)) hit.kinds.push(kind);
    return;
  }
  // More records wins the "keep" slot; it is only a suggestion for the fragment.
  const [keep, drop] = countOf(a.id) >= countOf(b.id) ? [a, b] : [b, a];
  candidates.set(key, { keep, drop, kinds: [kind], note });
};

const keyed = players.map((p) => ({ p, k: idKey(p.handle) })).filter((x) => x.k);

// leet — "K1NG" ↔ "KING"
const byLeet = new Map<string, PlayerRecord[]>();
for (const { p, k } of keyed) {
  const d = deleet(k);
  byLeet.set(d, [...(byLeet.get(d) ?? []), p]);
}
for (const [k, list] of byLeet) {
  if (list.length < 2) continue;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      add(list[i]!, list[j]!, 'leet', `equal after leet-folding to "${k}"`);
    }
  }
}

// typo (1 edit) and affix (short tail) — O(n²) over ~330 players, trivial
for (let i = 0; i < keyed.length; i++) {
  for (let j = i + 1; j < keyed.length; j++) {
    const { p: a, k: ka } = keyed[i]!;
    const { p: b, k: kb } = keyed[j]!;
    if (ka.length >= 5 && kb.length >= 5 && osa(ka, kb) === 1) {
      add(a, b, 'typo', `1-character difference ("${ka}" vs "${kb}")`);
    }
    const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
    if (short.length >= 4 && long.startsWith(short)) {
      const tail = long.slice(short.length);
      if (tail.length <= 3 && /^(?:\d+|[a-z]{1,3})$/.test(tail)) {
        add(a, b, 'affix', `"${long}" is "${short}" + "${tail}"`);
      }
    }
  }
}

// A shared WORD is a candidate, never a verdict — two players on the same team
// share a tag, not an identity. Confirm pairwise: the short handle survives
// whole inside the long one (team tag), or its first word is an initial of the
// long one's ("Filipino Champ" → "F. Champ").
const byWord = new Map<string, PlayerRecord[]>();
for (const p of players) {
  for (const w of new Set(wordsOf(p.handle))) {
    if (w.length >= 3) byWord.set(w, [...(byWord.get(w) ?? []), p]);
  }
}
for (const [, list] of byWord) {
  if (list.length < 2) continue;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const [long, short] = idKey(a.handle).length >= idKey(b.handle).length ? [a, b] : [b, a];
      const lw = wordsOf(long.handle);
      const sw = wordsOf(short.handle);
      if (lw.length > sw.length && lw.includes(idKey(short.handle))) {
        add(a, b, 'tag', `"${long.handle}" is "${short.handle}" plus a tag`);
        continue;
      }
      const lHead = lw[0];
      const sHead = sw[0];
      if (
        lw.length > 1 &&
        lw.length === sw.length &&
        sHead?.length === 1 &&
        lHead &&
        lHead.length > 1 &&
        lHead.startsWith(sHead) &&
        lw.slice(1).join() === sw.slice(1).join()
      ) {
        add(a, b, 'initials', `"${short.handle}" abbreviates "${long.handle}"`);
      }
    }
  }
}

const WEIGHT: Record<string, number> = { leet: 4, tag: 3, initials: 3, typo: 2, affix: 1 };
const ranked = [...candidates.values()]
  .filter(
    (c) => !DISTINCT_KEYS.has(idKey(c.keep.handle)) && !HANDLE_ALIASES.has(idKey(c.drop.handle)),
  )
  .sort((a, b) => {
    const wa = Math.max(...a.kinds.map((k) => WEIGHT[k] ?? 0));
    const wb = Math.max(...b.kinds.map((k) => WEIGHT[k] ?? 0));
    return wb - wa || countOf(b.drop.id) - countOf(a.drop.id);
  });

console.log(
  `Player identity audit — ${players.length} players, ${videos.length} records\n` +
    `  ${HANDLE_ALIASES.size} curated alias(es) · ${DISTINCT_KEYS.size} declared-distinct key(s)\n` +
    `  ${ranked.length} candidate pair(s) that idKey cannot reach\n`,
);

if (!ranked.length) {
  console.log('✓ no unresolved identity candidates');
  process.exit(0);
}

for (const c of ranked) {
  const fk = topFighters(c.keep.id).join('/') || '—';
  const fd = topFighters(c.drop.id).join('/') || '—';
  console.log(`  [${c.kinds.join('+')}] ${c.note}`);
  console.log(`     keep  ${c.keep.handle}  (${c.keep.id}, ${countOf(c.keep.id)} rec, ${fk})`);
  console.log(`     drop  ${c.drop.handle}  (${c.drop.id}, ${countOf(c.drop.id)} rec, ${fd})\n`);
}

console.log('─'.repeat(72));
console.log('CANDIDATES ONLY — nothing has been changed. Shared fighters are evidence,');
console.log('not proof; a merge that is wrong produces a page that looks right. Confirm,');
console.log('then paste the ones that survive into HANDLE_ALIASES in scripts/players.ts');
console.log('(or the key into DISTINCT_KEYS if they are two people):\n');
for (const c of ranked) {
  console.log(`  ['${idKey(c.drop.handle)}', ${JSON.stringify(c.keep.handle)}], // ${c.note}`);
}
