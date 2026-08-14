/**
 * Build data/characters.json — the roster registry.
 *
 * TWO SOURCES, ONE OF THEM BINDING:
 *
 * 1. ROSTER below: ids, official names, team, and the parse/search aliases.
 *    Names are the spelling Sony's own pages use, in TITLE CASE ("Doctor Doom",
 *    "Ms. Marvel", "Star-Lord"). Marvel's own site renders the roster in caps,
 *    but every readable official text source is title case and the caps form is
 *    display styling — so title case is canonical and the UI uppercases where
 *    a label wants it.
 *
 * 2. design/handoff/tokens.css: the accents, read from its `--char-<id>` block.
 *    THE DESIGN TOKENS ARE THE SOURCE OF TRUTH FOR ACCENTS. app/app.config.ts
 *    mirrors the same block, so config and data cannot drift, and
 *    A ROSTER ID WITH NO TOKEN FAILS THIS SCRIPT LOUD rather than shipping an
 *    unstyled fighter. Never invent an accent here — get it from Claude Design.
 *    (The one exception is documented in the token file itself: --char-champion
 *    is PROVISIONAL, derived by the handoff's own method because Champion is a
 *    hidden fighter the brief did not know existed. It is owed a real token.)
 *
 * Run: npm run data:characters   (only when the roster changes — never in cron)
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CharacterRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = join(ROOT, 'design/handoff/tokens.css');
const OUT = join(ROOT, 'data/characters.json');

type Team =
  | 'Fighting Avengers'
  | 'Amazing Guardians'
  | 'Unbreakable X-Men'
  | 'Knights of Doom'
  | 'Samurai Outriders'
  | 'Unaffiliated';

interface RosterEntry {
  id: string;
  name: string;
  team: Team;
  /** Team leader — the design uses the leader's accent for team dots. */
  leader?: boolean;
  /** Not on the announced 20. See `champion`. */
  unlockable?: boolean;
  /** Parse + search vocabulary. The app's search and the pipeline's parser read
   *  the SAME list, so a new nickname is added once.
   *
   *  Curation rules applied here:
   *   · the official name always appears;
   *   · punctuation variants are listed explicitly ("dr. doom" / "dr doom"),
   *     because the alias matcher compares literal text and a missing variant
   *     is a silent miss, not an error;
   *   · a shortening is included only where it cannot collide with another
   *     fighter or a plausible handle. "doom" and "goblin" are safe on this
   *     roster; a bare "cap" or "panther" is not, and is deliberately absent —
   *     the residue gate will surface either if a channel starts using it.
   *   · two observed uploader TYPOS are included and marked. This is curation,
   *     not silent correction: without them those uploads become
   *     char-unresolved misses, and the alternative to a curated variant is
   *     losing a real match. */
  aliases: string[];
}

const ROSTER: RosterEntry[] = [
  // ── Fighting Avengers ──────────────────────────────────────────────────────
  {
    id: 'captain-america',
    name: 'Captain America',
    team: 'Fighting Avengers',
    leader: true,
    aliases: ['captain america', 'captain-america', 'c. america', 'c america', 'cap america'],
  },
  {
    id: 'iron-man',
    name: 'Iron Man',
    team: 'Fighting Avengers',
    aliases: ['iron man', 'iron-man', 'ironman'],
  },
  { id: 'hulk', name: 'Hulk', team: 'Fighting Avengers', aliases: ['hulk'] },
  {
    id: 'black-panther',
    name: 'Black Panther',
    team: 'Fighting Avengers',
    aliases: ['black panther', 'black-panther', 'b. panther'],
  },

  // ── Amazing Guardians ──────────────────────────────────────────────────────
  {
    id: 'spider-man',
    name: 'Spider-Man',
    team: 'Amazing Guardians',
    leader: true,
    // 'sipder man' is an observed uploader typo in the launch corpus.
    aliases: ['spider-man', 'spider man', 'spiderman', 'spidey', 'sipder man'],
  },
  {
    id: 'ms-marvel',
    name: 'Ms. Marvel',
    team: 'Amazing Guardians',
    aliases: ['ms. marvel', 'ms marvel', 'ms.marvel'],
  },
  {
    id: 'star-lord',
    name: 'Star-Lord',
    team: 'Amazing Guardians',
    aliases: ['star-lord', 'star lord', 'starlord'],
  },
  {
    id: 'peni-parker',
    name: 'Peni Parker',
    team: 'Amazing Guardians',
    aliases: ['peni parker', 'peni-parker', 'peni'],
  },

  // ── Unbreakable X-Men ──────────────────────────────────────────────────────
  // 'strom' is an observed uploader typo in the launch corpus.
  {
    id: 'storm',
    name: 'Storm',
    team: 'Unbreakable X-Men',
    leader: true,
    aliases: ['storm', 'strom'],
  },
  { id: 'magik', name: 'Magik', team: 'Unbreakable X-Men', aliases: ['magik'] },
  { id: 'wolverine', name: 'Wolverine', team: 'Unbreakable X-Men', aliases: ['wolverine'] },
  { id: 'danger', name: 'Danger', team: 'Unbreakable X-Men', aliases: ['danger'] },

  // ── Knights of Doom ────────────────────────────────────────────────────────
  {
    id: 'doctor-doom',
    name: 'Doctor Doom',
    team: 'Knights of Doom',
    leader: true,
    aliases: ['doctor doom', 'doctor-doom', 'dr. doom', 'dr doom', 'd. doom', 'doom'],
  },
  { id: 'magneto', name: 'Magneto', team: 'Knights of Doom', aliases: ['magneto'] },
  {
    id: 'green-goblin',
    name: 'Green Goblin',
    team: 'Knights of Doom',
    aliases: ['green goblin', 'green-goblin', 'g.goblin', 'g. goblin', 'goblin'],
  },
  { id: 'carnage', name: 'Carnage', team: 'Knights of Doom', aliases: ['carnage'] },

  // ── Samurai Outriders ──────────────────────────────────────────────────────
  {
    id: 'ghost-rider',
    name: 'Ghost Rider',
    team: 'Samurai Outriders',
    leader: true,
    // 'g.rider' surfaced through the residue gate on a real upload
    // ("Magneto/G.Rider") — the abbreviation the uploader used, which no
    // spelling of the full name covers. That is the gate's whole purpose.
    aliases: ['ghost rider', 'ghost-rider', 'ghostrider', 'g.rider', 'g. rider'],
  },
  { id: 'blade', name: 'Blade', team: 'Samurai Outriders', aliases: ['blade'] },
  { id: 'loki', name: 'Loki', team: 'Samurai Outriders', aliases: ['loki'] },
  {
    id: 'deadpool',
    name: 'Deadpool',
    team: 'Samurai Outriders',
    aliases: ['deadpool', 'dead pool'],
  },

  // ── Unaffiliated ───────────────────────────────────────────────────────────
  /**
   * CHAMPION — the 21st fighter, and the reason this roster is not 20.
   *
   * He is not on the announced launch roster and no Sony/Marvel/ASW page names
   * him as playable. He is a hidden unlockable: clearing chapter 11 of any one
   * Episode scenario makes him selectable in every other mode, online included.
   * Existence is confirmed by publisher-authored achievement strings ("Clear
   * the Champion Course in All-Star Arena", "Champion of the Universe");
   * playability by the in-game unlock message quoted at launch.
   *
   * He is the 7th most-used fighter in the measured launch corpus — 15 of 105
   * parseable matches — so treating the roster as 20 would have failed ~15% of
   * the archive loud on every single run.
   *
   * Modelled as `unlockable`, NOT as DLC: he costs nothing, needs no patch, and
   * shipped in the base game. Nothing gates him behind a release date, so
   * scripts/expiries.ts has no row for him.
   */
  {
    id: 'champion',
    name: 'Champion',
    team: 'Unaffiliated',
    unlockable: true,
    aliases: ['champion'],
  },
];

/** Read the `--char-<id>: #hex;` block out of the design handoff. */
async function readAccents(): Promise<Record<string, string>> {
  const css = await readFile(TOKENS, 'utf8');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--char-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

/** WCAG relative luminance / contrast — the accents' own AA gate. */
const chan = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** The AA reference background — must track --color-surface in theme.css. */
const SURFACE = '#101627';

async function main() {
  const accents = await readAccents();

  // ── the SF6 contract: a roster id with no design token fails LOUD ──────────
  const missing = ROSTER.filter((r) => !accents[r.id]);
  if (missing.length) {
    console.error(
      `✗ ${missing.length} roster id(s) have no --char-* token in design/handoff/tokens.css:\n` +
        missing.map((m) => `    ${m.id} (${m.name})`).join('\n') +
        `\n\n  Get the accent from Claude Design — do NOT invent one. It must clear\n` +
        `  4.5:1 on --color-surface ${SURFACE} and sit >=8-12 degrees of hue off its\n` +
        `  roster neighbours. Add --char-<id> to design/handoff/tokens.css and the\n` +
        `  same hex to \`accents\` in app/app.config.ts.`,
    );
    process.exit(1);
  }

  // Tokens with no roster entry are the same defect seen from the other side:
  // a renamed id leaves an orphan that silently styles nothing.
  const orphans = Object.keys(accents).filter(
    (k) => !ROSTER.some((r) => r.id === k) && k !== 'phoenix-cyclops',
  );
  if (orphans.length) {
    console.error(
      `✗ --char-* token(s) with no roster entry: ${orphans.join(', ')}\n` +
        `  Either the roster id was renamed and the token was not, or a fighter is missing.`,
    );
    process.exit(1);
  }

  // Every accent must still clear AA against the surface it renders on.
  const failsAA = ROSTER.map((r) => ({ r, ratio: contrast(accents[r.id]!, SURFACE) })).filter(
    (x) => x.ratio < 4.5,
  );
  if (failsAA.length) {
    console.error(
      `✗ ${failsAA.length} accent(s) below 4.5:1 on --color-surface ${SURFACE}:\n` +
        failsAA.map((x) => `    ${x.r.id} ${accents[x.r.id]} → ${x.ratio.toFixed(2)}:1`).join('\n'),
    );
    process.exit(1);
  }

  const has = async (p: string): Promise<boolean> => {
    try {
      await access(join(ROOT, 'public', p));
      return true;
    } catch {
      return false;
    }
  };

  const records: CharacterRecord[] = [];
  const missingPortrait: string[] = [];
  let splashes = 0;
  for (const r of ROSTER) {
    const portrait = `/img/characters/${r.id}-portrait.webp`;
    const splash = `/img/characters/${r.id}-splash.webp`;
    if (!(await has(portrait))) missingPortrait.push(r.id);
    // imgSplash is emitted ONLY when the file exists. The roster grid has an
    // @error handler and degrades to an accent gradient, but the character
    // page's hero <img> has none — a 404 there stretches a broken image across
    // the page, which is strictly worse than the absent field, whose v-if
    // guard falls back to the engine's stripe-and-accent treatment.
    const hasSplash = await has(splash);
    if (hasSplash) splashes += 1;
    records.push({
      id: r.id,
      name: r.name,
      imgPortrait: portrait,
      ...(hasSplash ? { imgSplash: splash } : {}),
      accent: accents[r.id]!,
      extra: {
        aliases: r.aliases,
        team: r.team,
        ...(r.leader ? { role: 'Team leader' } : {}),
        ...(r.unlockable ? { availability: 'Unlockable — clear Episode chapter 11' } : {}),
      },
    });
  }

  // ── FAIL LOUD on a fighter with no portrait ───────────────────────────────
  // Same contract as the accents above, and for the same reason: a roster entry
  // that resolves to nothing should stop the build, not ship a gap. There is no
  // excuse for one now — scripts/art.ts resolves art from the wiki manifest and
  // scripts/art-tile.ts generates an on-brand tile for anything it cannot, so
  // every id has a path to a real file.
  if (missingPortrait.length) {
    console.error(
      `✗ ${missingPortrait.length} fighter(s) have no portrait: ${missingPortrait.join(', ')}\n\n` +
        `  Resolve art before shipping the roster:\n` +
        `    npx tsx scripts/art.ts --only=${missingPortrait.join(',')}   (wiki manifest)\n` +
        `    npx tsx scripts/art-tile.ts --only=${missingPortrait.join(',')}  (generated fallback)\n` +
        `  A new DLC fighter lands here first — that is the check working, not a bug.`,
    );
    process.exit(1);
  }

  await writeFile(OUT, `${JSON.stringify(records, null, 2)}\n`);

  const teams = new Map<string, number>();
  for (const r of ROSTER) teams.set(r.team, (teams.get(r.team) ?? 0) + 1);
  console.log(
    `✓ data/characters.json — ${records.length} fighters ` +
      `(${[...teams].map(([t, n]) => `${t.split(' ').at(-1)} ${n}`).join(', ')})`,
  );
  console.log(
    `  accents: ${records.length}/${records.length} present, all >=4.5:1 on ${SURFACE}` +
      `  ·  worst ${Math.min(...records.map((r) => contrast(r.accent, SURFACE))).toFixed(2)}:1`,
  );
  console.log(
    `  art: ${records.length}/${records.length} portraits, ${splashes}/${records.length} splashes` +
      (splashes < records.length
        ? ` (${records.length - splashes} fighter(s) ship no splash — field omitted, hero degrades cleanly)`
        : ''),
  );
}

await main();
