# Frame recon — findings

Step one of the extraction track, and the gate on the rest of it. Run
`npx tsx scripts/spike/recon.ts`, then look at
`cache/tokon/frames/<id>/<seconds>.png`.

**Sample:** 4 VODs, one per bench-queue channel, longest-first (a longer set has
more game boundaries, and a boundary is where a VS card lives). 401 frames:
a dense 0.5 fps window over the match start, another over a mid-set boundary,
and a 12-point in-match sweep. ~443 MB of frames, clips pruned.

| id            | channel          | frames |
| ------------- | ---------------- | -----: |
| `7waws6UKAH4` | hadoukenReplays  |    101 |
| `C5H1n_0D2ic` | replaysHub       |    101 |
| `w24ObgR7Jfs` | proReplays       |    101 |
| `LxwV1YO7eGE` | fightingStationX |     98 |

---

## 1. Where do eight identities live?

**Three places, and only one of them is a usable primary source.**

**The point character is TEXT.** A large outlined nameplate, left-aligned in the
top-left corner and right-aligned in the top-right, present on every in-match
frame: `STAR-LORD`, `BLACK PANTHER`, `LOKI`, `GHOST RIDER`, `DANGER`, `BLADE`.
Set in the game's heavy condensed display face with a dark outline over live
gameplay.

**The bench is PORTRAIT-ONLY.** Three small tiles per corner, fanned and
overlapping, roughly 40–60 px at 720p, partially occluded by the point
character's own splash. No text anywhere on them.

**The VS card is not an identity source.** The first ~2 seconds of a match show
a full-bleed card with all eight characters — but as overlapping, cropped,
stylised key art, captioned with **player-chosen team names**
(`GALACTIC GUNSLINGERS` vs `NEIGHBORHOOD GENIUSES`). Those are user strings, not
fighter names. The art is not tiled, not aligned, and not consistently framed.

### The finding that decides the reader

**The point nameplate CYCLES as players tag.** Measured inside one match on
`7waws6UKAH4`: the right nameplate reads `SPIDER-MAN` at round 1 and
`GREEN GOBLIN` later in the same set, because the player tagged. The HUD follows
the active fighter.

So sampling the nameplate across a match and taking the **union of reads** is a
primary source for every fighter who actually got played — which is the
platform's existing fold, unchanged, and exactly how a sibling recovers
mid-set counter-picks.

**Consequence for the design:** OCR on one clean text region is the primary
reader. Portrait matching drops to a _completion_ source, for bench members who
never tag in at all. That is a much smaller and much less risky job than
identifying three overlapping 50 px tiles was going to be.

What it cannot do: a fighter who is on the team but never enters still needs the
portrait tier, or stays unknown. That is honest partial data — a 3-of-4 side is
publishable under the `1..N` contract — and it is what the bench queue is for.

## 2. When is the bench legible?

Continuously. The nameplate is persistent through gameplay, so there is no
event-locked window to hit and no dense sampling requirement — the standard
in-match sweep works. The only event-locked screen (the VS card) turned out not
to be worth catching, which retires the concern that motivated the dense
start-window in the first place.

## 3. Does the bench grey or recolour?

**Yes, and worse than the hazard as originally stated.** On
`7waws6UKAH4` at round-1 start, with nobody KO'd, the right-hand bench shows
Green Goblin in **full colour inside a blue-bordered diamond** and two further
tiles in **greyscale with white borders**. The left bench shows the same mix:
one orange-bordered colour tile, one greyscale.

Desaturation is therefore a **design state** — on-deck versus further back — and
not a damage or KO signal. Two consequences:

- **Hue gating is unsafe here.** A sibling's portrait matcher gates candidates
  on hue before comparing structure; on this HUD that would reject the correct
  answer for two of every three bench slots.
- A structural hash on luminance-normalised crops is the right primitive if the
  portrait tier is built, and the colour/greyscale pair must both be in the
  template set for every fighter.

## 4. Is framing stable across channels?

**Yes.** Nameplates and bench clusters land at the same fractional positions in
all four channels — these are direct in-game replay captures at 16:9, not
broadcast overlays. The per-video framing normalisation a sibling needed (median
health-bar landmark, translate-only correction) is **not required here**, which
removes the single most fragile part of that pipeline.

Transient overlays do intrude on the nameplate's neighbourhood and must be kept
out of the crop rather than normalised away:

- an in-game player-handle box beside the left nameplate on some captures
  (`CLOUD805`, `SONIC FOX`);
- a `LEADER / P1` callout that can overlap the right end of the left nameplate;
- a round-win pip row and a star icon toward centre.

---

## What this gates

Next step is the **crop sweep** — measure the nameplate box by read rate over
HUD-bearing frames, and accept a plateau rather than a peak. The transients
above are exactly why the box has to be measured rather than eyeballed: a crop
wide enough to catch `BLACK PANTHER` may also catch `LEADER`.

The live risk is now **OCR hostility**, not geometry. The nameplate face is a
heavy condensed display type with a hard outline, rendered over animated art —
the same profile that defeated tesseract on a sibling's perfectly legible Latin
plates. If the ensemble cannot read it, the planned escape hatch applies: render
all 21 roster names in that face, dHash the rendered strip, and match over a
closed set. That contingency is why the roster's alias normalisation has to be
settled before any distance table is computed.
