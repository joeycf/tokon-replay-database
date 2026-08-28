import patchGroups from '../data/patchGroups.json';
import type { GameConfig } from '@engine/types';

/**
 * The MARVEL Tōkon GameConfig — merged OVER the engine's neutral default.
 * Everything game-shaped the engine renders comes from here via useGame(); the
 * visual skin lives separately in app/assets/theme.css.
 *
 * The genericity knobs, deliberately:
 *
 * - charactersPerSide 4 → the platform's first 4v4 tag game, and the reason
 *   engine v0.7.0 exists (the field was typed `1 | 2 | 3`). It describes the
 *   simultaneous-character FORMAT and drives UI affordances; it is NOT a length
 *   cap. Sides here are genuinely 1..4 long because characters arrive in
 *   tiers — the title names 1–2, the description bench fills more, footage
 *   completes the rest — and a mid-set team change legitimately exceeds 4.
 *
 * - filters.coOccurrence FALSE, even though this is the game that most obviously
 *   wants it. At 4 per side a team yields C(4,2) = 6 pairs against a duo's 1,
 *   which is a combinatorially different feature, not a bigger version of the
 *   same one. Shipping it by inheritance would mean fabricating pairs for
 *   oversize sides and guessing at a synergy surface nobody designed. The data
 *   is not emitted (scripts/stats.ts) and every engine duo panel self-hides on
 *   an empty pair set, so the app renders correctly without it.
 *
 * - filters.rank UNSET. Tōkon has a ranked mode, but no source in the corpus
 *   states a ladder tier. What the titles DO carry — "(#2 Ranked Danger)" — is
 *   a per-character leaderboard POSITION, structurally identical to SF6's
 *   "#3 Ranked Guile", which SF6 strips and never turns into Side.rank. Turning
 *   it on would render a facet with nothing in it.
 *
 * - terms + characterRouteSegment: Tōkon says "fighters", not "characters", and
 *   a side is a "team". Both come from the design spec, whose nav reads
 *   Browse / Stats / Fighters / Players and whose active chip reads
 *   "fighter: storm". Greenfield URLs, so /fighters/* costs nothing.
 *
 * - sourceGroups SET, as of the marvelTokonYT intake. It was deliberately unset
 *   until then, and the reason it was is the reason it is now: with six online
 *   re-uploaders and nothing else, a single "Online" group collapses six chips
 *   into one that toggles everything — strictly less useful than the 1:1 chips
 *   the engine renders by default. The split needed a second kind of footage to
 *   be a split at all, and @MarvelTokonYT's CEO/EVO coverage is it. The
 *   siblings collapsed to two groups for the same reason, not by convention.
 *
 *   Note what this costs: the engine renders ONLY group chips when sourceGroups
 *   is set, so the six per-channel chips are gone from the filter bar. They are
 *   not gone from the data — SourceBadge still names the real channel on every
 *   card, and a group toggle writes its member ids into the same `?src=` CSV,
 *   so every per-channel deep link ever shared still resolves.
 *
 * Accents are transcribed from design/handoff/tokens.css (--char-*), the design
 * system's source of truth — scripts/characters.ts reads the same block when
 * building data/characters.json, so config and data cannot drift, and a roster
 * id with no token fails loud rather than shipping an unstyled fighter.
 */
export default defineAppConfig({
  game: {
    id: 'tokon',
    slug: 'tokon',
    name: 'MARVEL Tōkon: Fighting Souls',
    // The macron is load-bearing and asserted in e2e: it renders in the
    // wordmark ("TŌKON / REPLAY") through Bangers' latin-ext subset, and a
    // latin-only subset would ship tofu in production and nowhere else.
    shortName: 'TŌKON',
    // Rendered by the engine as "Unofficial fan project · not affiliated with
    // {rightsHolder}." Three parties hold rights here — Marvel owns the
    // characters, Arc System Works developed, Sony published — and the design
    // brief's disclaimer names all three, so the string does too.
    rightsHolder: 'Marvel Games, Arc System Works, or Sony Interactive Entertainment',
    baseURL: '/tokon', // behind the shell at replaydatabase.com/tokon
    siteUrl: 'https://replaydatabase.com',
    // Web Analytics beacons go to THIS project instead of pooling into the
    // shell. Paired 1:1 with the shell vercel.json rewrite
    //   /tokon-insights/:path* → https://tokon-replay-database.vercel.app/_vercel/insights/:path*
    // — the two ship together or every beacon 404s, silently. Same-origin on
    // purpose: the child's endpoints send no CORS headers, so an absolute URL
    // here would die at preflight. speedInsights stays at the engine default
    // (single-project on Hobby — it must reach the enabled project).
    observability: { insights: '/tokon-insights' },
    charactersPerSide: 4,
    filters: {
      coOccurrence: false,
      rank: false,
    },
    terms: {
      character: 'fighter',
      characters: 'fighters',
      side: 'team',
    },
    characterRouteSegment: 'fighters',
    // No GameStatsPanels override ships, so the stats page's `beside-timeline`
    // anchor is empty — give the meta-over-time chart the whole row and, with
    // the room, plot the top 8 of a 21-fighter roster.
    stats: {
      metaTimelineTopN: 8,
      metaTimelineFullWidth: true,
    },
    accents: {
      // Fighting Avengers
      'captain-america': '#5b8def',
      'iron-man': '#e6961c',
      hulk: '#46cf52',
      'black-panther': '#9267f5',
      // Amazing Guardians
      'spider-man': '#5f7cff',
      'ms-marvel': '#ffd98a',
      'star-lord': '#f4586a',
      'peni-parker': '#f45fa8',
      // Unbreakable X-Men
      storm: '#bfd9e8',
      magik: '#b650f2',
      wolverine: '#ffd23b',
      danger: '#2ed2c8',
      // Knights of Doom
      'doctor-doom': '#23c29e',
      magneto: '#d355db',
      'green-goblin': '#afd32c',
      carnage: '#e8502b',
      // Samurai Outriders
      'ghost-rider': '#7b7bff',
      blade: '#6fa4b8',
      loki: '#1fb47d',
      deadpool: '#de4e79',
      // Unaffiliated — the hidden 21st fighter, absent from the design brief.
      // Derived by the handoff's own method, then confirmed by a design session
      // at the same hex; see design/handoff/tokens.css for why he was missing.
      champion: '#ec51c9',
    },
    // Order matters: SourceBadge styles by index (0 = filled primary,
    // 1 = secondary outline, 2+ = warning outline). Ids mirror
    // scripts/channels.ts — the pipeline's Replay.source contract — and the
    // array order there is also the dedupe precedence, argued in its header.
    // APPEND only: inserting would recolour shipped badges.
    sourceChannels: [
      { id: 'highLevelReplays', name: 'Tōkon High Level' },
      { id: 'proReplays', name: 'MARVEL TOKON Pro Replays' },
      { id: 'hadoukenReplays', name: 'Hadouken Replays' },
      { id: 'replaysHub', name: 'Tōkon Replays Hub' },
      { id: 'fightingStationX', name: 'Fighting Station X' },
      { id: 'fgcReplaysHub', name: 'FGC Replays Hub' },
      // ONE channel (marvelTokonYT), claimed for its event footage only, so the
      // badge names what the record IS rather than the channel it came from —
      // the same reason SF6 labels its second KingArena token "King Arena
      // Events". Index 6, so it shares the warning outline with 2..5; the label
      // is what disambiguates.
      { id: 'marvelTokonTournament', name: 'Marvel Tokon Events' },
    ],
    // Filter chips consolidate to two groups (engine v0.5.5). Group ids appear
    // NOWHERE else — not in Replay.source, not in a URL: toggling a group
    // writes its member ids to the same `?src=` CSV the per-channel links
    // already used. Membership mirrors scripts/channels.ts, where `eventsOnly`
    // marks the one channel on the tournament side.
    sourceGroups: [
      {
        id: 'online',
        name: 'Online',
        sources: [
          'highLevelReplays',
          'proReplays',
          'hadoukenReplays',
          'replaysHub',
          'fightingStationX',
          'fgcReplaysHub',
        ],
      },
      { id: 'tournament', name: 'Tournament', sources: ['marvelTokonTournament'] },
    ],
    // Era → patch hierarchy. PIPELINE-EMITTED (scripts/emit.ts →
    // data/patchGroups.json) from the same boundary authority that derives every
    // replay's patch token, so the UI hierarchy and the data cannot drift.
    // Vercel never runs the pipeline, so that artifact has to be committed.
    //
    // The children are DATES. Tōkon's vendor publishes no version string at
    // all — patches are date-titled posts ("Patch Update 8/10/2026") — so the
    // token is the vendor's own publication date, ISO-normalised. See
    // scripts/patches.ts for why that is the correct reading of "use the
    // vendor's own version grammar" rather than a shortcut around it.
    patchGroups,
    fonts: {
      display: 'Bangers',
      ui: 'Manrope',
      mono: 'JetBrains Mono',
    },
    manifest: {
      themeColor: '#03a5fe',
      backgroundColor: '#0a0e17',
    },
    ogImage: '/og-default.png',
    // ComboForge cross-link on character pages (engine v0.11.0). Their game id
    // for this one is 'marveltokon', not ours; every character id derives, so
    // no map is needed. Gated with the engine's `npm run verify:comboforge`.
    comboforge: { gameId: 'marveltokon' },
  } satisfies GameConfig,
});
