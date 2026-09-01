/**
 * The source channels — checklist step 1, done before a fetcher existed.
 *
 * Seven channels, all of them ordinary daily channels: there is no
 * backfill-once mechanism on this platform and never was. The first cron run IS
 * the backfill, which is why the cron-preservation gate (a simulated daily run
 * proving untouched channels survive) is the one that matters.
 *
 * Six are online re-uploaders and one (marvelTokonYT) is claimed for event
 * footage only. That is the split app/app.config.ts sourceGroups renders as
 * Online / Tournament — the group ids live there and nowhere else, never in
 * this file, in the data, or in a URL.
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
 *   6 fgcReplaysHub     1 of 2,517 uploads — a 2XKO channel that added Tokon
 *                       on 2026-08-23, so its Tokon output is the newest and
 *                       thinnest here. Same tier as 5 and below it: its players
 *                       (Hook, Supernoon, Hikari) already arrive via three
 *                       other channels, so a tie should resolve to whichever
 *                       of those saw it first.
 *   7 marvelTokonYT     events only, and the ONE channel here whose footage
 *                       nothing else carries. Ranked last regardless, because
 *                       precedence decides who wins a tie and it is a
 *                       re-uploader, not the event's rights holder — the
 *                       opposite of why SF6 ranks @EvoEvents high. If
 *                       fightingStationX's EVO Las Vegas uploads are ever
 *                       claimed, that channel should win the overlap on the
 *                       same argument, and this order already says so.
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

import { PRE_RELEASE } from './patches';
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
  {
    id: 'fgcReplaysHub',
    source: 'fgcReplaysHub',
    name: 'FGC Replays Hub',
    channelId: 'UCUULKDufuCn_OSInbqNz50g',
    uploadsPlaylist: uploads('UCUULKDufuCn_OSInbqNz50g'),
    /**
     * The SAME physical channel 2xko-replay-database tracks as `bestReplays`.
     * It rebranded to the multi-game "FGC Replays Hub" on 2026-08-23 and now
     * publishes both games; 2XKO gated it title-scoped the same day (e00d238)
     * and holds its Tokon uploads out. This entry claims them.
     *
     * Unlike proReplays above, this channel did NOT walk — it straddles. So the
     * answer is a gate on each side, not a freeze on one. Last in the array
     * deliberately: a general multi-game channel is the lowest-specificity
     * source and the most likely to be re-posting footage the dedicated
     * channels already carry, which is the same argument fightingStationX sits
     * on. Its players are already here — Hook, Supernoon and Hikari all appear
     * across three other channels — so its copies lose dedupe, as they should.
     */
    // TITLE SCOPE. Measured over the channel's 2,517 uploads:
    //
    //   scope                 kept   rejected
    //   'title'                  1   2516 other-game
    //   'titleOrDescription'     1   2516 other-game
    //
    // The two agree TODAY, and the reason is OTHER_GAME_RE, not the scope: all
    // 2,516 2XKO uploads name 2XKO in the TITLE, so they are rejected whichever
    // way the positive marker is read. The dual-game boilerplate that names
    // both games sits on 1 of 2,517 descriptions — the Tokon one. Its 2XKO
    // uploads still carry a bare "Patch: 23rd July 2026" (0/2,516 mention
    // Tokon).
    //
    // 'title' is chosen for what happens when that boilerplate spreads to the
    // 2XKO uploads: 'titleOrDescription' would then match TOKON_RE on 2,516
    // foreign records and leave their rejection resting entirely on the
    // both-markers branch, burying the miss report. Leaning on one gate to
    // catch another's over-reach is not a design.
    tokonSignal: 'title',
    // The channel states a full four-per-side bench as a bare list after "with"
    // ("EDUARDO HOOK with Blade, Storm, Spider Man, Iron Man vs SUPERNOON with
    // Magik, Spider Man, Green Goblin, Blade"), which none of the original three
    // shapes read: DESC_SIDE_RE requires parentheses.
    //
    // DEFERRED AT ADD-TIME AT n=1, AUTHORED AT n=6. The deferral was right: a
    // bench grammar written against one sample does not fail loudly, it
    // "completes" a side with fabricated fighters (checklist 5e). The channel
    // published five more within two days, all in one grammar, and all 48 names
    // resolve — so the shape is now measurable against its own rejects rather
    // than fitted to a single string. See bench.ts for why its handle class is
    // uppercase-only; that is the part that took the argument, not the list.
    descriptionBench: 'prose-with',
  },
  {
    /**
     * @MarvelTokonYT — "Marvel Tokon Replays". THE TOURNAMENT CHANNEL, and the
     * reason app.config.ts finally declares sourceGroups: until it arrived, one
     * "Online" group would have collapsed six chips into one that toggles
     * everything.
     *
     * EVENTS ONLY, which is why `id` and `source` differ here and nowhere else.
     * Of its 47 uploads, 28 are ordinary "High Level Match" online replays and
     * 19 are CEO 2026 / EVO 2026 event footage. The online half is not claimed:
     * its players — Punk, ChrisG, SonicFox, Cloud805, Hikari, Bleed, Leffen —
     * all already arrive via the six channels above, so claiming it would buy
     * duplicate adjudication for footage the archive already holds. Its event
     * footage nobody else carries at all.
     *
     * TWO TITLE GRAMMARS, and it switched between them mid-August. Its newer
     * uploads use the ▰ affixes every other channel here uses; its older ones
     * use ➤ … ✦. Measured before this entry existed: with the ▰-only affix cut,
     * 5 of its 9 CEO uploads died as `bad-handle` because the event suffix rode
     * into the second handle past the 40-char refusal, and its EVO titles
     * yielded handles like "Marvel Tokon ➤ Nerdjosh". core() reads all three
     * delimiters now (see AFFIX in parse.ts).
     *
     * NO descriptionBench: descriptions are pure SEO boilerplate on all 47 —
     * the same paragraph plus a fixed comma list of fighters unrelated to the
     * match. Reading them would fabricate benches, not fill them.
     */
    id: 'marvelTokonYT',
    source: 'marvelTokonTournament',
    name: 'Marvel Tokon Events',
    channelId: 'UCDVoHjJRebhSyzqdg7dlvHw',
    uploadsPlaylist: uploads('UCDVoHjJRebhSyzqdg7dlvHw'),
    // Title scope is enough: all 19 event titles name the game in the title.
    tokonSignal: 'title',
    eventsOnly: true,
    /**
     * Its 10 EVO 2026 Exhibition uploads are dated 2026-06-26/27 — six weeks
     * before launch, on a build that was never shipped. They are real
     * competitive footage and the only pre-launch records this archive admits;
     * see PRE_RELEASE in patches.ts for why the floor moved HERE and not
     * globally (a global move admits 212 records of beta ranked matches and
     * December 2025 closed-test footage from two other channels).
     *
     * None of the 10 names a fighter in its title, so they land in the review
     * queue as `character-completion` and publish as verdicts arrive. That is
     * the intended path, not a failure.
     */
    preReleaseFrom: PRE_RELEASE,
  },
  {
    /**
     * THE FIRST INDEX SOURCE IN THIS REPO. replaytheater.app is a fan-curated
     * match catalogue: it hosts no video, it points AT video with a start
     * offset. An entry is a (videoId, startSeconds) pair plus players,
     * characters and an event tag, so a record here is a SEGMENT — the 44
     * tagged Tōkon matches are cut from just 5 longform VODs, a median of 8
     * per video — which is why these records are keyed `${videoId}@${start}`
     * and not by video id.
     *
     * WHY IT IS WORTH A SOURCE. Segmenting longform tournament streams is work
     * this repo has no way to do, and these are 44 sets from 5 events it holds
     * none of. They also arrive BENCH-COMPLETE: the catalogue carries four
     * character columns per side and Tōkon fills all four, so unlike every
     * other intake here these records need no bench drain at all. Measured
     * against the source VODs' own chapter markers: 44/44 offsets land on a
     * chapter and 25/25 chapters that name a matchup agree on both handles.
     *
     * LAST IN THE ARRAY, deliberately. Array order is the dedupe precedence
     * (see this file's header), and lowest is right for a source that
     * re-indexes other people's uploads: where it and a channel describe the
     * same set, the channel's own upload should win.
     *
     * NO channelId, NO uploadsPlaylist, NO tokonSignal: there is no channel and
     * no title to gate. The game is checked per ENTRY against `gameLabel`,
     * because ?game= is a filter the catalogue answers, not one we control.
     */
    id: 'replayTheater',
    source: 'replayTheater',
    name: 'Tournament VODs',
    index: {
      endpoint: 'https://replaytheater.app/api/matches',
      slug: 'tokon',
      gameLabel: 'Marvel Tokon: Fighting Souls',
      pageSize: 50,
      pacingMs: 1200,
    },
    cronFetchedWithCarry: true,
    /**
     * 18 of the 44 sit on one VOD published 2026-07-26 — the TNS Beta
     * Tournament, eleven days before launch. They are real competitive footage
     * on the pre-release build, exactly like marvelTokonYT's EVO uploads, and
     * they file under the same S0 era and `2026-06-26` patch token. Without
     * this the builder's floor is LAUNCH and 40% of the ingest disappears.
     */
    preReleaseFrom: PRE_RELEASE,
  },
];

export const CHANNEL_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));

/**
 * Sponsor/team prefix on a catalogue handle: "NP | Senshi", "BBB | Aerodat".
 * STRIPPED, never split — "|" is not a duo delimiter here, and treating it as
 * one would mint a player called "BBB" with a page of its own.
 *
 * APPLIED REPEATEDLY, and that is not defensive coding. The catalogue carries
 * doubly-prefixed handles — "Sweet | BBB | Aerodat" — and a single .replace()
 * leaves "BBB | Aerodat", which is a worse outcome than not stripping at all:
 * it mints a player whose name contains a sponsor tag rather than one that is
 * merely wrong. Loop until stable.
 */
export const THEATER_SPONSOR = /^[^|]{1,12}\s*\|\s*/;

export const stripTheaterSponsor = (handle: string): string => {
  let out = handle.trim();
  // Bounded: each pass removes at least one "|", and a handle carries few.
  for (let i = 0; i < 4; i++) {
    const next = out.replace(THEATER_SPONSOR, '').trim();
    if (next === out || next === '') break;
    out = next;
  }
  return out;
};

/** Channels the daily fetch actually contacts, and the channels whose records
 *  are built by a TITLE PARSE — the two happen to be the same set.
 *
 *  A frozen channel is skipped: its committed records are carried forward
 *  byte-stable by parse.ts, which also hard-asserts the pinned count. Nothing
 *  is frozen yet; the mechanism ships on day one so it is tested before it is
 *  needed. An INDEX source is skipped for a different reason — it has no
 *  channel to fetch and no title to parse, and its records are built by their
 *  own function. Note it is still in CHANNELS, so the collapse guard and the
 *  report both still see it; only these two jobs skip it. */
export const ACTIVE_CHANNELS = CHANNELS.filter((c) => !c.frozen && !c.index);
