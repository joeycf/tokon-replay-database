# Tōkon pipeline report

_Generated 2026-08-30T16:20:31.751Z_

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

## Local-first intakes

| intake | records | pin | this run |
| --- | ---: | ---: | --- |
| `replayTheater` | 44 | 44 | rebuilt from a local dump |

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

- **124 side(s) awaiting a drain** across 62 record(s) — oldest published **14 day(s)** ago

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

