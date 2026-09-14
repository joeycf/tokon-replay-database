# Tōkon pipeline report

## ⚠ ACTION REQUIRED

1 self-expiring gate(s) are due:

- **patch-table** (stale-patch-table, due 2026-08-28)
  The newest patch in scripts/patches.ts is 2026-08-28, 17 days old. Run `npm run data:patch-check` against the vendor's news feed. If a patch shipped and is not in the table, every replay since is filed under the previous token — silently wrong. If genuinely nothing shipped, that is fine: this warning costs one command.

_Generated 2026-09-14T23:09:02.735Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 188 | 188 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 814 | 117 | 14.4% |
| replaysHub | 238 | 233 | 97.9% |
| fightingStationX | 2840 | 187 | 6.6% |
| fgcReplaysHub | 2648 | 40 | 1.5% |
| marvelTokonYT _(events only)_ | 45 | 11 | 24.4% |
| replayTheater _(carried)_ | — | 85 | — |
| **total** | | **874** | |

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
_The cursor did not move: the catalogue has taken no new Tōkon entry since_
_the last pull — quieter still, and equally ordinary._

_Entries skipped as already-known: **0** — this pull carried no tagged rows to check._

## Character provenance

How every one of the 1748 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 214 | 12.2% |
| description | 465 | 26.6% |
| index | 170 | 9.7% |
| footage | 279 | 16.0% |
| human | 596 | 34.1% |
| review | 24 | 1.4% |

- complete (4/4): **1321/1748** (75.6%)
- oversize (>4, mid-set team change): **8** — counted in usage, excluded from pairing
- bench alignment: handle 442 · character-subset 27 · ambiguous 4
- title slot order: handle-first 1267 · chars-first 115 · parallel-lists 174
- tier conflicts (queued for review): 1
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 280 | 16.0% |
| 2 | 79 | 4.5% |
| 3 | 68 | 3.9% |
| 4 | 1313 | 75.1% |
| 5 _(mid-set change)_ | 6 | 0.3% |
| 6 _(mid-set change)_ | 1 | 0.1% |
| 7 _(mid-set change)_ | 1 | 0.1% |

- **427 side(s) awaiting a drain** across 244 record(s) — oldest published **29 day(s)** ago

> The bench queue is at 244 (nudge threshold 40).
> Run `npm run data:catchup` locally — the cron cannot do this: extraction
> needs a logged-in YouTube session from a residential address.

## Queues

- review queue (never published): **3** — character-completion 2 · bench-conflict 1
- bench queue (published, incomplete): **244**

## Player identity

13 identity(s) resolved from more than one spelling. The
retired ids are 301-redirected from vercel.json — run `npm run data:redirects`
after changing scripts/players.ts, or the old URLs 404.

| canonical | absorbed |
| --- | --- |
| `balderberg` | `balder-berg` |
| `blueskyguy` | `blue-sky-guy` |
| `boymanguy` | `boy-man-guy` |
| `chrisg` | `chris-g` |
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
| other-game | 4029 |
| not-tokon | 1095 |
| pre-launch | 663 |
| not-a-match | 141 |
| not-an-event | 34 |
| short-duration | 27 |
| char-unresolved | 14 |
| no-vs-title | 6 |
| bench-conflict | 1 |

- `marvelTokonYT` events-only gate: **34** upload(s) carried no known event brand.
  - MARVEL Tokon ▰ Moku (Magneto) vs Skinoff (Captain America) - High Level Match
  - UNOKOA'S INSANE DUO | Loki & Blade | Marvel Tokon
  - MARVEL Tokon ▰ Bleed - INSANE DUO Black Panther x Storm ▰ High Level Match
  - MARVEL Tokon ▰ MrChupy Demoniac CARNAGE ▰ High Level Match
  - MARVEL Tokon ▰ ImnoDeag (Spider-Man) vs Nieve (Champion) ▰ High Level Match
  - …and 29 more

## Unmatched text in character slots

Text no roster alias covered. A new fighter, a new nickname, or a typo —

| text | count | example |
| --- | ---: | --- |
| `Raked` | 1 | f_RPQ0HmHXE |

## Handles that resemble the game name

Handles matching `/t[ōo]kon|marvel/i`. The parser read the slot correctly —
the uploader put this in the handle position. Listed so a placeholder or a
garbled game name gets a human verdict instead of a quiet player page.

| handle | records | example |
| --- | ---: | --- |
| `TOKON PLAYER` | 5 | A5I1zx7zStM |
| `TOKON` | 4 | 4AIZDJ4nvSE |
| `The Tokon Texan` | 2 | 26SqJz0Xlpo |
| `JUGADOR TOKON` | 1 | AXxi2TgiEQM |
| `TOKON DEEZ` | 1 | R8ixtuzZlY4 |
| `marvel chokon` | 1 | 8Y6fDQNgFPk |
| `TOKON J` | 1 | 5yZnENL-6sM |
| `Marvel Games` | 1 | KbA1UgtZFO0 |

