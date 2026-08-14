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

---

# Crop sweep — findings

`npx tsx scripts/spike/sweep.ts --per-channel 2` then
`npx tsx scripts/spike/ocr-probe.ts --frames 40`. Ten VODs, two per channel,
~740 frames. All measurement is OCR-independent (a local-range filter over the
top strip), because whether OCR works was the open question.

| channel          |   n | upload |   band y0 |   band y1 | right anchor | letterbox | round 1 ≤2s | distinct plates L \| R |
| ---------------- | --: | -----: | --------: | --------: | -----------: | --------: | ----------: | ---------------------- |
| highLevelReplays |   2 |  1440p |     0.031 |     0.053 |        0.905 |      none |         2/2 | 2/3 \| 1/4             |
| proReplays       |   2 |  1440p |     0.031 |     0.053 |        0.899 |      none |         2/2 | 3/3 \| 4/3             |
| hadoukenReplays  |   2 |  1440p |     0.027 |     0.053 |        0.905 |      none |         2/2 | 4/2 \| 6/5             |
| replaysHub       |   2 |  1440p |     0.030 |     0.053 |        0.902 |      none |         2/2 | 5/4 \| 3/4             |
| fightingStationX |   2 |  1080p |     0.029 |     0.054 |        0.904 |      none |         1/2 | 3/6 \| 6/6             |
| **spread**       |     |        | **0.006** | **0.001** |    **0.015** |         — |             |                        |

## One box, not five

The vertical band agrees to **0.006 of frame height — about 4px at 720p** — and
the right-plate anchor to 0.015 (~19px). Nobody letterboxes. **One crop serves
all five channels; the config does not need to key by `ChannelKey`.**

Two caveats, stated because the numbers alone would overclaim:

- The **left** ink-start spread is wide (0.054–0.108) and is NOT framing
  variance. The run detector searches from x=0.02 and on some videos latches
  onto the bench-portrait cluster that sits at x<0.10. The left plate should be
  anchored at a fixed x with a generous width, exactly as the right one is
  anchored at `xEnd`; the measured left edge is not trustworthy as an anchor.
- **Uploads are 1440p on four channels and 1080p on the fifth.** Every frame is
  fetched at 720p, so this is not a geometry difference — it is a sharpness one,
  and it should show up as OCR confidence rather than as a crop change.

## UI language

**Latin on all ten VODs.** Reads came back `BLACK PANTHER`, `BLADE`,
`STAR-LORD`, `SPIDER-MAN`, `MAGNETO`. No katakana nameplate was seen on any
channel — note this is separate from player handles, one of which is Japanese
(`シルクちゃん`) on a channel whose UI is English. The katakana path and its
much tighter alias distances are not needed today; the finding is per-channel
and should be re-checked when a channel is added.

## Where the bench lives — and what this sweep may NOT conclude

**Round 1 begins at t≤2s on 9 of 10 videos.** The uploaders trim the pre-match
screens. So the correct statement is: **no text list of all eight is present in
these uploads.** That is a fact about how these five channels edit, not about
the game's UI — the character-select and loading screens may well show all eight
as text and simply never survive the cut. Nothing here licenses a claim about
what the game does.

## Does the bench need pixels at all?

Distinct nameplate images per side, clustered by perceptual hash of the glyph
edge mask (threshold 18/64, the middle of a measured plateau: 8→13 clusters,
12→10, **16→4, 20→4**, 24→3):

- median **4.0** distinct plates per side
- **17 of 20** sides showed ≥3 distinct fighters
- **11 of 20** showed ≥4
- worst case: 1

Tag-cycling therefore exposes most of a team through the nameplate alone. The
portrait tier is not the main event; it is the tail — and the tail is roughly
3 sides in 20 where two or more fighters never entered.

## The tesseract verdict: READABLE — no font-template hatch

Scored on **HUD-bearing frames only**, 80 plates across all five channels, five
tones × both polarities:

- **39% exact** alias hit · **26%** within 2 edits · **65% combined**
- **0%** returned nothing

Per the pre-agreed rule this is _not_ the font-template trigger. The face is
legible to tesseract, not merely to a human. 65% per frame is ample for a
voting fold that requires ≥2 frames per character.

**The first run of this probe said 38% and printed "OCR CANNOT READ THIS
FACE."** It sampled frames by stride across every cached frame, including K.O.
cards, round banners and the pre-match VS art — none of which contain a
nameplate. Scoring silence on those as a miss measured the sampler, not the
reader, and would have triggered days of font-template work on a face that
reads fine. The plan's own rule — _score over HUD-bearing frames only_ — is what
caught it, and the probe now takes its frame list from the sweep's `hudSecs`.

Polarity note: the sibling negates before reading because its glyphs are
near-white; this face is a mid-dark fill inside a bright outline, so both
polarities are tried and both contribute reads.

## Normalisation, settled

Whitelist `A–Z . - space`, `norm()` stripping to the same class, and the
`data/characters.json` alias keys now agree. The radius cap can be computed
against these strings and not before.
