/**
 * Character art — scraped from the Marvel Database wiki, which is the only
 * machine-consistent manifest that exists for this game.
 *
 * WHY A SCRAPE AND NOT A FIRST-PARTY FETCH. There is no official per-character
 * asset endpoint: marvel.com 403s every automated request, the PlayStation
 * product page carries character text but no per-fighter imagery, and Steam
 * publishes game-level art only. The PS-Blog reveal posts do host isolated
 * per-character images, but only as a hand-curated third-party mapping with no
 * manifest behind it. The wiki category IS a manifest — enumerable, stable, and
 * keyed consistently.
 *
 * TWO FILENAME GRAMMARS, AND NEITHER IS CONSTRUCTED:
 *   posters  "MARVEL Tōkon Fighting Souls <Fighter Name> poster.jpg"   → keyed by FIGHTER
 *   renders  "<Comics Identity> (Earth-358) from … character render 001.png" → keyed by IDENTITY
 *
 * Filenames are never built from a template. The game's name is spelled two
 * ways across the category ("MARVEL Tōkon" on 41 files, "MARVEl Tokon" on 27),
 * and the render suffix is sometimes "character render 001" and sometimes a
 * bare "001" — two exact-title guesses returned MISSING during recon. So the
 * script ENUMERATES the category and matches on the subject, which is stable.
 *
 * THE BRIDGE. Renders are filed under comics identities, not fighter names, so
 * the roster needs a hand-authored 21-entry map (below). It is an ALLOW-LIST,
 * which is what keeps the ~24 non-fighter subjects in the same category —
 * Dogpool, Dora Milaje, Odin Borson, a Hydra-Supreme Captain America, three
 * Iron Man armour variants, a Thanos from another Earth — out by construction
 * rather than by a filter someone has to keep tuning.
 *
 * SLOTTING, decided by measurement rather than assumption. Both families are
 * TALL (posters a uniform 1018×1440 ≈ 0.71; renders 3–5 MP at 0.74–0.82), so
 * "the render is the wider one" is false:
 *   · portrait ← the POSTER. Uniform across all 20 announced fighters, so every
 *     roster tile crops identically and the grid reads as one set. Cropped
 *     top-anchored to 3:4 and resized to 512×683, matching SF6 exactly.
 *   · splash   ← the LARGEST render by pixel count (001 vs 002). Shipped TALL
 *     and uncropped at width 1000, again matching SF6, whose splashes are
 *     1000×963…1248. The engine's hero is a ~4.2:1 box with
 *     `object-position: 70% 25%`, so it does its own crop; pre-cropping here
 *     would crop twice and lose the framing the config exists to control.
 *
 * Never emit a path to a file that was not written: the roster grid has an
 * @error handler and degrades to an accent gradient, but the hero <img> has
 * none, so a 404 there stretches a broken image across the page.
 *
 * Run: npx tsx scripts/art.ts [--dry] [--only <id,…>]
 *      --dry resolves and prints the table without downloading anything.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/img/characters');
const API = 'https://marvel.fandom.com/api.php';
const CATEGORY = 'Category:MARVEL Tōkon: Fighting Souls/Images';
/** Direct article fetches 402 for automated clients; api.php and the static
 *  asset host both answer a plain browser UA. */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0 Safari/537.36';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY = new Set(
  (args.find((a) => a.startsWith('--only'))?.split('=')[1] ?? '').split(',').filter(Boolean),
);

/**
 * roster id → the comics identity the wiki files renders under.
 *
 * Hand-authored once, committed, and reviewed as data. Two entries key on
 * themselves because the wiki does too (Danger is an X-Men construct with no
 * civilian name; Peni Parker is already the identity).
 *
 * `champion` is the entry that matters most: he has NO poster — he is a hidden
 * unlockable the marketing never covered — but the wiki documents him, so the
 * render is his only art. Without this row he would be the one fighter falling
 * through to a generated tile.
 */
const IDENTITY: Record<string, string> = {
  'captain-america': 'Steven Rogers',
  'iron-man': 'Anthony Stark',
  hulk: 'Bruce Banner',
  'black-panther': 'Shuri',
  'spider-man': 'Peter Parker',
  'ms-marvel': 'Kamala Khan',
  'star-lord': 'Peter Quill',
  'peni-parker': 'Peni Parker',
  storm: 'Ororo Munroe',
  magik: 'Illyana Rasputina',
  wolverine: 'James Howlett',
  danger: 'Danger',
  'doctor-doom': 'Victor von Doom',
  magneto: 'Max Eisenhardt',
  'green-goblin': 'Norman Osborn',
  carnage: 'Cletus Kasady',
  'ghost-rider': 'Roberto Reyes',
  blade: 'Eric Brooks',
  loki: 'Loki Laufeyson',
  deadpool: 'Wade Wilson',
  champion: 'Tryco Slatterus',
};

/** Display names as the poster filenames spell them. Mirrors ROSTER in
 *  scripts/characters.ts; asserted equal at the end of this run. */
const POSTER_NAME: Record<string, string> = {
  'captain-america': 'Captain America',
  'iron-man': 'Iron Man',
  hulk: 'Hulk',
  'black-panther': 'Black Panther',
  'spider-man': 'Spider-Man',
  'ms-marvel': 'Ms. Marvel',
  'star-lord': 'Star-Lord',
  'peni-parker': 'Peni Parker',
  storm: 'Storm',
  magik: 'Magik',
  wolverine: 'Wolverine',
  danger: 'Danger',
  'doctor-doom': 'Doctor Doom',
  magneto: 'Magneto',
  'green-goblin': 'Green Goblin',
  carnage: 'Carnage',
  'ghost-rider': 'Ghost Rider',
  blade: 'Blade',
  loki: 'Loki',
  deadpool: 'Deadpool',
  champion: 'Champion',
};

interface FileInfo {
  title: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
}

async function api<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ ...params, format: 'json' })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`wiki API ${res.status} on ${JSON.stringify(params)}`);
  return (await res.json()) as T;
}

async function categoryFiles(): Promise<string[]> {
  const out: string[] = [];
  let cont: string | undefined;
  do {
    const r = await api<{
      query: { categorymembers: { title: string }[] };
      continue?: { cmcontinue: string };
    }>({
      action: 'query',
      list: 'categorymembers',
      cmtitle: CATEGORY,
      cmlimit: '500',
      ...(cont ? { cmcontinue: cont } : {}),
    });
    out.push(...r.query.categorymembers.map((m) => m.title));
    cont = r.continue?.cmcontinue;
  } while (cont);
  return out;
}

async function imageInfo(titles: string[]): Promise<Map<string, FileInfo>> {
  const out = new Map<string, FileInfo>();
  for (let i = 0; i < titles.length; i += 40) {
    const r = await api<{
      query: {
        pages: Record<
          string,
          {
            title: string;
            imageinfo?: {
              url: string;
              width: number;
              height: number;
              size: number;
              mime: string;
            }[];
          }
        >;
      };
    }>({
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url|size|mime',
      titles: titles.slice(i, i + 40).join('|'),
    });
    for (const p of Object.values(r.query.pages)) {
      const ii = p.imageinfo?.[0];
      if (ii) {
        out.set(p.title, {
          title: p.title,
          url: ii.url,
          width: ii.width,
          height: ii.height,
          bytes: ii.size,
          mime: ii.mime,
        });
      }
    }
  }
  return out;
}

/** The subject a render filename is filed under: everything before the first
 *  "(Earth-358)". Non-greedy, so "Steven Rogers (Hydra Supreme) (Earth-358)…"
 *  yields the Hydra variant as its own subject and cannot collide with the
 *  plain "Steven Rogers" the allow-list wants. */
const subjectOf = (title: string): string | null => {
  const m = /^File:(.+?)\s*\(Earth-358\)/.exec(title);
  return m ? m[1]!.trim() : null;
};

const posterFighterOf = (title: string): string | null => {
  const m = /^File:MARVEL Tōkon Fighting Souls (.+?) poster\.[a-z]+$/i.exec(title);
  return m ? m[1]!.trim() : null;
};

interface Pick {
  id: string;
  portrait?: { file: FileInfo; why: string };
  splash?: { file: FileInfo; why: string };
  notes: string[];
}

async function main() {
  console.log(`Enumerating ${CATEGORY}…`);
  const titles = await categoryFiles();
  console.log(`  ${titles.length} files in the category`);

  const posters = new Map<string, string>(); // fighter display name → title
  const renders = new Map<string, string[]>(); // comics identity → titles
  for (const t of titles) {
    const p = posterFighterOf(t);
    if (p) {
      posters.set(p.toLowerCase(), t);
      continue;
    }
    const s = subjectOf(t);
    if (s) renders.set(s, [...(renders.get(s) ?? []), t]);
  }
  console.log(`  ${posters.size} poster(s), ${renders.size} render subject(s)`);

  // Resolve candidates per fighter, then batch one imageinfo call for all of
  // them — the pick between render 001 and 002 needs their dimensions.
  const ids = Object.keys(IDENTITY).filter((id) => !ONLY.size || ONLY.has(id));
  const wanted = new Set<string>();
  for (const id of ids) {
    const pt = posters.get(POSTER_NAME[id]!.toLowerCase());
    if (pt) wanted.add(pt);
    for (const r of renders.get(IDENTITY[id]!) ?? []) wanted.add(r);
  }
  console.log(`  fetching imageinfo for ${wanted.size} candidate file(s)…`);
  const info = await imageInfo([...wanted]);

  const picks: Pick[] = [];
  for (const id of ids) {
    const pick: Pick = { id, notes: [] };
    const posterTitle = posters.get(POSTER_NAME[id]!.toLowerCase());
    const renderTitles = (renders.get(IDENTITY[id]!) ?? []).filter((t) => info.has(t));
    const renderFiles = renderTitles.map((t) => info.get(t)!);

    // splash ← the LARGEST render by pixel count. The hero crops hard and
    // biases right-of-centre, so between 001 and 002 the one with more pixels
    // survives that crop better; hardcoding 001 would be picking by filename
    // rather than by the property that matters.
    if (renderFiles.length) {
      const best = renderFiles.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
      const mp = (f: FileInfo) => ((f.width * f.height) / 1e6).toFixed(1);
      pick.splash = {
        file: best,
        why:
          renderFiles.length > 1
            ? `largest of ${renderFiles.length} renders (${renderFiles
                .map((f) => `${f.width}×${f.height} ${mp(f)}MP`)
                .join(' vs ')})`
            : `only render (${best.width}×${best.height}, ${mp(best)}MP)`,
      };
    }

    if (posterTitle && info.has(posterTitle)) {
      const f = info.get(posterTitle)!;
      pick.portrait = {
        file: f,
        why: `poster ${f.width}×${f.height} (${(f.width / f.height).toFixed(3)})`,
      };
    } else if (pick.splash) {
      pick.portrait = { file: pick.splash.file, why: 'no poster — cropped from the render' };
      pick.notes.push('NO POSTER');
    }

    if (!pick.portrait) pick.notes.push('NO ART — falls back to a generated tile');
    picks.push(pick);
  }

  // ── the table ─────────────────────────────────────────────────────────────
  console.log(`\n${'id'.padEnd(17)}${'portrait'.padEnd(46)}splash`);
  console.log('─'.repeat(110));
  for (const p of picks) {
    console.log(
      `${p.id.padEnd(17)}${(p.portrait?.why ?? '—').slice(0, 44).padEnd(46)}${(p.splash?.why ?? '—').slice(0, 46)}` +
        (p.notes.length ? `  ⚠ ${p.notes.join('; ')}` : ''),
    );
  }
  const missing = picks.filter((p) => !p.portrait);
  console.log(
    `\ncoverage: ${picks.length - missing.length}/${picks.length} with art` +
      (missing.length ? ` · MISSING: ${missing.map((m) => m.id).join(', ')}` : ''),
  );
  for (const p of picks.filter((x) => x.notes.includes('NO POSTER'))) {
    console.log(`  note: ${p.id} has no poster (expected for champion — hidden fighter)`);
  }

  if (DRY) {
    console.log('\n--dry: nothing downloaded.');
    return;
  }

  // ── download + encode ─────────────────────────────────────────────────────
  await mkdir(OUT_DIR, { recursive: true });
  const provenance: Record<string, unknown> = {};

  for (const p of picks) {
    const entry: Record<string, unknown> = {};
    if (p.portrait) {
      const buf = await download(p.portrait.file.url);
      // 3:4 top-anchored. Faces sit high in both families, and the engine's
      // grid is `object-cover` with no object-position — a centre crop would
      // behead the taller sources (SF6 learned this).
      const meta = await sharp(buf).metadata();
      const w = meta.width!;
      const h = meta.height!;
      const targetH = Math.round(w / 0.75);
      const img = sharp(buf);
      if (targetH <= h) img.extract({ left: 0, top: 0, width: w, height: targetH });
      else {
        const targetW = Math.round(h * 0.75);
        img.extract({ left: Math.round((w - targetW) / 2), top: 0, width: targetW, height: h });
      }
      const out = join(OUT_DIR, `${p.id}-portrait.webp`);
      await img.resize({ width: 512 }).webp({ quality: 82 }).toFile(out);
      entry.portrait = {
        source: p.portrait.file.title,
        sourceDimensions: `${w}×${h}`,
        reason: p.portrait.why,
        file: `/img/characters/${p.id}-portrait.webp`,
      };
      process.stdout.write(`  ✓ ${p.id}-portrait.webp\n`);
    }
    if (p.splash) {
      const buf = await download(p.splash.file.url);
      // Shipped TALL and uncropped, matching SF6 (1000×963…1248). The hero
      // box does its own object-cover crop under game.heroFocus; cropping here
      // as well would crop twice and take that control away.
      const out = join(OUT_DIR, `${p.id}-splash.webp`);
      await sharp(buf).resize({ width: 1000 }).webp({ quality: 82 }).toFile(out);
      entry.splash = {
        source: p.splash.file.title,
        sourceDimensions: `${p.splash.file.width}×${p.splash.file.height}`,
        reason: p.splash.why,
        file: `/img/characters/${p.id}-splash.webp`,
      };
      process.stdout.write(`  ✓ ${p.id}-splash.webp\n`);
    }
    provenance[p.id] = entry;
  }

  await writeFile(
    join(ROOT, 'data/art-provenance.json'),
    JSON.stringify(
      {
        source: 'Marvel Database (marvel.fandom.com)',
        category: CATEGORY,
        retrieved: new Date().toISOString().slice(0, 10),
        note: 'Per-file source page, original dimensions and the reason each file won its slot. Re-running is auditable and a swapped asset is visible in review.',
        fighters: provenance,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`\n✔ data/art-provenance.json written for ${picks.length} fighters`);
  console.log('  next: npm run data:characters (re-reads the roster and asserts art exists)');
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`asset ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

await main();
