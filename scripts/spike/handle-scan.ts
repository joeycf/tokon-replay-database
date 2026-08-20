/**
 * Which cached frames have text in the player-handle band? A NEGATIVE RESULT.
 *
 * Written to make the bench-review attribution crop smarter: 42 side-slots could
 * not be attributed by the plate, the reviewer has to read the player's handle
 * instead, and a narrow crop around the handle would be sharper than a wide one.
 * So this scans every cached frame of a video for text-like ink in the band where
 * the handle was measured on a labelled frame — under the health bar, y 0.09-0.16.
 *
 * IT DOES NOT FIND HANDLES. On 1pajhpbg44Y the five top-scoring frames are result
 * screens: the winner is "TOTAL DAMAGE 18000", against a median band ink of 0.004.
 * The statistic finds TEXT, and the HUD has other text in it.
 *
 * Two things came out of that, both worth more than the tool:
 *
 *   · The handle MOVES. Under the health bar on one upload ("Hikari"), inside a
 *     banner above it on another ("MIKEY", at y 0.03 — outside this scan's band
 *     entirely), in a red overlay on a third ("ROCK-MF"). A band tuned to one
 *     layout returns gameplay for the rest, which is what the reviewer was being
 *     shown.
 *   · So the attribution crop became the side's whole top QUADRANT, and the
 *     reviewer finds the name wherever that uploader put it. Less clever, and it
 *     works on every layout instead of one.
 *
 * Kept because the next person to think "just crop where the handle is" should be
 * able to see, in one command, why that does not hold.
 *
 * Run: npx tsx scripts/spike/handle-scan.ts <videoId>
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { CACHE } from '../hud-frames';

const id = process.argv[2]!;
const dir = join(CACHE, 'frames', id);
const secs = readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => Number(f.replace('.png', ''))).sort((a, b) => a - b);
// text-like ink in the handle band, both sides
const rows: { sec: number; L: number; R: number }[] = [];
for (const sec of secs) {
  const f = join(dir, `${String(sec).padStart(6, '0')}.png`);
  const { data, info } = await sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const ink = (x0: number, x1: number) => {
    let b = 0, t = 0;
    for (let y = Math.round(H * 0.09); y < H * 0.16; y++)
      for (let x = Math.round(W * x0); x < W * x1; x++) {
        let mn = 255, mx = 0;
        for (let k = -2; k <= 2; k++) { const v = data[y * W + Math.min(W - 1, Math.max(0, x + k))]!; if (v < mn) mn = v; if (v > mx) mx = v; }
        t++; if (mx - mn > 90) b++;
      }
    return b / t;
  };
  rows.push({ sec, L: ink(0.12, 0.30), R: ink(0.70, 0.88) });
}
rows.sort((a, b) => b.R - a.R);
console.log('top frames by handle-band ink (RIGHT side):');
for (const r of rows.slice(0, 8)) console.log(`  sec ${String(r.sec).padStart(4)}  R ${r.R.toFixed(3)}  L ${r.L.toFixed(3)}`);
console.log('\nmedian R ink:', rows[Math.floor(rows.length / 2)]!.R.toFixed(3), ' frames:', rows.length);
