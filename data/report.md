# Tōkon pipeline report

_Generated 2026-11-22T17:37:48.553Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 368 | 368 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 898 | 199 | 22.2% |
| replaysHub | 597 | 588 | 98.5% |
| fightingStationX | 3593 | 224 | 6.2% |
| fgcReplaysHub | 2929 | 41 | 1.4% |
| marvelTokonYT _(events only)_ | 46 | 11 | 23.9% |
| replayTheater _(carried)_ | — | 92 | — |
| **total** | | **1536** | |

## Index intakes

Fetched by the daily cron since 2026-09-02, and ADD-ONLY: a committed record is
carried whether or not the catalogue still lists it, so this count can only rise.
The cron does not depend on the pull succeeding — on any failure there is no dump,
the committed records are carried, and the run stays green.

| intake | records | pin | this run | pages | new | not in this pull |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| `replayTheater` | 92 | 92 | carried (pull found no new tournament entries) | — | — | — |

_The pull ran and found no new tournament entries, so the committed catalogue_
_was carried unchanged._
_The cursor did not move: the catalogue has taken no new Tōkon entry since_
_the last pull — quieter still, and equally ordinary._

_Entries skipped as already-known: **0** — this pull carried no tagged rows to check._

## Character provenance

How every one of the 3072 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 2 | 0.1% |
| description | 824 | 26.8% |
| index | 184 | 6.0% |
| footage | 203 | 6.6% |
| human | 1828 | 59.5% |
| review | 31 | 1.0% |

- complete (4/4): **3055/3072** (99.4%)
- oversize (>4, mid-set team change): **13** — counted in usage, excluded from pairing
- bench alignment: character-subset 40 · handle 956 · ambiguous 10
- title slot order: handle-first 2414 · chars-first 196 · parallel-lists 244
- tier conflicts (queued for review): 1
- title refutations (a person ruled the title wrong): **13** side(s) — named, with their evidence, by `npm run test:e2e`
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 6 | 0.2% |
| 2 | 4 | 0.1% |
| 3 | 7 | 0.2% |
| 4 | 3042 | 99.0% |
| 5 _(mid-set change)_ | 10 | 0.3% |
| 6 _(mid-set change)_ | 2 | 0.1% |
| 7 _(mid-set change)_ | 1 | 0.0% |

- **17 side(s) awaiting a drain** across 10 record(s) — oldest published **1 day(s)** ago

## Queues

- review queue (never published): **1** — character-completion 1
- bench queue (published, incomplete): **10**

## Player identity

20 identity(s) resolved from more than one spelling. The
retired ids are 301-redirected from vercel.json — run `npm run data:redirects`
after changing scripts/players.ts, or the old URLs 404.

| canonical | absorbed |
| --- | --- |
| `ajaxfidelity` | `ajax-fidelity` |
| `blueskyguy` | `blue-sky-guy` |
| `boymanguy` | `boy-man-guy` |
| `dragon-von-doom` | `dragonvondoom` |
| `ghost-of-evo` | `ghostofevo` |
| `gotham-paladin` | `gothampaladin` |
| `hulk-mash` | `hulkmash` |
| `jaazzrap` | `jaazz-rap` |
| `jonnie-a` | `jonniea` |
| `kingcreed` | `king-creed` |
| `mr-marben` | `mrmarben` |
| `mrchupy` | `mr-chupy` |
| `nychrisg` | `nychris-g` |
| `poppyjan` | `poppy-jan` |
| `ray-monkey` | `raymonkey` |
| `sasukedavid` | `sasuke-david` |
| `sonicfox` | `sonic-fox` |
| `tiempogris` | `tiempo-gris` |
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

## Tournament placements — Liquipedia Tier 1–2, CC BY-SA 3.0

No data/tournaments.json — Tōkon has no Liquipedia page yet (scripts/tournaments.ts `LIQUIPEDIA_GAME` is null). The day one appears, set the constant and run `npm run data:tournaments` (manual, network) to pull its winner and runner-up tables.

## Misses

| reason | count |
| --- | ---: |
| other-game | 4406 |
| not-tokon | 1496 |
| pre-launch | 663 |
| not-a-match | 286 |
| short-duration | 87 |
| not-an-event | 35 |
| char-unresolved | 22 |
| no-vs-title | 13 |
| no-handle | 13 |
| bad-handle | 1 |

- `no-handle` (checklist 5r): **13** title(s) with no fighter slot and a side that is only fighter names. No person to recover, so refused rather than queued.
  - Phoenix Cyclops vs Wolverine ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` 8FenYyfKZ0I)
  - Phoenix Cyclops vs Storm ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` Tdt8UaRFUak)
  - Phoenix Cyclops vs Deadpool ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` 1Q-5_a8fD3I)
  - Peni Parker vs Phoenix Cyclops ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` yqlVwzWNk4o)
  - Black Panther vs Phoenix Cyclops ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` ZIZAH2velJI)
  - Phoenix Cyclops vs Spider-Man ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` 24kwOWehdNo)
  - Carnage vs Phoenix Cyclops ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` R7L7m1RFQjI)
  - Blade vs Phoenix Cyclops ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` ygJROv87bHE)
  - Star-Lord vs Phoenix Cyclops ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` gRTj42xOWKU)
  - Phoenix Cyclops vs Phoenix Cyclops  ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` 8kddhKdYxEI)
  - Magik vs Phoenix Cyclops ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` 3hYWzU_KtMA)
  - Loki vs Phoenix Cyclops ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` LGZF9PzD2Pk)
  - Phoenix Cyclops vs Phoenix Cyclops ▰ Online Match ▰ Marvel Tokon Fighting Souls  (`fightingStationX` UrW3VESB8ig)

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
| `Raked` | 2 | 8YIAqBNiMhU |
| `D.` | 1 | WeItyxM6nxg |
| `B.Penther` | 1 | tKpnZ4wyuPg |
| `Paker` | 1 | lvIsJvSRS5o |
| `SipderMan` | 1 | 7Muj4Ha1FyI |
| `GreenGoblin` | 1 | gy5Cd9rpbng |

## Handles that resemble the game name

Handles matching `/t[ōo]kon|marvel/i`. The parser read the slot correctly —
the uploader put this in the handle position. Listed so a placeholder or a
garbled game name gets a human verdict instead of a quiet player page.

| handle | records | example |
| --- | ---: | --- |
| `TOKON` | 9 | 1_WCacg-NBs |
| `TOKON PLAYER` | 6 | 9G-yCsKqlDI |
| `JOHN TOKON` | 4 | fy_q-s3C8m8 |
| `DR. MARVEL` | 2 | P1UvhORYCpM |
| `The Tokon Texan` | 2 | 26SqJz0Xlpo |
| `HTokon` | 1 | iJfeIXRC27c |
| `MARKTOKON` | 1 | 0rL0Mx_AFI8 |
| `Marvel larper` | 1 | Z1uK06owFng |
| `JUGADOR TOKON` | 1 | AXxi2TgiEQM |
| `TOKON DEEZ` | 1 | R8ixtuzZlY4 |
| `marvel chokon` | 1 | 8Y6fDQNgFPk |
| `TOKON J` | 1 | 5yZnENL-6sM |
| `Marvel Games` | 1 | KbA1UgtZFO0 |

