# Tōkon pipeline report

## ⚠ ACTION REQUIRED

1 self-expiring gate(s) are due:

- **patch-table** (stale-patch-table, due 2026-10-15)
  The newest patch in scripts/patches.ts is 2026-08-28, and the feed was last confirmed quiet 2026-10-15, 12 days ago. Run `npm run data:patch-check` against the vendor's news feed. If a patch shipped and is not in the table, every replay since is filed under the previous token — silently wrong. If genuinely nothing shipped, run it as `npm run data:patch-check -- --confirm-quiet` and commit scripts/patches.ts: that records today and quiets this alarm for 10 days.

_Generated 2026-10-27T14:05:14.107Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 268 | 268 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 876 | 178 | 20.3% |
| replaysHub | 452 | 443 | 98.0% |
| fightingStationX | 3275 | 224 | 6.8% |
| fgcReplaysHub | 2821 | 41 | 1.5% |
| marvelTokonYT _(events only)_ | 46 | 11 | 23.9% |
| replayTheater _(carried)_ | — | 92 | — |
| **total** | | **1270** | |

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

How every one of the 2540 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 18 | 0.7% |
| description | 624 | 24.6% |
| index | 184 | 7.2% |
| footage | 153 | 6.0% |
| human | 1532 | 60.3% |
| review | 29 | 1.1% |

- complete (4/4): **2508/2540** (98.7%)
- oversize (>4, mid-set team change): **10** — counted in usage, excluded from pairing
- bench alignment: character-subset 33 · handle 722 · ambiguous 7
- title slot order: handle-first 1905 · chars-first 175 · parallel-lists 244
- tier conflicts (queued for review): 1
- title refutations (a person ruled the title wrong): **10** side(s) — named, with their evidence, by `npm run test:e2e`
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 21 | 0.8% |
| 2 | 4 | 0.2% |
| 3 | 7 | 0.3% |
| 4 | 2498 | 98.3% |
| 5 _(mid-set change)_ | 7 | 0.3% |
| 6 _(mid-set change)_ | 2 | 0.1% |
| 7 _(mid-set change)_ | 1 | 0.0% |

- **32 side(s) awaiting a drain** across 17 record(s) — oldest published **4 day(s)** ago

## Queues

- review queue (never published): **1** — character-completion 1
- bench queue (published, incomplete): **17**

## Player identity

13 identity(s) resolved from more than one spelling. The
retired ids are 301-redirected from vercel.json — run `npm run data:redirects`
after changing scripts/players.ts, or the old URLs 404.

| canonical | absorbed |
| --- | --- |
| `ajaxfidelity` | `ajax-fidelity` |
| `blueskyguy` | `blue-sky-guy` |
| `boymanguy` | `boy-man-guy` |
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

## Tournament placements — Liquipedia Tier 1–2, CC BY-SA 3.0

No data/tournaments.json — Tōkon has no Liquipedia page yet (scripts/tournaments.ts `LIQUIPEDIA_GAME` is null). The day one appears, set the constant and run `npm run data:tournaments` (manual, network) to pull its winner and runner-up tables.

## Misses

| reason | count |
| --- | ---: |
| other-game | 4252 |
| not-tokon | 1318 |
| pre-launch | 663 |
| not-a-match | 238 |
| short-duration | 56 |
| not-an-event | 35 |
| char-unresolved | 21 |
| no-vs-title | 10 |
| bad-handle | 1 |

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
| `Paker` | 1 | lvIsJvSRS5o |
| `SipderMan` | 1 | 7Muj4Ha1FyI |
| `GreenGoblin` | 1 | gy5Cd9rpbng |
| `Raked` | 1 | f_RPQ0HmHXE |

## Handles that resemble the game name

Handles matching `/t[ōo]kon|marvel/i`. The parser read the slot correctly —
the uploader put this in the handle position. Listed so a placeholder or a
garbled game name gets a human verdict instead of a quiet player page.

| handle | records | example |
| --- | ---: | --- |
| `TOKON` | 8 | 3kn0YRHRYj8 |
| `TOKON PLAYER` | 6 | 9G-yCsKqlDI |
| `JOHN TOKON` | 3 | 17zJLO3pto8 |
| `The Tokon Texan` | 2 | 26SqJz0Xlpo |
| `MARKTOKON` | 1 | 0rL0Mx_AFI8 |
| `DR. MARVEL` | 1 | xKOB-OdDuOQ |
| `Marvel larper` | 1 | Z1uK06owFng |
| `JUGADOR TOKON` | 1 | AXxi2TgiEQM |
| `TOKON DEEZ` | 1 | R8ixtuzZlY4 |
| `marvel chokon` | 1 | 8Y6fDQNgFPk |
| `TOKON J` | 1 | 5yZnENL-6sM |
| `Marvel Games` | 1 | KbA1UgtZFO0 |

