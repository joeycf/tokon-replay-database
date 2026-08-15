/**
 * STEP 2 — the decoding radius, derived from the roster rather than asserted.
 *
 * Prints the table the reader's fuzzy matching is governed by, and exercises the
 * matcher against the strings that actually threaten it: OCR digit-for-letter
 * substitutions, broadcast chrome, and the prose abbreviations that must NOT
 * resolve because the nameplate never shows them.
 *
 * Two guards, and the budget is the MINIMUM of them:
 *   · length scale on the OCR TEXT — a short read is a noise magnet
 *   · each key's own unique-decoding radius, floor((nearest - 1) / 2)
 *
 * Run: npx tsx scripts/spike/radius.ts
 */

import { buildAliasMatcher, buildPlateRoster, loadCharacters, norm, osa } from '../roster';

const characters = await loadCharacters();
const plate = buildPlateRoster(characters);
const prose = buildAliasMatcher(characters);

const proseKeys = characters.flatMap((c) =>
  (c.extra?.aliases ?? [c.name.toLowerCase()]).map((a) => ({ id: c.id, key: norm(a) })),
);

console.log(`roster: ${characters.length} fighters`);
console.log(`  prose alias keys  : ${proseKeys.length}   (titles, descriptions)`);
console.log(`  plate keys        : ${plate.keys.length}   (the HUD nameplate)\n`);

// ── what the split buys ─────────────────────────────────────────────────────
const minCross = (ks: { id: string; key: string }[]) => {
  let m = Infinity;
  let pair = ['', ''];
  for (const a of ks) {
    for (const b of ks) {
      if (a.id === b.id) continue;
      const d = osa(a.key, b.key);
      if (d < m) {
        m = d;
        pair = [a.key, b.key];
      }
    }
  }
  return { m, pair };
};
const pk = minCross(proseKeys);
const ck = minCross(plate.keys);
console.log('── why the reader does not get the prose table ──────────────────────');
console.log(`  minimum cross-fighter distance, prose keys : ${pk.m}  (${pk.pair.join(' / ')})`);
console.log(`  minimum cross-fighter distance, plate keys : ${ck.m}  (${ck.pair.join(' / ')})`);
console.log(
  '  A global cap is floor((min - 1) / 2), so the prose table would force every\n' +
    '  key to the tightest pair in it — and that pair is two abbreviations the\n' +
    '  nameplate can never render.\n',
);

// ── the table ───────────────────────────────────────────────────────────────
console.log('── per-key decoding radius ──────────────────────────────────────────');
console.log('  key               len   nearest   radius');
for (const k of [...plate.keys].sort((a, b) => a.radius - b.radius || a.key.localeCompare(b.key))) {
  console.log(
    `  ${k.key.padEnd(17)} ${String(k.key.length).padStart(3)}   ${String(k.nearest).padStart(7)}   ${String(k.radius).padStart(6)}`,
  );
}
const dist = new Map<number, number>();
for (const k of plate.keys) dist.set(k.radius, (dist.get(k.radius) ?? 0) + 1);
console.log(
  `\n  distribution: ${[...dist]
    .sort((a, b) => a[0] - b[0])
    .map(([r, n]) => `radius ${r} → ${n}`)
    .join(' · ')}\n`,
);

// ── the matcher, against what threatens it ──────────────────────────────────
interface Probe {
  text: string;
  want: string | null;
  why: string;
}
const PROBES: Probe[] = [
  // true plates
  { text: 'STORM', want: 'storm', why: 'exact' },
  { text: 'DOCTOR DOOM', want: 'doctor-doom', why: 'exact, multi-word' },
  { text: 'SPIDER-MAN', want: 'spider-man', why: 'exact, hyphen survives normalise' },
  { text: 'MS. MARVEL', want: 'ms-marvel', why: 'exact, period survives normalise' },
  { text: 'CAPTAIN AMERICA', want: 'captain-america', why: 'exact, longest key' },
  // OCR substitutions a condensed face actually produces
  { text: 'ST0RM', want: 'storm', why: 'O→0, one edit, inside radius 1' },
  { text: 'L0KI', want: 'loki', why: 'O→0, one edit, inside radius 1' },
  { text: 'MAGNET0', want: 'magneto', why: 'O→0, one edit, inside radius 1' },
  { text: 'CAPTAIN AMERIGA', want: 'captain-america', why: 'C→G, inside radius 4' },
  { text: 'DOCTOR D00M', want: 'doctor-doom', why: 'two edits, inside radius 3' },
  { text: 'SPIDERMAN', want: 'spider-man', why: 'dropped hyphen, inside radius 2' },
  // A TRANSPOSITION IS A CORRUPTED RENDERING, NOT AN ABBREVIATION, and the two
  // must not be lumped together. `STROM` is in the prose table because uploaders
  // typo it; the reader seeing STROM is OCR having swapped two glyphs of the
  // plate STORM, which is exactly the error OSA exists to forgive. It resolves.
  { text: 'STROM', want: 'storm', why: 'transposition of STORM — OSA distance 1' },
  // must NOT resolve — prose abbreviations, which are different WORDS rather
  // than corrupted renderings, and which the nameplate never shows
  { text: 'DOOM', want: null, why: 'prose alias; 7 edits from DOCTOR DOOM' },
  { text: 'SPIDEY', want: null, why: 'prose alias; nowhere near a plate key' },
  // must NOT resolve — broadcast chrome and short artefacts
  { text: 'ST', want: null, why: 'too short to be a name' },
  { text: 'ROUND 1', want: null, why: 'chrome' },
  { text: 'K.O.', want: null, why: 'chrome' },
  { text: 'PLAYER ONE', want: null, why: 'chrome' },
  { text: 'WINNER', want: null, why: 'chrome' },
  { text: 'FIGHTING SOULS', want: null, why: 'chrome — and 8 from CAPTAIN AMERICA' },
];

console.log('── matcher probes ───────────────────────────────────────────────────');
let bad = 0;
for (const p of PROBES) {
  const got = plate.match(p.text);
  const ok = (got?.id ?? null) === p.want;
  if (!ok) bad++;
  console.log(
    `  ${ok ? '✔' : '✖'} ${JSON.stringify(p.text).padEnd(18)} → ` +
      `${(got ? `${got.id} d${got.dist} m${got.margin === Infinity ? '∞' : got.margin}` : 'null').padEnd(28)} ${p.why}`,
  );
}

// The prose matcher must still resolve every one of those abbreviations, or the
// split has broken the parser instead of protecting the reader.
console.log('\n── the prose matcher still owns the abbreviations ───────────────────');
for (const t of ['doom', 'spidey', 'strom', 'doctor doom', 'spider-man']) {
  const id = prose.one(t);
  const ok = id !== null;
  if (!ok) bad++;
  console.log(`  ${ok ? '✔' : '✖'} ${JSON.stringify(t).padEnd(14)} → ${id ?? 'null'}`);
}

console.log(
  bad === 0
    ? '\n✔ radius table derived; every probe behaved\n'
    : `\n✖ ${bad} probe(s) misbehaved\n`,
);
process.exit(bad === 0 ? 0 : 1);
