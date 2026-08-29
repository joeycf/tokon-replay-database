# Tōkon pipeline report

## ⚠ ACTION REQUIRED

1 unmatched character-slot string(s) appear on 3+ records:
- `Doc.` × 3 (e.g. afb0QEfdkxM)

A new fighter has probably shipped. Add it to scripts/characters.ts and
get an accent token before it silently shortens every side it appears on.

_Generated 2026-08-29T22:32:43.717Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 108 | 108 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 774 | 78 | 10.1% |
| replaysHub | 142 | 138 | 97.2% |
| fightingStationX | 2707 | 107 | 4.0% |
| fgcReplaysHub | 2563 | 24 | 0.9% |
| marvelTokonYT _(events only)_ | 41 | 11 | 26.8% |
| replayTheater _(index)_ | 44 | 44 | 100.0% |
| **total** | | **523** | |

## Local-first intakes

| intake | records | pin | this run |
| --- | ---: | ---: | --- |
| `replayTheater` | 44 | 44 | rebuilt from a local dump |

_Entries skipped as already-known: **0**. The catalogue indexes no video this repo has fetched, published or ruled on._

## Character provenance

How every one of the 1046 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 108 | 10.3% |
| description | 275 | 26.3% |
| index | 88 | 8.4% |
| footage | 32 | 3.1% |
| human | 519 | 49.6% |
| review | 24 | 2.3% |

- complete (4/4): **938/1046** (89.7%)
- oversize (>4, mid-set team change): **7** — counted in usage, excluded from pairing
- bench alignment: handle 258 · character-subset 21 · ambiguous 4
- title slot order: handle-first 780 · chars-first 76 · parallel-lists 80
- tier conflicts (queued for review): 1
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 108 | 10.3% |
| 4 | 931 | 89.0% |
| 5 _(mid-set change)_ | 6 | 0.6% |
| 6 _(mid-set change)_ | 1 | 0.1% |

- **108 side(s) awaiting a drain** across 54 record(s) — oldest published **13 day(s)** ago

> The bench queue is at 54 (nudge threshold 40).
> Run `npm run data:catchup` locally — the cron cannot do this: extraction
> needs a logged-in YouTube session from a residential address.

## Queues

- review queue (never published): **3** — character-completion 2 · bench-conflict 1
- bench queue (published, incomplete): **54**

## Player identity

10 identity(s) resolved from more than one spelling. The
retired ids are 301-redirected from vercel.json — run `npm run data:redirects`
after changing scripts/players.ts, or the old URLs 404.

| canonical | absorbed |
| --- | --- |
| `balderberg` | `balder-berg` |
| `blueskyguy` | `blue-sky-guy` |
| `boymanguy` | `boy-man-guy` |
| `hulk-mash` | `hulkmash` |
| `jaazzrap` | `jaazz-rap` |
| `mrmarben` | `mr-marben` |
| `nychrisg` | `nychris-g` |
| `sonicfox` | `sonic-fox` |
| `tokon-player` | `to-kon-player` |
| `vivid-aspiration` | `vividaspiration` |

## Misses

| reason | count |
| --- | ---: |
| other-game | 3959 |
| not-tokon | 1090 |
| pre-launch | 663 |
| not-a-match | 115 |
| not-an-event | 30 |
| char-unresolved | 14 |
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
| `Doc.` | 3 | afb0QEfdkxM |
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

