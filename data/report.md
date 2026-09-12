# Tōkon pipeline report

## ⚠ ACTION REQUIRED

1 self-expiring gate(s) are due:

- **patch-table** (stale-patch-table, due 2026-08-28)
  The newest patch in scripts/patches.ts is 2026-08-28, 15 days old. Run `npm run data:patch-check` against the vendor's news feed. If a patch shipped and is not in the table, every replay since is filed under the previous token — silently wrong. If genuinely nothing shipped, that is fine: this warning costs one command.

_Generated 2026-09-12T11:44:49.493Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 175 | 175 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 808 | 111 | 13.7% |
| replaysHub | 223 | 219 | 98.2% |
| fightingStationX | 2817 | 174 | 6.2% |
| fgcReplaysHub | 2642 | 40 | 1.5% |
| marvelTokonYT _(events only)_ | 45 | 11 | 24.4% |
| replayTheater _(index)_ | 16 | 85 | — |
| **total** | | **828** | |

## Index intakes

Fetched by the daily cron since 2026-09-02, and ADD-ONLY: a committed record is
carried whether or not the catalogue still lists it, so this count can only rise.
The cron does not depend on the pull succeeding — on any failure there is no dump,
the committed records are carried, and the run stays green.

| intake | records | pin | this run | pages | new | not in this pull |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| `replayTheater` | 85 | 85 | rebuilt from a cursor delta | — | — | — |

Entries **collapsed as double-submitted**: **0** of 16 tagged. The same match submitted twice under two tag spellings; one copy kept, chosen on the tag so the survivor does not depend on submission order.

_Entries skipped as already-known: **0** of 16 in this pull — none was a video this repo has already fetched, published or ruled on. A statement about this pull's tagged rows, not the catalogue: the cross-check below measures the catalogue-wide overlap._

## Character provenance

How every one of the 1656 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 472 | 28.5% |
| description | 439 | 26.5% |
| index | 170 | 10.3% |
| footage | 32 | 1.9% |
| human | 519 | 31.3% |
| review | 24 | 1.4% |

- complete (4/4): **1184/1656** (71.5%)
- oversize (>4, mid-set team change): **7** — counted in usage, excluded from pairing
- bench alignment: handle 417 · character-subset 26 · ambiguous 3
- title slot order: handle-first 1207 · chars-first 109 · parallel-lists 148
- tier conflicts (queued for review): 1
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 470 | 28.4% |
| 2 | 2 | 0.1% |
| 4 | 1177 | 71.1% |
| 5 _(mid-set change)_ | 6 | 0.4% |
| 6 _(mid-set change)_ | 1 | 0.1% |

- **472 side(s) awaiting a drain** across 236 record(s) — oldest published **27 day(s)** ago

> The bench queue is at 236 (nudge threshold 40).
> Run `npm run data:catchup` locally — the cron cannot do this: extraction
> needs a logged-in YouTube session from a residential address.

## Queues

- review queue (never published): **3** — character-completion 2 · bench-conflict 1
- bench queue (published, incomplete): **236**

## Player identity

17 identity(s) resolved from more than one spelling. The
retired ids are 301-redirected from vercel.json — run `npm run data:redirects`
after changing scripts/players.ts, or the old URLs 404.

| canonical | absorbed |
| --- | --- |
| `balderberg` | `balder-berg` |
| `blueskyguy` | `blue-sky-guy` |
| `boymanguy` | `boy-man-guy` |
| `chrisg` | `chris-g` |
| `gurihiru-fan` | `gurihi-ru-fan` |
| `hulk-mash` | `hulkmash` |
| `jaazzrap` | `jaazz-rap` |
| `kingcreed` | `king-creed` |
| `majin-burno` | `majinburno` |
| `mr-marben` | `mrmarben` |
| `mrchupy` | `mr-chupy` |
| `nychrisg` | `nychris-g` |
| `omegahilip` | `omega-hilip` |
| `sonicfox` | `sonic-fox` |
| `tokon-player` | `to-kon-player` |
| `vivid-aspiration` | `vividaspiration` |
| `wolverlean` | `wolver-lean` |

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
| other-game | 4023 |
| not-tokon | 1092 |
| pre-launch | 663 |
| not-a-match | 138 |
| not-an-event | 34 |
| short-duration | 23 |
| char-unresolved | 14 |
| no-vs-title | 5 |
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

