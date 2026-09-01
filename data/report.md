# Tōkon pipeline report

## ⚠ ACTION REQUIRED

1 self-expiring gate(s) are due:

- **patch-table** (stale-patch-table, due 2026-08-10)
  The newest patch in scripts/patches.ts is 2026-08-10, 22 days old. Run `npm run data:patch-check` against the vendor's news feed. If a patch shipped and is not in the table, every replay since is filed under the previous token — silently wrong. If genuinely nothing shipped, that is fine: this warning costs one command.

_Generated 2026-09-01T23:23:10.957Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 112 | 112 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 776 | 80 | 10.3% |
| replaysHub | 146 | 142 | 97.3% |
| fightingStationX | 2712 | 109 | 4.0% |
| fgcReplaysHub | 2572 | 29 | 1.1% |
| marvelTokonYT _(events only)_ | 41 | 11 | 26.8% |
| replayTheater _(index)_ | 44 | 44 | 100.0% |
| **total** | | **540** | |

## Index intakes

Fetched by the daily cron since 2026-08-31, and ADD-ONLY: a committed record is
carried whether or not the catalogue still lists it, so this count can only rise.
The cron does not depend on the pull succeeding — on any failure there is no dump,
the committed records are carried, and the run stays green.

| intake | records | pin | this run | pages | new | not in this pull |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| `replayTheater` | 44 | 44 | rebuilt from a full sweep | 6 | 44 | 0 |

Entries **collapsed as double-submitted**: **0** of 44 tagged. The same match submitted twice under two tag spellings; one copy kept, chosen on the tag so the survivor does not depend on submission order.

_Entries skipped as already-known: **0**. The catalogue indexes no video this repo has fetched, published or ruled on._

## Character provenance

How every one of the 1080 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 124 | 11.5% |
| description | 293 | 27.1% |
| index | 88 | 8.1% |
| footage | 32 | 3.0% |
| human | 519 | 48.1% |
| review | 24 | 2.2% |

- complete (4/4): **956/1080** (88.5%)
- oversize (>4, mid-set team change): **7** — counted in usage, excluded from pairing
- bench alignment: handle 270 · character-subset 22 · ambiguous 4
- title slot order: handle-first 812 · chars-first 78 · parallel-lists 80
- tier conflicts (queued for review): 1
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 124 | 11.5% |
| 4 | 949 | 87.9% |
| 5 _(mid-set change)_ | 6 | 0.6% |
| 6 _(mid-set change)_ | 1 | 0.1% |

- **124 side(s) awaiting a drain** across 62 record(s) — oldest published **16 day(s)** ago

> The bench queue is at 62 (nudge threshold 40).
> Run `npm run data:catchup` locally — the cron cannot do this: extraction
> needs a logged-in YouTube session from a residential address.

## Queues

- review queue (never published): **4** — character-completion 3 · bench-conflict 1
- bench queue (published, incomplete): **62**

## Player identity

11 identity(s) resolved from more than one spelling. The
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
| `mrmarben` | `mr-marben` |
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
handles before reading fighters, so a swapped pair is not counted twice — here,
eight times — as a character disagreement.

No disagreements on that sweep.

## Misses

| reason | count |
| --- | ---: |
| other-game | 3963 |
| not-tokon | 1090 |
| pre-launch | 663 |
| not-a-match | 117 |
| not-an-event | 30 |
| char-unresolved | 15 |
| short-duration | 6 |
| no-vs-title | 4 |
| bench-conflict | 1 |

- `marvelTokonYT` events-only gate: **30** upload(s) carried no known event brand.
  - MARVEL Tokon ▰ ImnoDeag (Spider-Man) vs Nieve (Champion) ▰ High Level Match
  - MARVEL Tokon ▰ ChrisG (Black Panther) vs Snake Eyes (Champion) ▰ High Level Match
  - MARVEL Tokon ▰ Naire (Spider-Man) vs Roda (Wolverine) ▰ High Level Match
  - MARVEL Tokon ▰ Harampool Crazy DEADPOOL ▰ High Level Match
  - MARVEL Tokon ▰ HaramPool (#1 Deadpool) vs Opal (Magik) ▰ High Level Match
  - …and 25 more

## Unmatched text in character slots

Text no roster alias covered. A new fighter, a new nickname, or a typo —

| text | count | example |
| --- | ---: | --- |
| `P.Parker` | 2 | cAjt5HIKDyI |
| `C.America` | 1 | RAsu7I_i-fk |
| `B.Panther` | 1 | -KobHCx2Pvc |
| `Raked` | 1 | f_RPQ0HmHXE |

## Handles that resemble the game name

Handles matching `/t[ōo]kon|marvel/i`. The parser read the slot correctly —
the uploader put this in the handle position. Listed so a placeholder or a
garbled game name gets a human verdict instead of a quiet player page.

| handle | records | example |
| --- | ---: | --- |
| `TOKON` | 4 | 4AIZDJ4nvSE |
| `TOKON PLAYER` | 3 | bNSKCKQXuSo |
| `JUGADOR TOKON` | 1 | AXxi2TgiEQM |
| `TOKON DEEZ` | 1 | R8ixtuzZlY4 |
| `marvel chokon` | 1 | 8Y6fDQNgFPk |
| `TOKON J` | 1 | 5yZnENL-6sM |
| `Marvel Games` | 1 | KbA1UgtZFO0 |

