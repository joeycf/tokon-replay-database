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
/** The per-character leaderboard position, e.g. "#2 Ranked Danger". Stripped
 *  BEFORE matching so it can never be read as part of a name, and so the
 *  residue gate does not report it forever. */
const LEADERBOARD_RE = /#\s*\d+\s*(?:ranked|rank)\s*/gi;

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

/** Slug a handle into a stable player id. */
export const playerId = (handle: string): string =>
  handle
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
