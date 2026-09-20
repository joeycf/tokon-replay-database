# Tōkon pipeline report

_Generated 2026-09-20T12:38:23.237Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 211 | 211 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 824 | 127 | 15.4% |
| replaysHub | 271 | 265 | 97.8% |
| fightingStationX | 2890 | 210 | 7.3% |
| fgcReplaysHub | 2669 | 40 | 1.5% |
| marvelTokonYT _(events only)_ | 46 | 11 | 23.9% |
| replayTheater _(carried)_ | — | 85 | — |
| **total** | | **962** | |

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

How every one of the 1924 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 266 | 13.8% |
| description | 509 | 26.5% |
| index | 170 | 8.8% |
| footage | 273 | 14.2% |
| human | 682 | 35.4% |
| review | 24 | 1.2% |

- complete (4/4): **1458/1924** (75.8%)
- oversize (>4, mid-set team change): **8** — counted in usage, excluded from pairing
- bench alignment: handle 494 · character-subset 29 · ambiguous 5
- title slot order: handle-first 1387 · chars-first 125 · parallel-lists 220
- tier conflicts (queued for review): 1
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 314 | 16.3% |
| 2 | 86 | 4.5% |
| 3 | 66 | 3.4% |
| 4 | 1450 | 75.4% |
| 5 _(mid-set change)_ | 6 | 0.3% |
| 6 _(mid-set change)_ | 1 | 0.1% |
| 7 _(mid-set change)_ | 1 | 0.1% |

- **466 side(s) awaiting a drain** across 268 record(s) — oldest published **35 day(s)** ago

> The bench queue is at 268 (nudge threshold 40).
> Run `npm run data:catchup` locally — the cron cannot do this: extraction
> needs a logged-in YouTube session from a residential address.

## Queues

- review queue (never published): **4** — character-completion 3 · bench-conflict 1
- bench queue (published, incomplete): **268**

## Player identity

15 identity(s) resolved from more than one spelling. The
retired ids are 301-redirected from vercel.json — run `npm run data:redirects`
after changing scripts/players.ts, or the old URLs 404.

| canonical | absorbed |
| --- | --- |
| `balderberg` | `balder-berg` |
| `blueskyguy` | `blue-sky-guy` |
| `boymanguy` | `boy-man-guy` |
| `caddyluke` | `caddy-luke` |
| `chrisg` | `chris-g` |
| `ghost-of-evo` | `ghostofevo` |
| `hulk-mash` | `hulkmash` |
| `jaazzrap` | `jaazz-rap` |
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
| other-game | 4050 |
| not-tokon | 1098 |
| pre-launch | 663 |
| not-a-match | 157 |
| short-duration | 35 |
| not-an-event | 35 |
| char-unresolved | 15 |
| no-vs-title | 6 |
| bench-conflict | 1 |

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

