# MARVEL Tōkon Replay Database

The competitive **MARVEL Tōkon: Fighting Souls** replay archive — a thin
consumer of the [`replay-engine`](https://github.com/joeycf/replay-engine) Nuxt
layer plus a bespoke data pipeline. Lives behind the shell at
`replaydatabase.com/tokon`.

Fourth game on the platform, and the first at **4v4**.

## The genericity knobs, deliberately

| knob                              | value                       | why                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `charactersPerSide`               | **4**                       | The platform's first 4v4 tag game, and the reason engine v0.7.0 exists — the field was typed `1 \| 2 \| 3`. It describes the FORMAT and drives UI affordances; it is **not** a length cap.                               |
| `filters.coOccurrence`            | **false**                   | At 4 per side a team yields C(4,2) = 6 pairs against a duo's 1 — combinatorially a different feature, not a bigger one. `pairingUsage` is not emitted, and every engine duo panel self-hides on an empty pair set.       |
| `filters.rank`                    | **unset**                   | The game has a ranked mode, but no source states a ladder tier. What titles carry — `(#2 Ranked Danger)` — is a per-character leaderboard POSITION, which the parser strips. Turning the facet on would render it empty. |
| `terms` / `characterRouteSegment` | fighter / team / `fighters` | The design spec's nav reads **Fighters**, its chip reads `fighter: storm`, its stats heading reads **Fighter usage**, and a side here is a **team**.                                                                     |
| `sourceGroups`                    | **unset**                   | All five channels are online replay re-uploaders. One "Online" group would collapse five chips into one that toggles everything. The Online/Tournament split arrives when a tournament channel does.                     |

## The stat unit — side appearances

**Every character on a side counts once for that side.** A fighter appearing on
both sides of a replay adds 2; a saturated 4v4 record contributes 8. The same
denominator drives `characterUsage`, `byPatchUsage` and `playerCharacters`,
which is what makes the usage bars, the meta timeline and the player tables
agree.

The engine offers a genuine choice here (`types/stats.ts`): a 1v1 game counts
side appearances, and a tag game on a shared roster may instead count a
per-record deduped union. Tōkon takes **side appearances**, because the question
this archive answers is _how often was this fighter fielded_, not _how many
replays feature them_ — and with 21 fighters in 4 slots, side overlap is common
enough that de-duplicating would quietly erase half of the real fieldings.

`scripts/emit.ts` asserts `Σ characterUsage === Σ side.characters.length`.
**That is not `records × 8`,** and nobody should "fix" it to be: sides here are
genuinely 1..4 long while the bench fills in, and a mid-set team change makes
one longer still.

## Characters come from three tiers

Titles do not state a full team. Measured on the launch corpus:

| tier        | sides | what it gives                                            |
| ----------- | ----: | -------------------------------------------------------- |
| title       |   220 | 1–2 of 4 — the point fighter, sometimes a second         |
| description |    86 | the full four-per-side bench, where a channel writes one |
| footage     |     0 | closes the rest (extraction track, local-only)           |
| review      |     0 | a hand verdict, which beats everything                   |

Every side records **provenance** — the contributing tiers, how the description
was aligned, which title slot order it used, and whether the tiers disagreed.
That lives on the substrate (`data/videos.json`) and is asserted _never_ to
reach `data/replays.json`: the rich pipeline record projects down to the narrow
public contract, which is the boundary that keeps the engine generic.

Bench alignment is by **handle correspondence first, character containment
second, and refusal third** — never positional. One channel reverses its second
title slot, so assuming the description follows title order would compound one
error with another and produce a confidently mislabelled record.

## Five title grammars, one parser

```
a  Marvel Tokon ▰ HANDLE (Chars) vs HANDLE (Chars) ▰ Pro level replays
b  TOKON ▰ HANDLE (Chars) vs (Chars) HANDLE 👊【MARVEL TŌKON: Fighting Souls】   ← side 2 reversed
c  HANDLE (Char) vs HANDLE (Char) ▰ MARVEL TOKON: High Level Gameplay          ← ▰ as SUFFIX only
d  …the same with two chars per side, slash-separated
e  Char vs Char ▰ High Level Gameplay ▰ Handle vs Handle ▰ Marvel Tokon…       ← parallel lists
```

In (a)–(d) the characters are inside the parentheses and the handle is the rest
of the side, so the parser never _chooses_ a slot order — it takes the paren
wherever it sits and records the order as telemetry. The `▰` affixes are cut
relative to the sides rather than by counting `▰`, which is what makes (c) work
with no special case.

(e) is different and was found because it was **wrong**, not missing: those
titles satisfy the paren parser's outer shape and produced records whose player
handles were fighter names. `scripts/e2e.ts` now asserts that no player handle
is a fighter name.

Characters are extracted as **spans, never by splitting on a separator**. A
split on `[/-]` shreds `Spider-Man`, `Star-Lord` and `Ms. Marvel`; ten of the
21 fighters are multi-word or punctuated, so that is the common case. Whatever
text no span covered is reported as **residue** — that is how `G.Rider` was
found.

## The roster is 21

Twenty announced fighters in five teams, plus **Champion** — a hidden unlockable
(clear Episode chapter 11) who is fully playable online and is the 7th
most-used fighter in the launch corpus. No Sony/Marvel/ASW page announces him;
publisher-authored achievement strings confirm he exists. Shipping the announced
20 would have hard-failed ~15% of the archive on every run.

His accent was derived by the design handoff's own 4-step method, shipped
flagged, and has since been **confirmed by a design session at the same hex**
(`#EC51C9`). Every accent comes from `design/handoff/tokens.css`, and **a roster
id with no token fails `scripts/characters.ts` loud** rather than shipping an
unstyled fighter.

## Patches are dates, because the vendor publishes no version

Arc System Works and Sony ship date-titled posts on the Steam news hub —
`Patch Update 8/10/2026` — and nothing else: no semver, no build id, no
update-history page. The one version-shaped number in circulation (`1.002.002`)
is a press report of a PS5 system build, never vendor-published, and is
deliberately unused.

So the patch token **is** the vendor's own publication date, ISO-normalised, and
every row records where it was announced (`announcedOn`) so an undocumented row
is visible rather than merely plausible. `npm run data:patch-check` diffs the
table against the live feed.

## The self-expiring gates

Three severities, and the difference between them is the design:

| where                     | behaviour                                                                     |
| ------------------------- | ----------------------------------------------------------------------------- |
| `scripts/characters.ts`   | **exits 1** — blocks the roster work that is due                              |
| `scripts/parse.ts`        | **never exits**; writes `## ⚠ ACTION REQUIRED` to the top of `data/report.md` |
| the workflow's final step | **exits 1**, _after_ the data is committed and pushed                         |

A hard exit in `parse.ts` would stop the daily refresh entirely, which is
strictly worse than the misfiling it warns about. **The red workflow and the
`exit 1` are the design, not a bug** — clear them by doing the work, never by
deleting the check.

Two things can trip them: a Year-1 character's announced window opening
(`phoenix-cyclops`, 2026-10-01) and the patch table going 21 days stale on a
vendor that shipped twice in its first five days.

## Scripts

| command                     | what it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `npm run data:fetch`        | every upload from the five channels → `raw/`, plus a recon report        |
| `npm run data:parse`        | gate, parse, bench, merge, emit — the daily path                         |
| `npm run data:build`        | fetch + parse                                                            |
| `npm run data:emit`         | re-emit the engine artifacts from the substrate                          |
| `npm run data:characters`   | rebuild the roster (accents from the design tokens; fails loud on a gap) |
| `npm run data:art`          | scrape character art from the Marvel Database manifest                   |
| `npm run data:art-tile`     | generate the comic-register fallback tile / cutout ground                |
| `npm run data:og`           | regenerate `public/og-default.png`                                       |
| `npm run data:patch-check`  | diff the patch table against the vendor's news feed                      |
| `npm run data:expiries`     | the self-expiring gates (`--check`)                                      |
| `npm run data:replay-dupes` | cross-channel duplicate audit — report-only, never drops                 |
| `npm run verify:gates`      | positive-control every gate                                              |
| `npm run test:e2e`          | the audit suite (needs `npm run generate` first)                         |
| `npm run verify:deployed`   | post-deploy smoke check against production                               |

## Daily data refresh

`47 7 * * *` — the fourth stagger slot, after 2XKO 06:17, Tekken 06:47 and
SF6 07:17. Needs `YT_API_KEY` as a repo secret.

A day with no new videos produces **no commit and no deploy**: the guard drops
`data/report.md` when its only diff is the `_Generated_` timestamp. That means
the commit trail _undercounts_ green cycles — check the Actions tab, not the
log.

Extraction never runs here. YouTube blocks datacenter IPs, so the footage tier
is local-only and the cron carries committed overrides forward.

## Things worth knowing

- **`app/assets/theme.css` must stay a plain unlayered `:root` block, never
  `@theme`.** An app stylesheet does not pass through the engine's Tailwind root
  compile, so `@theme` ships raw, the browser drops it, and production silently
  wears the umbrella defaults. `nuxt dev` masks it exactly.
- **`@fontsource` import specifiers are extensionless.**
- **Both Bangers subsets are required.** `latin` draws the wordmark, `latin-ext`
  draws the **Ō**. Loading one is not partial success: with latin-ext alone
  every ASCII letter falls back to a serif. And `document.fonts.check()` will
  tell you everything is fine — it returns true for a family whose declared
  `unicode-range` does not cover the text. Assert per subset, against a family
  that cannot exist.
- **The design tokens are the source of truth for accents.**
  `scripts/characters.ts` and `app/app.config.ts` read the same `--char-*`
  block, so they cannot drift.
- **The collapse guard is asleep at this corpus size.** `>10% AND >20 records`
  cannot fire for a channel holding 20 or fewer, and four of the five are under 40. Both thresholds are still correct; `verify:deployed` and the freeze pin
  are the live protection until it wakes.

## Vercel

Static (`npm run generate`), `app.baseURL` defaults to `/tokon/` — an env
expression, never a literal, or the prerender seeds and the router disagree and
every route 404s the build. `observability.insights: '/tokon-insights'` is
paired 1:1 with the shell's rewrite; the two ship together or every beacon 404s
silently.
