// One-off generator for the site's default OG card (public/og-default.png,
// 1200×630) — the image every shared link and the character-page meta fallback
// resolve to. app/app.config.ts points `ogImage` here, so until this runs the
// path is a live 404 on every social embed.
//
// Reads data/characters.json so the accent strip along the bottom tracks the
// roster: add a fighter, re-run, and the card reflects it. All 21 accents show,
// which at 4v4 is the point — the strip IS the roster.
//
// DIFFERS FROM THE SIBLINGS IN ONE WAY, DELIBERATELY: they <link> the Google
// Fonts CDN and rely on `networkidle`. This reads Bangers off disk from the
// local @fontsource dependency and inlines it as a data-URI @font-face, then
// waits on document.fonts.ready and ASSERTS the face actually loaded. Two
// reasons: the render becomes fully offline (no CDN, no pinned hash URL), and
// a font that silently fails to load would otherwise ship a card set in a
// fallback face with no warning — the same failure mode that rules sharp out
// of tile generation (see scripts/art-tile.ts).
//
// Run: npx tsx scripts/og.ts

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import type { CharacterRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * BOTH SUBSETS, ALWAYS. `latin` carries A–Z; `latin-ext` carries U+014C, the Ō
 * in TŌKON. Loading only one is not a partial success, it is a broken wordmark:
 * with latin-ext alone every ASCII letter silently falls back to a serif and
 * only the macron renders correctly — observed on the first run of this script.
 * The shell's card-art generator hit the same wall from the other side and
 * documents it in replay-database-shell/scripts/card-art-tokon.mjs.
 */
const BANGERS = [
  {
    file: 'node_modules/@fontsource/bangers/files/bangers-latin-400-normal.woff2',
    range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+2000-206F,U+2122,U+2191,U+2193,U+2212',
  },
  {
    file: 'node_modules/@fontsource/bangers/files/bangers-latin-ext-400-normal.woff2',
    range: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+1E00-1EFF,U+2020,U+20A0-20AB',
  },
];
const MANROPE = join(ROOT, 'node_modules/@fontsource/manrope/files/manrope-latin-600-normal.woff2');

/** Reused verbatim as the shell selector card's tagline (lib/games.ts). */
export const KICKER = '4v4 tag-team replays — browse, filter, study.';

/** Mirrors app/assets/theme.css. */
const BG = '#0a0e17';
const SURFACE = '#101627';
const PRIMARY = '#03a5fe';
const SECONDARY = '#fe6c0c';
const TEXT = '#f0eadd';
const MUTED = '#aeb6cc';
const INK = '#06101b';

async function main(): Promise<void> {
  const characters = JSON.parse(
    await readFile(join(ROOT, 'data/characters.json'), 'utf8'),
  ) as CharacterRecord[];
  const strip = characters
    .map((c) => `<span style="flex:1;background:${c.accent};"></span>`)
    .join('');

  const bangerFaces = (
    await Promise.all(
      BANGERS.map(async ({ file, range }) => {
        const b64 = (await readFile(join(ROOT, file))).toString('base64');
        return `@font-face{font-family:'Bangers';font-weight:400;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range};}`;
      }),
    )
  ).join('\n  ');
  const manrope = (await readFile(MANROPE)).toString('base64');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${bangerFaces}
  @font-face{font-family:'Manrope';font-weight:600;src:url(data:font/woff2;base64,${manrope}) format('woff2');}
  *{margin:0;box-sizing:border-box}
  </style></head>
  <body style="width:1200px;height:630px;background:${BG};overflow:hidden;position:relative;font-family:'Manrope',sans-serif;">
    <!-- comic panel gutters + screentone: the register the skin is built on -->
    <div style="position:absolute;inset:0;background:repeating-linear-gradient(135deg,${SURFACE},${SURFACE} 22px,${BG} 22px,${BG} 44px);opacity:.55;"></div>
    <div style="position:absolute;inset:0;background-image:radial-gradient(${PRIMARY} 1.7px,transparent 1.8px);background-size:14px 14px;opacity:.13;
                -webkit-mask-image:linear-gradient(115deg,rgba(0,0,0,.9),rgba(0,0,0,0) 66%);"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(72% 108% at 84% 12%,rgba(3,165,254,.28),transparent 60%);"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(52% 78% at 10% 96%,rgba(254,108,12,.16),transparent 60%);"></div>

    <div style="position:absolute;left:80px;top:150px;">
      <div style="display:flex;align-items:center;gap:26px;">
        <div style="width:118px;height:118px;background:${PRIMARY};clip-path:polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,24px 100%,0 calc(100% - 24px));display:flex;align-items:center;justify-content:center;">
          <span style="font-family:'Bangers';font-size:74px;color:${INK};transform:skewX(-8deg);">/</span>
        </div>
        <div style="font-family:'Bangers';font-size:104px;letter-spacing:.02em;color:${TEXT};line-height:1;">TŌKON<span style="color:${SECONDARY};">/</span>REPLAY</div>
      </div>
      <div style="margin-top:34px;font-size:30px;font-weight:600;color:${MUTED};">The competitive MARVEL Tōkon: Fighting Souls replay database</div>
      <div style="margin-top:14px;font-size:22px;font-weight:600;color:${MUTED};opacity:.72;">${KICKER}</div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:14px;display:flex;">${strip}</div>
  </body></html>`;

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1200, height: 630 } })
  ).newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  // Check the ACTUAL STRINGS, not the default sample. `document.fonts.check`
  // with no text argument tests a generic sample and returns true as soon as
  // ANY subset of the family has loaded — which is how the first run of this
  // script passed its own guard while rendering every ASCII letter of the
  // wordmark in a serif fallback. Passing the real text makes the check span
  // every glyph that actually has to render.
  //
  // The width comparison is the second half: a family can be "available" and
  // still not be the face doing the drawing. Bangers is a condensed comic face,
  // so its advance width for the wordmark differs sharply from any fallback.
  /**
   * PER-SUBSET verification. Two weaker guards were tried first and BOTH passed
   * while the card rendered wrong, so this is the third and the reasoning is
   * worth keeping:
   *
   *  · `document.fonts.check(font, text)` returns TRUE for a family whose
   *    declared unicode-ranges do not cover the text. Characters outside every
   *    range fall back to a system font, and a system font is always
   *    "available", so nothing reports missing.
   *  · Comparing the whole wordmark's width against serif also passes, because
   *    a half-loaded family renders a MIXED string — Ō in Bangers, A–Z in
   *    serif — whose width differs from pure serif anyway.
   *
   * So each subset is asserted through a string only IT can draw: a pure-ASCII
   * run for `latin`, and the bare macron for `latin-ext`. If a subset is
   * missing, its probe string falls back and measures identical to serif.
   *
   * NB: no named inner functions in page.evaluate — tsx/esbuild wraps them in a
   * `__name` helper that does not exist in the page, and evaluate dies with
   * "__name is not defined".
   */
  const probe = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    // Baseline against a family that CANNOT exist, so both measurements resolve
    // to the very same default face. Comparing against `serif` instead is what
    // let a broken subset slip through once: missing glyphs fall back to the
    // default (sans) face, not to serif, so the widths differed for a reason
    // that had nothing to do with Bangers drawing anything.
    const NOPE = '__no_such_family__';
    ctx.font = `400 104px Bangers, ${NOPE}`;
    const asciiB = ctx.measureText('REPLAY').width;
    const macronB = ctx.measureText('Ō').width;
    ctx.font = `400 104px ${NOPE}`;
    const asciiS = ctx.measureText('REPLAY').width;
    const macronS = ctx.measureText('Ō').width;
    ctx.font = `600 30px Manrope, ${NOPE}`;
    const uiB = ctx.measureText('The competitive').width;
    ctx.font = `600 30px ${NOPE}`;
    const uiS = ctx.measureText('The competitive').width;
    return { asciiB, asciiS, macronB, macronS, uiB, uiS };
  });
  const latin = Math.abs(probe.asciiB - probe.asciiS) > 1;
  const latinExt = Math.abs(probe.macronB - probe.macronS) > 1;
  const ui = Math.abs(probe.uiB - probe.uiS) > 1;
  if (!latin || !latinExt || !ui) {
    await browser.close();
    throw new Error(
      `og.ts: refusing to ship a card set in a fallback face.\n` +
        `  Bangers latin (A–Z):   ${latin ? 'ok' : 'MISSING'}  ("REPLAY" ${probe.asciiB.toFixed(1)}px vs fallback ${probe.asciiS.toFixed(1)}px)\n` +
        `  Bangers latin-ext (Ō): ${latinExt ? 'ok' : 'MISSING'}  ("Ō" ${probe.macronB.toFixed(1)}px vs fallback ${probe.macronS.toFixed(1)}px)\n` +
        `  Manrope:               ${ui ? 'ok' : 'MISSING'}\n` +
        `  Both Bangers subsets are required: latin draws the wordmark, latin-ext draws the Ō.`,
    );
  }
  console.log(
    `  fonts verified per subset — latin "REPLAY" ${probe.asciiB.toFixed(0)}px vs fallback ${probe.asciiS.toFixed(0)}px · ` +
      `latin-ext "Ō" ${probe.macronB.toFixed(0)}px vs fallback ${probe.macronS.toFixed(0)}px`,
  );

  const png = await page.screenshot({ type: 'png' });
  await browser.close();
  await writeFile(join(ROOT, 'public/og-default.png'), png);
  console.log(
    `✓ public/og-default.png (${png.length} bytes, ${characters.length} accents in the strip)`,
  );
}

main().catch((err) => {
  console.error('✖ og.ts failed:', err);
  process.exit(1);
});
