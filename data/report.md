# Tōkon pipeline report

## ⚠ ACTION REQUIRED

1 self-expiring gate(s) are due:

- **phoenix-cyclops** (unreleased-character, due 2026-10-01)
  phoenix-cyclops should now be playable. If it is: add --char-phoenix-cyclops to design/handoff/tokens.css (the handoff already derived #FF9D57 — contrast ≥4.5:1 on --color-surface and a hue ≥8–12° off its roster neighbours), add the same hex to accents in app/app.config.ts, add the fighter to ROSTER in scripts/characters.ts, drop this entry from UNRELEASED, then run `npm run data:characters` and `npm run data:art`. If it has NOT shipped, re-date this row to the new window — do not delete it.

_Generated 2026-10-01T14:47:36.045Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 253 | 253 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 844 | 146 | 17.3% |
| replaysHub | 338 | 332 | 98.2% |
| fightingStationX | 2993 | 224 | 7.5% |
| fgcReplaysHub | 2718 | 41 | 1.5% |
| marvelTokonYT _(events only)_ | 46 | 11 | 23.9% |
| replayTheater _(carried)_ | — | 85 | — |
| **total** | | **1105** | |

## Index intakes

Fetched by the daily cron since 2026-09-02, and ADD-ONLY: a committed record is
carried whether or not the catalogue still lists it, so this count can only rise.
The cron does not depend on the pull succeeding — on any failure there is no dump,
the committed records are carried, and the run stays green.

| intake | records | pin | this run | pages | new | not in this pull |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| `replayTheater` | 85 | 85 | carried (pull found no new tournament entries) | — | — | — |

_The pull ran and found no new tournament entries, so the committed catalogue_
_was carried unchanged._
_The cursor still advanced — a quiet day is the ordinary case here, not a_
_failed one._

_Entries skipped as already-known: **0** — this pull carried no tagged rows to check._

## Character provenance

How every one of the 2210 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 28 | 1.3% |
| description | 594 | 26.9% |
| index | 170 | 7.7% |
| footage | 123 | 5.6% |
| human | 1268 | 57.4% |
| review | 27 | 1.2% |

- complete (4/4): **2172/2210** (98.3%)
- oversize (>4, mid-set team change): **10** — counted in usage, excluded from pairing
- bench alignment: handle 601 · character-subset 31 · ambiguous 5
- title slot order: handle-first 1623 · chars-first 143 · parallel-lists 244
- tier conflicts (queued for review): 1
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 32 | 1.4% |
| 2 | 2 | 0.1% |
| 3 | 4 | 0.2% |
| 4 | 2162 | 97.8% |
| 5 _(mid-set change)_ | 7 | 0.3% |
| 6 _(mid-set change)_ | 2 | 0.1% |
| 7 _(mid-set change)_ | 1 | 0.0% |

- **38 side(s) awaiting a drain** across 20 record(s) — oldest published **2 day(s)** ago

## Queues

- review queue (never published): **1** — character-completion 1
- bench queue (published, incomplete): **20**

## Player identity

14 identity(s) resolved from more than one spelling. The
retired ids are 301-redirected from vercel.json — run `npm run data:redirects`
after changing scripts/players.ts, or the old URLs 404.

| canonical | absorbed |
| --- | --- |
| `blueskyguy` | `blue-sky-guy` |
| `boymanguy` | `boy-man-guy` |
| `d-a-c` | `dac` |
| `ghost-of-evo` | `ghostofevo` |
| `hulk-mash` | `hulkmash` |
| `jaazzrap` | `jaazz-rap` |
| `kingafrica` | `king-africa` |
| `kingcreed` | `king-creed` |
| `mr-marben` | `mrmarben` |
| `mrchupy` | `mr-chupy` |
| `nychrisg` | `nychris-g` |
| `sonicfox` | `sonic-fox` |
| `tokon-player` | `to-kon-player` |
| `vivid-aspiration` | `vividaspiration` |

## Replay Theater cross-check

An independent reading of **120** of our own records, from the catalogue's
UNTAGGED entries — online replays it indexes that we also parse from a tracked
channel. Neither side saw the other, so this is the only accuracy number on this
page the pipeline did not produce about itself. It changes nothing: a disagreement
is recorded in data/theater-disagreements.json with both claims and is never
written into a record. The catalogue does not outrank a confident parse and never
outranks a human override.

_Measured on the last full sweep, at catalogue entry 488423. 107 catalogue video(s) point at videos_
_we do not hold; 0 are VODs the catalogue segments, which the index intake owns._

| field | population | agree | partial | disagree | cannot witness |
| --- | ---: | ---: | ---: | ---: | ---: |
| players (both handles) | 120 | 120 (100.00%) | 0 | 0 | — |
| fighters (per side) | 240 | 239 (99.58%) | 0 | 0 (0.00%) | 1 |

**Cannot witness** is not disagreement. The catalogue holds four character columns
a side; a side of ours that is longer — a mid-set team change — is something it
could not have said, and a catalogue string no roster alias covers is a witness we
decline to read rather than guess at. Both are counted here and neither is scored
against the parser.

Side order differed on **3** record(s); the comparison realigns on the
handles before reading fighters, so a swapped pair is not scored as a character
disagreement — which, at two sides a record, would have been 6 here.

No disagreements on that sweep.

## Misses

| reason | count |
| --- | ---: |
| other-game | 4109 |
| not-tokon | 1129 |
| pre-launch | 663 |
| not-a-match | 201 |
| short-duration | 42 |
| not-an-event | 35 |
| char-unresolved | 20 |
| no-vs-title | 6 |

- `marvelTokonYT` events-only gate: **35** upload(s) carried no known event brand.
  - MARVEL Tokon ▰ Save The Queen (Magik) vs FilipinoChamp (Black Phanter) High Level Match
  - MARVEL Tokon ▰ Moku (Magneto) vs Skinoff (Captain America) - High Level Match
  - UNOKOA'S INSANE DUO | Loki & Blade | Marvel Tokon
  - MARVEL Tokon ▰ Bleed - INSANE DUO Black Panther x Storm ▰ High Level Match
  - MARVEL Tokon ▰ MrChupy Demoniac CARNAGE ▰ High Level Match
  - …and 30 more

## Unmatched text in character slots

Text no roster alias covered. A new fighter, a new nickname, or a typo —

| text | count | example |
| --- | ---: | --- |
| `GreenGoblin` | 1 | gy5Cd9rpbng |
| `Raked` | 1 | f_RPQ0HmHXE |

## Handles that resemble the game name

Handles matching `/t[ōo]kon|marvel/i`. The parser read the slot correctly —
the uploader put this in the handle position. Listed so a placeholder or a
garbled game name gets a human verdict instead of a quiet player page.

| handle | records | example |
| --- | ---: | --- |
| `TOKON` | 6 | SHC4DyMK5ck |
| `TOKON PLAYER` | 6 | 9G-yCsKqlDI |
| `The Tokon Texan` | 2 | 26SqJz0Xlpo |
| `JOHN TOKON` | 1 | cfEGCQ02hmQ |
| `Marvel larper` | 1 | Z1uK06owFng |
| `JUGADOR TOKON` | 1 | AXxi2TgiEQM |
| `TOKON DEEZ` | 1 | R8ixtuzZlY4 |
| `marvel chokon` | 1 | 8Y6fDQNgFPk |
| `TOKON J` | 1 | 5yZnENL-6sM |
| `Marvel Games` | 1 | KbA1UgtZFO0 |

