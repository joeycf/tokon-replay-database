/**
 * The source channels — checklist step 1, done before a fetcher existed.
 *
 * Five channels, all of them ordinary daily channels: there is no
 * backfill-once mechanism on this platform and never was. The first cron run IS
 * the backfill, which is why the cron-preservation gate (a simulated daily run
 * proving untouched channels survive) is the one that matters.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARRAY ORDER IS DEDUPE PRECEDENCE. Reordering changes which copy of a
 * cross-posted match survives, so the order is argued, not incidental:
 *
 *   1 highLevelReplays  richest metadata — TWO characters per side in the title
 *                       AND a full four-per-side bench in prose descriptions.
 *   2 proReplays        13/13 parse; full comma-separated bench on about half.
 *   3 hadoukenReplays   largest single contributor (34), but title-only.
 *   4 replaysHub        28, title-only; descriptions restate the title.
 *   5 fightingStationX  6 of 445 uploads. A general FGC channel, lowest
 *                       specificity, and the most likely to be re-posting
 *                       someone else's footage.
 *
 * Cross-channel duplication is REAL — one confirmed pair in the launch corpus
 * (the same Roda vs Snake Eyez match on two channels the same day) — but at
 * n=105 it is unmeasured, so scripts/replay-dupes.ts ships report-only and
 * drops nothing automatically.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE DEDUPE KEY IS `id` (the intake ChannelKey), never `source`. They are 1:1
 * today and the types are still kept distinct, because the moment one physical
 * channel starts publishing two kinds of footage they stop being 1:1 — and
 * keying dedupe on a shared public token means channel priority silently never
 * fires between the two, while override protection leaks from one channel's
 * hand corrections to the other's. Both failures look exactly like working
 * dedupe.
 */

import type { ChannelConfig } from '../types/index';

/** The uploads playlist is always 'UU' + channelId.slice(2). Pinned rather than
 *  looked up: it saves a quota unit per channel per run, and the id is stable
 *  where a handle is not. */
const uploads = (channelId: string) => `UU${channelId.slice(2)}`;

export const CHANNELS: ChannelConfig[] = [
  {
    id: 'highLevelReplays',
    source: 'highLevelReplays',
    name: 'Tōkon High Level',
    channelId: 'UCC5UAHBrbxGnQtckHl3NejA',
    uploadsPlaylist: uploads('UCC5UAHBrbxGnQtckHl3NejA'),
    tokonSignal: 'title',
    // "high level match: Wawa (Magik, Storm, Spider-Man and Blade) versus …"
    descriptionBench: 'prose-and',
  },
  {
    id: 'proReplays',
    source: 'proReplays',
    name: 'MARVEL TOKON Pro Replays',
    channelId: 'UCdppkT52RXi-pGvyibNIXNw',
    uploadsPlaylist: uploads('UCdppkT52RXi-pGvyibNIXNw'),
    tokonSignal: 'title',
    // "🕹️ AOTOBI (Magik, Doctor Doom, Blade, Black Panther) vs FENRITTI (…) 🕹️"
    descriptionBench: 'prose-comma',
    /**
     * LINEAGE — read this before touching the game-marker gate.
     *
     * This is the channel that rebranded from "2XKO Pro Replays". It is frozen
     * in 2xko-replay-database/scripts/channels.ts at 1,317 records, and its
     * 2XKO back catalogue is currently UNLISTED rather than deleted — which is
     * why its uploads playlist returns only its Tōkon era.
     *
     * Those 1,317 titles use an IDENTICAL "▰ HANDLE (Chars) vs HANDLE (Chars) ▰
     * … Pro level replays" grammar. If they are ever re-listed they will parse
     * cleanly here — players, characters, durations, everything — and quietly
     * become Tōkon matches. That is the ~24-hour cross-game pollution incident
     * running in the opposite direction, and it is why the marker gate plus the
     * launch date floor are both mandatory rather than defensive.
     *
     * A preserved sample of its Tōkon uploads sits at
     * 2xko-replay-database/raw/_tokon-sample.json.
     */
  },
  {
    id: 'hadoukenReplays',
    source: 'hadoukenReplays',
    name: 'Hadouken Replays',
    channelId: 'UCS9rlg0buedM1-GyWi3CfPw',
    uploadsPlaylist: uploads('UCS9rlg0buedM1-GyWi3CfPw'),
    tokonSignal: 'title',
    // Descriptions are pure boilerplate — no characters at all. Deliberately
    // no descriptionBench: reading them would only add noise.
    //
    // This is the channel whose SECOND title slot is reversed — "COLD (Storm)
    // vs (Ghost Rider) MR MARBEN 👊" — on 27 of its 34 parseable uploads. The
    // parser handles it by never choosing a slot order at all (see parse.ts).
  },
  {
    id: 'replaysHub',
    source: 'replaysHub',
    name: 'Tōkon Replays Hub',
    channelId: 'UC1UWSf3tgshNqSbmFzV8yKQ',
    uploadsPlaylist: uploads('UC1UWSf3tgshNqSbmFzV8yKQ'),
    tokonSignal: 'title',
    // "Player 1: HANDLE (Char)" — ONE character per side, so this is not a
    // bench source. Parsed only for the handle's nicer casing than the
    // ALL-CAPS title.
    descriptionBench: 'player-lines',
  },
  {
    id: 'fightingStationX',
    source: 'fightingStationX',
    name: 'Fighting Station X',
    channelId: 'UCtU_LgbjBgY1_0PY1L3K_Lw',
    uploadsPlaylist: uploads('UCtU_LgbjBgY1_0PY1L3K_Lw'),
    // The one channel needing the widened gate: a general FGC channel where
    // Tōkon is a minority of output and the titles are inconsistent about
    // naming the game. 439 of its 445 Tōkon-adjacent uploads are correctly
    // rejected as CPU matches, shorts and multi-match compilations — that
    // rejection rate is the gate working, not the gate misfiring.
    tokonSignal: 'titleOrDescription',
  },
];

export const CHANNEL_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));

/** Channels the daily fetch actually contacts. A frozen channel is skipped
 *  entirely and its committed records are carried forward byte-stable by
 *  parse.ts, which also hard-asserts the pinned count. Nothing is frozen yet;
 *  the mechanism ships on day one so it is tested before it is needed. */
export const ACTIVE_CHANNELS = CHANNELS.filter((c) => !c.frozen);
