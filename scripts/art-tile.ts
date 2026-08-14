/**
 * The comic-register fallback tile — and the ground under transparent cutouts.
 *
 * Two jobs, one renderer:
 *
 *  1. GROUND. A fighter whose art is a transparent character render (rather
 *     than one of the wiki's comic-cover posters) gets that cutout composited
 *     over an accent ground, so the roster grid reads as one set instead of one
 *     odd tile. Champion is the live case: he is a hidden unlockable the
 *     marketing never covered, so no poster exists for him.
 *  2. FALLBACK. A fighter with no usable art at all gets a tile carrying the
 *     accent, the halftone, and the name set in Bangers. Nothing uses this
 *     today — coverage is 21/21 — but it is what lets scripts/characters.ts go
 *     back to FAIL-LOUD honestly: every roster id resolves to a real file, and
 *     a DLC fighter landing before its art does still ships something on-brand
 *     instead of a 404 or a build break.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY HEADLESS CHROME AND NOT sharp.
 *
 * sharp cannot set type in Bangers on this platform, and — worse — it fails
 * SILENTLY. Measured, not assumed:
 *   · @fontsource/bangers ships woff/woff2 only, no ttf/otf;
 *   · Bangers is absent from fontconfig (105 families, none of them it);
 *   · librsvg ignores a base64 @font-face inside the SVG, and sharp's
 *     `fontfile:` option is a no-op for these files — a deliberately bogus
 *     path produced no error either.
 * Every variant rendered BYTE-IDENTICAL to the DejaVu Sans fallback. Twenty-one
 * tiles in the wrong typeface, with no warning, is precisely the class of
 * failure this codebase legislates against.
 *
 * The platform's proven path is headless Chrome with the font inlined as a
 * data-URI @font-face and a `document.fonts.ready` barrier before the
 * screenshot — see replay-database-shell/scripts/card-art-tokon.mjs, which this
 * follows structurally. One improvement over that precedent: Bangers is a local
 * dependency here, so the woff2 is read off disk instead of fetched from
 * gstatic, and the render is fully offline.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Run: npx tsx scripts/art-tile.ts [--only <id,…>] [--force]
 */

import { readFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/img/characters');
const TOKENS = join(ROOT, 'design/handoff/tokens.css');
const BANGERS = join(ROOT, 'node_modules/@fontsource/bangers/files/bangers-latin-400-normal.woff2');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

const args = process.argv.slice(2);
const ONLY = new Set(
  (args.find((a) => a.startsWith('--only'))?.split('=')[1] ?? '').split(',').filter(Boolean),
);
const FORCE = args.includes('--force');

const W = 512;
const H = 683; // 3:4, the platform portrait norm

/** Surfaces, mirrored from theme.css so the tile sits in the same palette as
 *  the card it renders on. */
const BG = '#0a0e17';
const SURFACE = '#101627';
const INK = '#06101b';
const CREAM = '#f0eadd';

async function accents(): Promise<Record<string, string>> {
  const css = await readFile(TOKENS, 'utf8');
  return Object.fromEntries(
    [...css.matchAll(/--char-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [
      m[1]!,
      m[2]!.toLowerCase(),
    ]),
  );
}

/**
 * The tile. Comic register: accent ground, two halftone dot fields at different
 * scales masked so they shade off like screentone rather than tiling flat, an
 * ink gutter, and the platform's corner-cut notch. The name is set in Bangers
 * and only rendered when nothing is being composited over the tile.
 */
function html(fontB64: string, accent: string, label: string | null): string {
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:'Bangers';font-style:normal;font-weight:400;
    src:url(data:font/woff2;base64,${fontB64}) format('woff2');}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;background:${BG}}
  .tile{position:relative;width:${W}px;height:${H}px;overflow:hidden;
    background:linear-gradient(160deg,${accent} 0%,color-mix(in srgb,${accent} 55%,${SURFACE}) 58%,${SURFACE} 100%);
    clip-path:polygon(0 0,calc(100% - 34px) 0,100% 34px,100% 100%,34px 100%,0 calc(100% - 34px));}
  /* screentone, two scales, gradient-masked so it reads as printed ink */
  .dots-a{position:absolute;inset:0;
    background-image:radial-gradient(${INK} 1.6px,transparent 1.7px);background-size:11px 11px;
    -webkit-mask-image:linear-gradient(150deg,rgba(0,0,0,.55),rgba(0,0,0,.05) 62%,rgba(0,0,0,.35));}
  .dots-b{position:absolute;inset:0;
    background-image:radial-gradient(${CREAM} 2.1px,transparent 2.2px);background-size:19px 19px;opacity:.16;
    -webkit-mask-image:linear-gradient(20deg,rgba(0,0,0,.7),rgba(0,0,0,0) 70%);}
  .gutter{position:absolute;inset:9px;border:2px solid ${INK};opacity:.5;
    clip-path:polygon(0 0,calc(100% - 26px) 0,100% 26px,100% 100%,26px 100%,0 calc(100% - 26px));}
  .label{position:absolute;left:0;right:0;bottom:34px;text-align:center;padding:0 18px;
    font-family:'Bangers',sans-serif;color:${CREAM};line-height:.92;
    text-shadow:0 3px 0 ${INK},0 0 22px rgba(0,0,0,.45);
    font-size:${label && label.length > 12 ? 46 : 62}px;letter-spacing:.02em;}
  </style>
  <div class="tile"><div class="dots-a"></div><div class="dots-b"></div><div class="gutter"></div>
  ${label ? `<div class="label">${label.toUpperCase()}</div>` : ''}</div>`;
}

async function main() {
  const acc = await accents();
  const characters = JSON.parse(await readFile(join(ROOT, 'data/characters.json'), 'utf8')) as {
    id: string;
    name: string;
  }[];
  const fontB64 = (await readFile(BANGERS)).toString('base64');
  await mkdir(OUT_DIR, { recursive: true });

  const targets = characters.filter((c) => !ONLY.size || ONLY.has(c.id));
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  let grounds = 0;
  let fallbacks = 0;

  for (const c of targets) {
    const portrait = join(OUT_DIR, `${c.id}-portrait.webp`);
    let existing: Buffer | null = null;
    try {
      await access(portrait);
      existing = await readFile(portrait);
    } catch {
      /* no art at all */
    }

    // A cutout (alpha) needs a ground; an opaque poster is already a finished
    // tile and must be left alone.
    const needsGround = existing ? ((await sharp(existing).metadata()).hasAlpha ?? false) : false;
    if (existing && !needsGround && !FORCE) continue;

    const label = existing ? null : c.name;
    await page.setContent(html(fontB64, acc[c.id] ?? '#888888', label), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // Prove the face actually loaded rather than trusting it — the whole reason
    // this render is not done in sharp.
    if (label) {
      // Measure against a family that CANNOT exist, so both measurements land
      // on the identical default face. `document.fonts.check` alone is NOT
      // sufficient — it returns true for a family whose declared unicode-range
      // does not cover the text, because the uncovered glyphs fall back to a
      // system font and a system font is always "available". og.ts shipped a
      // serif wordmark past exactly that check once.
      const probe = await page.evaluate((text: string) => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = '400 62px Bangers, __no_such_family__';
        const drawn = ctx.measureText(text).width;
        ctx.font = '400 62px __no_such_family__';
        return { drawn, fallback: ctx.measureText(text).width };
      }, label.toUpperCase());
      if (Math.abs(probe.drawn - probe.fallback) < 1) {
        throw new Error(
          `Bangers is not drawing "${label.toUpperCase()}" for ${c.id} ` +
            `(${probe.drawn.toFixed(1)}px === fallback ${probe.fallback.toFixed(1)}px) — ` +
            `refusing to ship a tile in a fallback face`,
        );
      }
    }
    const shot = await page.screenshot({ type: 'png' });

    const out = sharp(shot);
    if (existing) {
      // Composite the transparent render over the ground it now sits on.
      out.composite([{ input: existing, blend: 'over' }]);
      grounds += 1;
    } else {
      fallbacks += 1;
    }
    await out.webp({ quality: 82 }).toFile(portrait);
    console.log(
      `  ✓ ${c.id}-portrait.webp  (${existing ? 'cutout over accent ground' : 'generated tile'})`,
    );
  }

  await browser.close();
  console.log(
    `\n✔ ${grounds} cutout(s) grounded, ${fallbacks} tile(s) generated` +
      (grounds + fallbacks === 0 ? ' — every fighter already has finished art' : ''),
  );
}

await main();
