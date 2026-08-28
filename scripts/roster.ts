// Shared roster helpers for the parse/bench/emit stages.
//
// Character matching is SPAN EXTRACTION, never a separator split. This is the
// single most important decision in the Tōkon parser and it is a correctness
// issue, not a style one:
//
//   2XKO's parser splits a character slot on /\s*[/-]\s*/ — a "unified
//   character separator" that works perfectly on a roster of single-word
//   champion names. On THIS roster it is data corruption. "Spider-Man" becomes
//   ["Spider", "Man"], "Star-Lord" becomes ["Star", "Lord"], and a bench
//   written "(Ghost Rider- Storm- Magik)" shreds every hyphenated name in it.
//
// So: match roster aliases longest-first as non-overlapping spans, and treat
// the separators as the GAPS BETWEEN spans. One code path then handles
// "A/B", "A, B", "A- B" and "A and B" identically, because it never looks at
// the separators at all. Ten of the twenty-one fighters are multi-word or
// punctuated, so this is the common case, not an edge case.
//
// The safety net is the residue gate (scripts/parse.ts): whatever text a span
// did NOT cover is reported verbatim. A DLC fighter, a new nickname or an
// uploader's typo surfaces as a counted line with its literal text instead of
// vanishing into a silently-shorter side.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CharacterRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function loadCharacters(): Promise<CharacterRecord[]> {
  const raw = await readFile(join(ROOT, 'data', 'characters.json'), 'utf8');
  const characters = JSON.parse(raw) as CharacterRecord[];
  if (characters.length === 0) {
    throw new Error('data/characters.json is empty — run `npm run data:characters` first.');
  }
  return characters;
}

export interface AliasMatch {
  id: string;
  /** [start, end) span of the alias inside the searched text. */
  start: number;
  end: number;
}

export interface AliasMatcher {
  /** All character matches in the text, longest-alias-first, overlaps
   *  suppressed (so "Doctor Doom" absorbs the inner "Doom", and "Spider-Man"
   *  is never seen as two things). */
  find(text: string): AliasMatch[];
  /** The single character a fragment names, or null when it names zero or 2+. */
  one(text: string): string | null;
  /** Ordered, de-duplicated ids — the union a side fielded, first appearance
   *  first, which is exactly the engine's `Side.characters` contract. */
  ids(text: string): string[];
  /** The characters of `text` that no span covered and that are not ordinary
   *  separator punctuation. Non-empty residue is a report line, never a
   *  silent drop. */
  residue(text: string): string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Separators and connectives that legitimately sit between two names. Anything
 *  else left over is residue. `&`, `+` and `·` are included because uploaders
 *  reach for them; the em/en dashes because a hyphen-separated bench sometimes
 *  arrives typographically. */
const SEPARATOR_RE = /[\s,/&+·\-–—]|(?:\band\b)|(?:\bvs?\.?\b)/gi;
/**
 * The per-character leaderboard position. Stripped BEFORE matching so it can
 * never be read as part of a name, and so the residue gate does not report it
 * forever.
 *
 * THREE ORDERINGS, because uploaders use all three and an earlier version read
 * only the first:
 *
 *   "#2 Ranked Danger"        hash first        — always handled
 *   "Ranked #5 Storm"         WORD first        — was not, on 4 records
 *   "#1 Captain America"      bare, no word     — was not, on 2 records
 *
 * The miss was not a data defect: the fighter still resolved in every case,
 * because the leftover "Ranked"/"#5" matches no alias. It was an ALARM defect.
 * `Ranked#5` and `Ranked#10` cleared the residue gate's 3-record threshold and
 * raised "a new fighter has probably shipped" in report.md — so the one signal
 * that exists to catch a real DLC fighter was already crying wolf.
 *
 * The `#` is mandatory in every branch. A bare "Ranked Danger" is left alone to
 * surface as residue, and this only ever sees a TITLE'S CHARACTER SLOT
 * (parse.ts) — never a handle, never a description — so it cannot reach the
 * hashtag soup that ends most descriptions.
 */
const LEADERBOARD_RE = /(?:\brank(?:ed)?\b\s*)?#\s*\d+(?:\s*\brank(?:ed)?\b)?\s*/gi;

export const stripLeaderboard = (text: string): string =>
  text.replace(LEADERBOARD_RE, ' ').replace(/\s+/g, ' ').trim();

export function buildAliasMatcher(characters: CharacterRecord[]): AliasMatcher {
  const entries: { alias: string; id: string; re: RegExp }[] = [];
  for (const c of characters) {
    const aliases = c.extra?.aliases ?? [c.name.toLowerCase()];
    for (const alias of aliases) {
      entries.push({
        alias,
        id: c.id,
        // Word-ish boundaries: aliases contain spaces, dots and hyphens, so a
        // plain \b would fire in the middle of "Spider-Man".
        re: new RegExp(`(?<![a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`, 'gi'),
      });
    }
  }
  // Longest alias first: "doctor doom" must win over "doom", "green goblin"
  // over "goblin", "ms. marvel" over nothing-in-particular.
  entries.sort((a, b) => b.alias.length - a.alias.length);

  function find(text: string): AliasMatch[] {
    const taken: AliasMatch[] = [];
    for (const { id, re } of entries) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const span = { id, start: m.index, end: m.index + m[0].length };
        if (!taken.some((t) => span.start < t.end && t.start < span.end)) taken.push(span);
      }
    }
    return taken.sort((a, b) => a.start - b.start);
  }

  function ids(text: string): string[] {
    const out: string[] = [];
    for (const m of find(text)) if (!out.includes(m.id)) out.push(m.id);
    return out;
  }

  function residue(text: string): string {
    const spans = find(text);
    let out = '';
    let cursor = 0;
    for (const s of spans) {
      out += text.slice(cursor, s.start);
      cursor = s.end;
    }
    out += text.slice(cursor);
    return out.replace(SEPARATOR_RE, '').replace(/\s+/g, ' ').trim();
  }

  return {
    find,
    ids,
    residue,
    one(text: string): string | null {
      const list = ids(text);
      return list.length === 1 ? list[0]! : null;
    },
  };
}

// ── the READER's roster, which is not the parser's ──────────────────────────
//
// Everything above serves PROSE — titles and descriptions, where uploaders write
// "Doom", "Spidey", "Strom". Everything below serves PIXELS, and the two must not
// share a key set.
//
// The HUD nameplate prints exactly one string per fighter: its canonical name.
// Feeding the 54 prose aliases to a pixel reader does two kinds of damage. It
// adds four-letter mint targets, so an OCR artefact that would have matched
// nothing now lands on `DOOM` or `PENI`. And it collapses the roster's own
// spacing — `DOOM`/`LOKI`/`PENI`/`STORM` sit at pairwise distance 3, so two edits
// from a true plate falls inside another fighter's decoding ball, and the radius
// cap has to spend its entire budget defending against strings the plate can
// never show. Over the canonical 21 the minimum cross-distance is 4 instead of 3.
//
// The prose matcher keeps every alias. The reader gets the 21.

/** The whitelist handed to tesseract, the normalise class in `norm()` and the
 *  plate keys below must agree on `.`, `-` and space. Ms. Marvel, Doctor Doom,
 *  Spider-Man and Star-Lord each pick up a phantom edit otherwise, and every
 *  distance in the radius table would be measured against the wrong string. */
export const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.- ';

export const norm = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z.\- ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Optimal string alignment distance — Levenshtein plus adjacent transposition,
 *  which is the error OCR actually makes on a condensed face. */
export function osa(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

export interface PlateKey {
  id: string;
  /** The normalised string the nameplate renders. */
  key: string;
  /** Distance to the nearest OTHER fighter's plate key. */
  nearest: number;
  /** Largest edit budget at which this key is still uniquely decodable,
   *  floor((nearest - 1) / 2). */
  radius: number;
}

export interface PlateMatch {
  id: string;
  /** 0 = exact; higher = fuzzy hit inside the budget. */
  dist: number;
  /** Distance to the runner-up id, or Infinity when there is no other candidate.
   *  Carried so the fold can prefer an unambiguous read over a merely close one,
   *  and so the margin rule can be scored against the radius rule. */
  margin: number;
}

export interface PlateRoster {
  keys: PlateKey[];
  /** Resolve one OCR string to a fighter id, or null. */
  match(raw: string): PlateMatch | null;
}

/** Length scale on the OCR TEXT, not on the key.
 *
 *  A short read is a noise magnet: at distance 1 almost any four-character
 *  artefact matches a four-character name, so length has to gate slack
 *  independently of how far apart the roster happens to sit. SF6 derived this
 *  after three of its four single-frame phantom characters turned out to be its
 *  shortest alias. It scores whole-string as this does, so the scale stays on
 *  the text. */
const lengthScaled = (len: number): number => Math.max(1, Math.round(len / 4));

/** How much glued-on chrome to forgive at each end of a read.
 *
 *  THE CROP CANNOT BE MADE TIGHT ENOUGH, so this is handled at the matcher.
 *  Persisted reads (cache/tokon/reads.json, 1176 plates over five channels) show
 *  the reader gets the NAME right and picks up HUD furniture at the edges:
 *
 *    'JLOKI'  'MCARNAGE'  'ZLOKI'          a glyph of the meter, glued in front
 *    'WOLVERINEN'  'BLADEN'  'MAGIKY'      a bracket or icon, glued behind
 *    '- BLADE'  '. DANGER'                 punctuation in front
 *    'MAGIK TB'  'JSTAR-LORD TBS'          a separate chrome token
 *
 *  Widening the box makes it worse and narrowing it clips real names ('LOK' for
 *  LOKI on one channel). Trimming a bounded number of characters from each END
 *  and scoring the best trim fixes every case above without opening the door a
 *  free substring search would: candidates stay anchored near both ends, so a
 *  long garbage read can never collapse onto a short key. `LOKI` is not
 *  reachable from `JSTAR-LORD TBS` at any trim, because every candidate that
 *  string produces is at least seven characters long.
 *
 *  This is 2XKO's window scoring arriving for Tōkon's own reason. SF6 scores
 *  whole-string because its plates are clean; these are not. */
const MAX_LEAD = 3;
const MAX_TRAIL = 4;

/** Every end-trimmed candidate of a read, longest first. */
function trims(text: string): string[] {
  const out: string[] = [];
  for (let lead = 0; lead <= MAX_LEAD; lead++) {
    for (let trail = 0; trail <= MAX_TRAIL; trail++) {
      const c = text.slice(lead, text.length - trail).trim();
      if (c.length >= 3) out.push(c);
    }
  }
  return [...new Set(out)];
}

/** THE CAP IS DERIVED FROM THE ROSTER, NOT ASSERTED.
 *
 *  Length alone is unsafe and this roster proves it: `MAGNETO` and `DANGER` are
 *  7 and 6 characters, which length scaling would hand a budget of 2, and they
 *  sit at distance 4 — enough for two edits to walk one into the other's ball.
 *  So each key also carries its own unique-decoding radius and the effective
 *  budget is the MINIMUM of the two.
 *
 *  Measured on the canonical 21 (scripts/spike/radius.ts prints the table):
 *  minimum cross-distance 4 (HULK/MAGIK), and the radii come out 8 keys at 1
 *  (BLADE, CARNAGE, DANGER, HULK, LOKI, MAGIK, MAGNETO, STORM), 5 at 2, 7 at 3,
 *  and CAPTAIN AMERICA alone at 4.
 *
 *  Keep the two guards distinct when quoting them. The radius is a property of
 *  the ROSTER; the effective budget on a given read is `min(radius, length)` and
 *  is therefore a property of the READ. They coincide only for a full-length
 *  one, which is why the same roster yields 8/5/7/1 radii but 8/7/5/1 effective
 *  caps on perfectly-lengthed text. */
export function buildPlateRoster(characters: CharacterRecord[]): PlateRoster {
  const flat = characters.map((c) => ({ id: c.id, key: norm(c.name) }));
  const dupes = flat.filter((a, i) => flat.findIndex((b) => b.key === a.key) !== i);
  if (dupes.length) {
    throw new Error(
      `two fighters normalise to the same plate key: ${dupes.map((d) => d.key).join(', ')} — ` +
        'the reader cannot tell them apart, so this must be resolved in data/characters.json',
    );
  }
  const keys: PlateKey[] = flat.map(({ id, key }) => {
    let nearest = Infinity;
    for (const o of flat) {
      if (o.id === id) continue;
      const d = osa(key, o.key);
      if (d < nearest) nearest = d;
    }
    return { id, key, nearest, radius: Math.max(0, Math.floor((nearest - 1) / 2)) };
  });

  // Memo on the NORMALISED text. `match` is pure, and the same strings recur
  // heavily — four ensemble variants x two plates x ~72 frames per video, most
  // of them reading the same name — so this turns the trim family's 20x21 edit
  // distances into one lookup per distinct string.
  const memo = new Map<string, PlateMatch | null>();

  return {
    keys,
    match(raw: string): PlateMatch | null {
      const text = norm(raw);
      if (memo.has(text)) return memo.get(text)!;
      const result = decode(text);
      memo.set(text, result);
      return result;
    },
  };

  function decode(text: string): PlateMatch | null {
    // Two characters cannot carry a fighter's name; anything that short is an
    // artefact, and letting it through is how phantoms are minted.
    if (text.length < 3) return null;
    const candidates = trims(text);
    if (!candidates.length) return null;
    // Best trim per key, so a key is judged on the cleanest view of the read.
    // The length guard uses THAT trim's length, not the raw string's — a read
    // that had to lose five characters of chrome is not thereby granted the
    // slack of a long name.
    const scored = keys
      .map((k) => {
        let d = Infinity;
        let len = text.length;
        for (const c of candidates) {
          const e = osa(c, k.key);
          if (e < d) {
            d = e;
            len = c.length;
          }
        }
        return { k, d, len };
      })
      .sort((a, b) => a.d - b.d || a.k.key.localeCompare(b.k.key));
    const top = scored[0]!;
    const runnerUp = scored.find((s) => s.k.id !== top.k.id);
    const budget = Math.min(lengthScaled(top.len), top.k.radius);
    if (top.d > budget) return null;
    return { id: top.k.id, dist: top.d, margin: runnerUp ? runnerUp.d - top.d : Infinity };
  }
}

/**
 * IDENTITY, not the id: the handle reduced to its alphanumerics.
 *
 * This is the key two spellings of one person share. `playerId` turns every run
 * of punctuation into a hyphen, so "SONIC FOX" and "SonicFox" slug to
 * `sonic-fox` and `sonicfox` — two profiles, each holding some of that player's
 * matches, neither of them wrong-looking. Measured on this corpus: 9 players
 * split that way; on Tekken's, 110.
 *
 * Borrowed from sf6-replay-database/scripts/parse.ts, which has carried the
 * two-stage split since its own recon found "Ending Walker"/"EndingWalker" (333
 * and 296 sides) and "Problem X"/"ProblemX" (434 and 230). SF6 is the only game
 * on the platform with ZERO split players, and this function is the reason.
 *
 * WHAT IT CANNOT DO, and why scripts/players.ts exists beside it: two handles
 * that differ by an actual letter ("Crome"/"Chrome") have different
 * alphanumerics and will never collide here, while two DIFFERENT people whose
 * handles differ only by punctuation ("T-Ara" and "Tara", both real on Tekken)
 * collide when they should not. Normalisation gets the common case; the curated
 * map and the distinct-key declarations get the rest.
 */
export const idKey = (handle: string): string => {
  const nfkd = handle.normalize('NFKD').toLowerCase();
  const ascii = nfkd.replace(/[^a-z0-9]+/g, '');
  // Same fallback as playerId, and needed for the same reason in reverse: a
  // handle in another script reduces to "" here, so WITHOUT this every non-Latin
  // player shares one key and the collision gate reports them as the same
  // person. One CJK handle in the corpus today; the bug would arrive with the
  // second.
  if (ascii) return ascii;
  return nfkd.replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, '');
};

/**
 * Slug a handle into a stable player id — the PUBLIC id, and the URL.
 *
 * Keeps the readable hyphenated form, so /players/snake-eyez stays what it has
 * always been. Which SPELLING gets slugged is decided by resolvePlayers() in
 * scripts/players.ts, not here.
 *
 * THE NON-LATIN FALLBACK, and why it is a fallback rather than the rule.
 *
 * The ASCII path strips to [a-z0-9], which returns "" for a handle written
 * entirely in another script — "シルクちゃん" is a real player here (LxwV1YO7eGE,
 * whose bench a person read off the HUD by hand). That empty id shipped once:
 * data/players.json carried {"id": "", "handle": "シルクちゃん"} and nuxt.config
 * seeded a prerender route for `/players/` that collided with the index.
 *
 * The obvious repair — guard on the slug and drop the record, which is what SF6
 * and Tekken do — trades a real, hand-verified match for a clean registry. So
 * the empty case falls back to Unicode letters and digits instead: combining
 * marks are dropped first (NFKD splits "é" into "e" + U+0301, and a bare
 * combining mark is not \p{L}), and what survives is a genuine id.
 *
 * Applied ONLY when the ASCII slug is empty, so no existing id moves. A handle
 * that is pure punctuation still returns "" and is still refused at parse.
 */
export const playerId = (handle: string): string => {
  const nfkd = handle.normalize('NFKD').toLowerCase();
  const ascii = nfkd.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii) return ascii;
  return nfkd
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
};
