/**
 * Roster drift check — is data/characters.json still what Sony ships?
 *
 * WHY THIS EXISTS. A roster goes stale silently: a fighter who is not on it
 * fails no build and trips no assertion, they just leave every match they
 * appear in filed with one side missing. See ../check-rosters.sh.
 *
 * THE HERO SELECT BLOCK, AND WHY NOT ANYTHING ELSE ON THE PAGE. Sony's product
 * page mentions every fighter's name many times over in prose, trailer
 * descriptions and SEO text — "Storm" alone appears 25 times — so counting name
 * occurrences would be meaningless. The block titled "Hero Select" is the one
 * STRUCTURED enumeration: each fighter is an `id="<slug>_title"` element whose
 * `<p class="txt-style-base">` carries the display name, paired with a matching
 * `id="<slug>_subtitle"` epithet. Twenty of each, verified 2026-09-09. This
 * reads that, and nothing else.
 *
 * TWO SIGNALS, ONE COMPARISON. The names are what this repo's roster is
 * canonically spelled from (see scripts/characters.ts), so names are what the
 * comparison uses. The slugs are read too, purely as a shape control: if the
 * titles and subtitles ever stop pairing up, the block is not what this parser
 * thinks it is and no verdict about our roster would mean anything.
 *
 * CHAMPION IS EXPECTED TO BE ABSENT UPSTREAM, AND THAT IS THE WHOLE REASON THIS
 * SCRIPT NEEDS AN EXEMPTION RULE. He is a hidden unlockable who shipped in the
 * base game and appears on no roster page — Sony's block lists 20, our roster
 * holds 21, and both are correct. The exemption keys on the roster's OWN
 * statement about itself (`extra.availability` beginning "Unlockable"), not on a
 * hardcoded id, so a second unlockable would be handled without editing this file.
 *
 * A TRAP FOUND WHILE BUILDING THIS, WORTH NOT REDISCOVERING: 84 uploads in
 * raw/ carry a YouTube `tags` array whose Tōkon block lists the 20 launch names
 * plus "Phoenix Cyclops" and OMITS Champion — uploader SEO boilerplate frozen
 * before Champion was known. Any check that read tags instead of a vendor
 * surface would conclude that Phoenix Cyclops had shipped and that Champion did
 * not exist. Both wrong. Do not use tags as a roster source.
 *
 * NETWORK, MANUAL, NEVER IN THE CRON.
 *
 * Run: npm run data:roster-check
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNRELEASED } from './expiries';
import type { CharacterRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'https://www.playstation.com/en-us/games/marvel-tokon-fighting-souls/';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

type State = 'CURRENT' | 'DRIFT' | 'UNVERIFIED' | 'UNREADABLE';
const verdict = (state: State, detail = ''): never => {
  if (detail) console.log(detail);
  console.log(`roster-check: ${state}`);
  process.exit(state === 'CURRENT' || state === 'UNVERIFIED' ? 0 : 1);
};

const norm = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

async function main(): Promise<void> {
  const local = JSON.parse(
    await readFile(join(ROOT, 'data/characters.json'), 'utf8'),
  ) as CharacterRecord[];

  const unlockable = new Set(
    local
      .filter((c) =>
        /^unlockable/i.test((c.extra as { availability?: string } | undefined)?.availability ?? ''),
      )
      .map((c) => c.id),
  );
  const nameToId = new Map(local.map((c) => [norm(c.name), c.id]));
  const gated = new Set(UNRELEASED.map((u) => u.id));

  let html: string;
  try {
    const res = await fetch(PAGE, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`GET ${PAGE} → HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return void verdict('UNVERIFIED', `! could not reach Sony's page — ${(e as Error).message}`);
  }

  const start = html.indexOf('Hero Select');
  if (start < 0)
    return void verdict(
      'UNREADABLE',
      '✖ no "Hero Select" block on Sony’s page — the page changed shape.\n' +
        '  Re-derive the parse target before trusting any roster verdict.',
    );
  const block = html.slice(start, start + 40_000);

  const titles = [
    ...block.matchAll(
      /id="([a-z0-9_]+)_title"[^>]*>[\s\S]*?<p class="txt-style-base">([^<]+)<\/p>/g,
    ),
  ].map((m) => ({ slug: m[1]!, name: m[2]!.trim() }));
  const subtitleCount = [...block.matchAll(/id="([a-z0-9_]+)_subtitle"/g)].length;

  if (titles.length === 0)
    return void verdict(
      'UNREADABLE',
      '✖ the Hero Select block yielded no fighters — markup drift.',
    );
  if (titles.length !== subtitleCount)
    return void verdict(
      'UNREADABLE',
      `✖ ${titles.length} hero title(s) but ${subtitleCount} subtitle(s) — the block is not the\n` +
        '  shape this parser expects, so its count cannot be trusted.',
    );

  const upstreamIds: string[] = [];
  const unknown: string[] = [];
  for (const t of titles) {
    const id = nameToId.get(norm(t.name));
    if (id) upstreamIds.push(id);
    else unknown.push(`${t.name} (${t.slug})`);
  }

  const known = new Set(upstreamIds);
  const extra = local
    .map((c) => c.id)
    .filter((id) => !known.has(id) && !unlockable.has(id))
    .sort();

  console.log(
    `  ${titles.length} fighter(s) in Sony's Hero Select · ${local.length} in characters.json`,
  );
  if (unlockable.size)
    console.log(
      `  ${unlockable.size} unlockable, expected absent upstream: ${[...unlockable].join(', ')}`,
    );
  if (gated.size) console.log(`  ${gated.size} announced and gated: ${[...gated].join(', ')}`);

  if (!unknown.length && !extra.length)
    return void verdict('CURRENT', '✓ roster matches Sony’s Hero Select block');

  const lines = ['✖ roster has drifted from Sony’s Hero Select block', ''];
  for (const u of unknown)
    lines.push(
      `  MISSING  ${u} — in Sony's Hero Select, with no roster row of that name.`,
      `           A new fighter, or a name Sony re-spelled. Full runbook in`,
      `           scripts/expiries.ts — note art (data:art) must run BEFORE`,
      `           data:characters, and a new fighter also needs an IDENTITY row in`,
      `           scripts/art.ts, which is an allow-list.`,
    );
  for (const id of extra)
    lines.push(
      `  EXTRA    ${id} — on the roster, not in Sony's Hero Select and not marked`,
      `           unlockable. If they ARE an unlockable, give them an`,
      `           extra.availability beginning "Unlockable" and this resolves itself.`,
      `           Otherwise confirm before deleting: records already reference this id.`,
    );
  verdict('DRIFT', lines.join('\n'));
}

await main();
