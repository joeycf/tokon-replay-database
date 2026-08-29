# Tōkon pipeline report

_Generated 2026-08-29T16:23:21.099Z_

## Coverage

| channel | uploads | parsed | share |
| --- | ---: | ---: | ---: |
| highLevelReplays | 107 | 107 | 100.0% |
| proReplays | 14 | 13 | 92.9% |
| hadoukenReplays | 773 | 77 | 10.0% |
| replaysHub | 140 | 136 | 97.1% |
| fightingStationX | 2704 | 105 | 3.9% |
| fgcReplaysHub | 2561 | 23 | 0.9% |
| marvelTokonYT _(events only)_ | 40 | 11 | 27.5% |
| replayTheater | 0 | 0 | 0.0% |
| **total** | | **472** | |

## Character provenance

How every one of the 944 sides got its characters.

| tier | sides | share |
| --- | ---: | ---: |
| title | 98 | 10.4% |
| description | 271 | 28.7% |
| index | 0 | 0.0% |
| footage | 32 | 3.4% |
| human | 519 | 55.0% |
| review | 24 | 2.5% |

- complete (4/4): **846/944** (89.6%)
- oversize (>4, mid-set team change): **7** — counted in usage, excluded from pairing
- bench alignment: handle 254 · character-subset 21 · ambiguous 4
- title slot order: handle-first 767 · chars-first 75 · parallel-lists 80
- tier conflicts (queued for review): 1
- decomposed-Ō titles seen: 0

### Side-size distribution

| fighters on a side | sides | share |
| --- | ---: | ---: |
| 1 | 98 | 10.4% |
| 4 | 839 | 88.9% |
| 5 _(mid-set change)_ | 6 | 0.6% |
| 6 _(mid-set change)_ | 1 | 0.1% |

- **98 side(s) awaiting a drain** across 49 record(s) — oldest published **13 day(s)** ago

> The bench queue is at 49 (nudge threshold 40).
> Run `npm run data:catchup` locally — the cron cannot do this: extraction
> needs a logged-in YouTube session from a residential address.

## Queues

- review queue (never published): **3** — character-completion 2 · bench-conflict 1
- bench queue (published, incomplete): **49**

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
| other-game | 3958 |
| not-tokon | 1090 |
| pre-launch | 663 |
| not-a-match | 114 |
| not-an-event | 29 |
| char-unresolved | 14 |
| short-duration | 6 |
| no-vs-title | 4 |
| bench-conflict | 1 |

- `marvelTokonYT` events-only gate: **29** upload(s) carried no known event brand.
  - MARVEL Tokon ▰ ChrisG (Black Panther) vs Snake Eyes (Champion) ▰ High Level Match
  - MARVEL Tokon ▰ Naire (Spider-Man) vs Roda (Wolverine) ▰ High Level Match
  - MARVEL Tokon ▰ Harampool Crazy DEADPOOL ▰ High Level Match
  - MARVEL Tokon ▰ HaramPool (#1 Deadpool) vs Opal (Magik) ▰ High Level Match
  - MARVEL Tokon ▰ K7 (Doctor Doom) vs Yamii (Spider-Man) ▰ High Level Match
  - …and 24 more

## Unmatched text in character slots

Text no roster alias covered. A new fighter, a new nickname, or a typo —

| text | count | example |
| --- | ---: | --- |
| `P.Parker` | 2 | cAjt5HIKDyI |
| `Doc.` | 2 | PsrOeas920s |
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

