// Pipeline-track types (plain node/tsx code — never enters the Nuxt graph, so
// the engine contract is restated where emitted shapes must mirror it, exactly
// like the SF6, Tekken and 2XKO pipelines do).

/** The Replay.source contract: doubles as GameConfig.sourceChannels[].id
 *  (badge/filter). The six original channels are each their own source; the
 *  tournament intake (marvelTokonYT) is the one that breaks the 1:1 — see
 *  ChannelKey below. Grouping into Online/Tournament chips lives ONLY in
 *  app/app.config.ts sourceGroups; group ids never appear in data or URLs. */
export type SourceId =
  | 'highLevelReplays'
  | 'proReplays'
  | 'hadoukenReplays'
  | 'replaysHub'
  | 'fightingStationX'
  | 'fgcReplaysHub'
  | 'marvelTokonTournament'
  | 'replayTheater';

/**
 * Per-YouTube-channel intake key: names raw/<key>.json and the coverage
 * report's rows. THE DEDUPE KEY (checklist step 2) — never the SourceId, which
 * two channels may one day deliberately share.
 *
 * `export type ChannelKey = SourceId` stood here until marvelTokonYT arrived,
 * with a comment predicting it would stop being true "the moment one physical
 * channel starts publishing two kinds of footage". @MarvelTokonYT publishes
 * both — daily online replays AND CEO/EVO event footage — and this repo ingests
 * only the events (`eventsOnly`), so the channel is `marvelTokonYT` and its one
 * public token is `marvelTokonTournament`. Keeping the two unions separate is
 * what makes adding its online half later a config change rather than a
 * migration: a second SourceId on the same ChannelKey, SF6's kingArena shape.
 */
export type ChannelKey =
  | 'highLevelReplays'
  | 'proReplays'
  | 'hadoukenReplays'
  | 'replaysHub'
  | 'fightingStationX'
  | 'fgcReplaysHub'
  | 'marvelTokonYT'
  | 'replayTheater';

/** How a channel's descriptions state the bench, when they do at all. Measured
 *  per channel on the launch corpus; see scripts/bench.ts.
 *   'prose-comma'  proReplays       "HANDLE (Magik, Doctor Doom, Blade, Black Panther) vs …"
 *                                   (also hyphen-separated: "(Ghost Rider- Storm- Magik)")
 *   'prose-and'    highLevelReplays "match: Wawa (Magik, Storm, Spider-Man and Blade) versus …"
 *   'player-lines' replaysHub       "Player 1: HANDLE (Char)" — ONE per side, no bench.
 *                                   Parsed for handle CASING only, never as a bench.
 *  Absent  ⇒ the description is boilerplate and is not read at all. */
export type DescriptionBench = 'prose-comma' | 'prose-and' | 'prose-with' | 'player-lines';

/**
 * An INDEX source: a third-party catalogue that points AT video rather than
 * hosting it. Its entries are (videoId, startSeconds) pairs plus players,
 * characters and an event tag, so a record here is a SEGMENT of a longform VOD
 * and several records share one video. There is no channel, no uploads
 * playlist, and nothing to resolve.
 */
export interface ChannelIndex {
  /** Catalogue endpoint, paged with &page=N. */
  endpoint: string;
  /** The index's own token for this game, used as the ?game= query value. */
  slug: string;
  /** The game string each ENTRY states about itself. Checked per entry, because
   *  ?game= is a filter someone else answers and a mistagged submission arrives
   *  looking exactly like a real one. */
  gameLabel: string;
  /** Entries per page. Theirs, not ours — the API ignores per_page/limit, so
   *  this only computes the page count. */
  pageSize: number;
  /** ms between requests — politeness, not rate-limit avoidance. */
  pacingMs: number;
}

export interface ChannelConfig {
  /** Raw-dump key / report row (unique per YouTube channel). */
  id: ChannelKey;
  /** The source this channel's replays publish under. */
  source: SourceId;
  /** Display name (mirrors app/app.config.ts sourceChannels[].name). */
  name: string;
  /** YouTube channel id. Absent on an `index` source, which has no channel. */
  channelId?: string;
  /** The channel's uploads playlist (UU + channelId.slice(2), pinned — saves a
   *  quota unit per channel per run, and the id is stable where a handle is not).
   *  Absent on an `index` source. */
  uploadsPlaylist?: string;
  /** This intake is a third-party INDEX, not a YouTube channel. Its dump is
   *  built by scripts/fetch-theater.ts, its records are not built by a title
   *  parse, and data:fetch skips it. Mutually exclusive with channelId. */
  index?: ChannelIndex;
  /**
   * LOCAL-FIRST: deliberately not part of the daily cron.
   *
   * raw/ is gitignored and the cron fetches remotely into a fresh checkout, so
   * a source only ever fetched by hand has no dump there. Without this flag
   * parse would either exit (missing dump) or, worse, drop every one of its
   * records. So when the dump is ABSENT its committed records are CARRIED, the
   * same mechanism `frozen` uses; when the dump is PRESENT they are rebuilt.
   *
   * The carry needs a pin for the reason `frozen.records` does — data/videos.json
   * is both source and target — but it cannot be a constant here, because a
   * local-first source GROWS. It lives in data/source-pins.json, written by the
   * local rebuild and asserted by every parse.
   */
  localFirst?: boolean;
  /** Where the is-Tōkon game marker may appear. Default 'title'. Only
   *  fightingStationX needs the widened gate: it is a general FGC channel whose
   *  Tōkon uploads are a minority and whose titles are inconsistent. */
  tokonSignal?: 'title' | 'titleOrDescription';
  /** The prose shape of this channel's descriptions, if it states characters. */
  descriptionBench?: DescriptionBench;
  /**
   * This channel is ingested for EVENT FOOTAGE ONLY: a title carrying no
   * event-brand signal is a miss (`not-an-event`), not a record.
   *
   * @MarvelTokonYT publishes both kinds — ~25 daily "High Level Match" replays
   * alongside its CEO/EVO uploads — and its online half is deliberately not
   * claimed here: those players (Punk, ChrisG, SonicFox, Cloud805, Hikari,
   * Bleed, Leffen) already arrive via the six online channels, so claiming them
   * would add duplicate adjudication for footage the archive already holds.
   * Its event footage nobody else carries.
   *
   * The gate is DELIBERATELY TIGHT (see EVENT_RE in parse.ts). On an
   * events-only channel the two failure directions are not symmetric: an
   * unrecognised event brand is dropped and shows up as a countable
   * `not-an-event` miss in report.md, while an over-broad pattern publishes an
   * ordinary ranked replay under the Tournament chip, where nothing looks
   * wrong. So the pattern requires an event BRAND, never a bare round word.
   */
  eventsOnly?: boolean;
  /**
   * This channel's date floor, in place of the global LAUNCH gate.
   *
   * SCOPED PER CHANNEL, AND THAT IS THE WHOLE POINT. Measured on the raw dumps:
   * moving the floor globally to 2026-06-26 admits 212 records — 204 from
   * fightingStationX (Open Beta ranked matches and EVO 2026 Las Vegas footage)
   * and 8 from hadoukenReplays dating to December 2025, a closed-test build
   * eight months pre-launch. The floor is the gate that keeps those out; it
   * stays hard for every channel that does not set this.
   *
   * Only meaningful together with a pre-release era in patches.ts — emit throws
   * on a patch token no boundary accounts for, so a record admitted here with
   * no era to file under fails loudly rather than shipping undated.
   */
  preReleaseFrom?: string;
  /** A channel that stopped publishing this game. Its committed records are
   *  still real and still play at their URLs, so they are CARRIED FORWARD
   *  byte-stable rather than pruned; fetch skips it entirely. `records` is a
   *  hard-asserted pin — the committed data file is both the source and the
   *  target of the carry, so one bad run would poison the next run's reference
   *  permanently and silently. Editing the pin IS the deliberate-prune
   *  mechanism, and it shows up in review. (Checklist step 7.) */
  frozen?: { since: string; reason: string; records: number };
}

/** One upload as fetched from the YouTube Data API (raw/<key>.json). */
export interface RawVideoRecord {
  id: string;
  /** Intake channel, NOT the source — parse maps it via CHANNELS. */
  channel: ChannelKey;
  title: string;
  description: string;
  publishedAt: string; // ISO
  /** ISO8601 duration decoded to seconds; 0 = live/upcoming/unknown. */
  durationSec: number;
  viewCount?: number;
  /** 'none' for normal VODs; 'live'/'upcoming' are excluded by parse. */
  liveBroadcastContent: string;
  tags?: string[];
}

/**
 * One record in raw/replayTheater.json — an index entry already joined to its
 * VOD's YouTube metadata. Extends RawVideoRecord so the dump reads like any
 * other, but the fields below are what the record is actually BUILT from:
 * nothing here is recovered by parsing the title.
 */
export interface TheaterRawRecord extends RawVideoRecord {
  /** `${videoId}@${startSeconds}` — the record id, not a YouTube id. */
  id: string;
  /** The catalogue's own entry id. Provenance, and the fetch resume key. */
  theaterId: number;
  /** The YouTube id this segment lives inside. */
  videoId: string;
  /** Offset into videoId, in seconds. */
  startSeconds: number;
  /** The catalogue's event tag. Non-empty by construction — an untagged entry
   *  is online play and never reaches the dump. */
  tag: string;
  /** The VOD's own uploader, for the report. The 5 source VODs belong to
   *  different organisers, so this is per record, not per intake. */
  uploader: string;
  /** [side0, side1] handles, exactly as the catalogue spells them — sponsor
   *  prefixes intact, for the parser to strip. */
  players: [string, string];
  /** [side0, side1] character names, exactly as the catalogue spells them.
   *  Tōkon is 4v4 and the catalogue carries four columns per side, so a side
   *  here is normally 4 long — but the length is OBSERVED, never assumed, and
   *  `complete` is derived from it downstream like every other tier's. */
  characters: [string[], string[]];
}

/** Which stage produced a side's characters. Ordered weakest → strongest. */
/**
 * `human` sits above every automatic tier and is the tier this game ends on.
 *
 * The portrait reader was built, measured and STOPPED: with 189 hand-labelled
 * crops — the strongest input it could ever get — a fighter's own bench icon
 * varied by 20-24 bits across matches while different fighters differed by only
 * 26-29, a margin of ~6 bits on a 64-bit hash. The bust reader gets ~16, which is
 * why that one works. No accept radius separates classes that overlap that much,
 * and 1080p moved none of it. So the bench's assist-only third is read by a
 * person, and the machine's job is to pre-sort for them.
 */
/**
 * `index` is a third-party CATALOGUE's statement of a side's fighters, arriving
 * already complete (scripts/fetch-theater.ts). It sits above `description` and
 * below `footage`, and both halves are arguments:
 *
 *  · ABOVE description, because it is not prose. A description bench is
 *    extracted from a sentence a re-uploader typed and has to be aligned to a
 *    side and split on a separator — which is the entire failure surface of
 *    that tier (see DescAlign). An index entry is discrete fields; nothing is
 *    aligned and nothing can be mis-split.
 *  · BELOW footage and human, because it is still somebody's transcription of a
 *    screen we can read ourselves. A curator watching at speed can swap two
 *    sides or miss a fourth pick, and the pixels settle that.
 *
 * THE ORDER OF THIS UNION IS DOCUMENTATION, NOT CONTROL FLOW. There is no rank
 * array and no index-of comparison anywhere in this repo: precedence is the
 * order of application in code (parse seeds `title` and overwrites with
 * `description`; complete-characters appends `footage`; the /dev endpoints
 * append `human`), and nothing ever downgrades a side. Adding a member here
 * therefore does NOT wire it up.
 */
export const CHAR_TIERS = ['title', 'description', 'index', 'footage', 'human', 'review'] as const;

export type CharTier = (typeof CHAR_TIERS)[number];

/** How the description's two sides were matched to the title's two sides.
 *  NEVER positional: hadoukenReplays reverses its second title slot on 27 of 34
 *  uploads, so assuming the description follows title order would compound one
 *  order error with another. */
export type DescAlign = 'handle' | 'character-subset' | 'ambiguous' | 'none';

/** Which order a title's side segment used. Telemetry, not control flow — the
 *  parser extracts the paren wherever it sits and takes the remainder as the
 *  handle, so it never has to CHOOSE an order. Recorded so a channel changing
 *  its grammar shows up as a shift in the mix instead of as silence. */
export type SlotOrder = 'handle-first' | 'chars-first' | 'parallel-lists';

/**
 * Per-side character provenance — the answer to "how did this record get its
 * characters", recorded at the moment it is decided.
 *
 * Tōkon sources characters from three tiers (titles carry 1–2 of 4;
 * descriptions carry the full bench on ~30% of the corpus; footage completes
 * the rest), so without this the question is unanswerable after the fact and a
 * regression in one tier is invisible.
 *
 * SUBSTRATE ONLY. The engine's `Side` is { player, players?, characters, rank? }
 * with no `extra` bag, and none should be made for this: the two-schema
 * boundary — a rich pipeline substrate projected down to a narrow emitted
 * contract — is what keeps the engine generic. scripts/emit.ts projects sides
 * field-by-field rather than spreading, so provenance cannot leak into
 * replays.json by construction; emit asserts that anyway.
 */
export interface CharProvenance {
  /** The tier that produced the FINAL list (the strongest that contributed). */
  tier: CharTier;
  /** Every tier that contributed, in the order applied. */
  tiers: CharTier[];
  /** Ids the TITLE stated. The seed of every TITLE-PARSED record, and so
   *  always present on one. An index intake parses no title — its title is
   *  synthesized FROM the catalogue's own character fields, so citing it as a
   *  source would be circular — and those sides carry `[]` here. */
  fromTitle: string[];
  /** Ids the DESCRIPTION bench stated for this side, once aligned. */
  fromDescription?: string[];
  /** Ids a third-party INDEX stated for this side, as discrete fields. No
   *  alignment step applies: the catalogue names the side. */
  fromIndex?: string[];
  /** Ids read from FOOTAGE for this side. */
  fromFootage?: string[];
  /** Ids a PERSON read off the HUD's bench-portrait cluster.
   *
   *  Authoritative over every automatic tier, including the description: 4 of 189
   *  hand-read slots named a fighter absent from BOTH of a record's described
   *  benches, and the pixels win. So a human read REPLACES a side's list rather
   *  than merging into it. */
  fromHuman?: string[];
  /** How the description was aligned to THIS side. */
  descAlign?: DescAlign;
  /** Which slot order this side's title segment used. */
  slotOrder?: SlotOrder;
  /** Tiers disagreed — a title-stated id absent from the bench, or vice versa.
   *  The union is kept (never silently drop what the title said) and the record
   *  is queued for review — WITHHELD, not published. This flag therefore only
   *  ever appears on a queue entry the reviewer is looking at, never on a side
   *  in videos.json: a union is what the two tiers *might* mean, and publishing
   *  it asserts a team neither source actually stated. */
  conflict?: boolean;
  /** characters.length >= charactersPerSide, i.e. the side's bench is fully
   *  known. `>=` and not `===`: `characters` is a union of 1..N in
   *  first-appearance order, so a mid-set team change can push a side past the
   *  cap and such a side is complete, not incomplete. */
  complete: boolean;
  /** Extractor confidence, when tier === 'footage'. */
  confidence?: number;
}

/** One parsed side: one pilot, and every character they fielded.
 *
 *  Tōkon is 4v4 tag, so a saturated side holds FOUR. It is a union of 1..N in
 *  first-appearance order, not a fixed-length tuple:
 *   · fewer than 4 is a partially-known bench — true, publishable data. Titles
 *     alone give 1–2, and the bench fills in over time as the description and
 *     footage tiers land. The engine renders 1..N natively.
 *   · MORE than 4 is a mid-set team change. Legal data, counted in
 *     characterUsage, and excluded from any future pairing surface with the
 *     excluded count reported — naive C(n,2) over an oversize side fabricates
 *     pairs that were never played, and fabrication poisons a synergy panel
 *     silently while under-counting stays recoverable.
 *   · ZERO is the only failure, and emit hard-fails on it. */
export interface MatchSide {
  /** Player id (slug of handle). */
  player: string;
  /** Display handle, nicest casing seen (descriptions beat ALL-CAPS titles). */
  handle: string;
  /** Roster character ids (data/characters.json), 1..N, first-appearance order. */
  characters: string[];
  /** How this side's characters were sourced. Substrate only — never emitted. */
  provenance: CharProvenance;
}

/** The committed parse substrate (data/videos.json): only structurally parsed
 *  matches enter it; misses are reported, not stored. */
export interface MatchVideo {
  id: string;
  /** Resolved source (Replay.source), not the intake channel. */
  channel: SourceId;
  /** The INTAKE channel — the dedupe key (checklist step 2). Carried on the
   *  record because channel priority and override protection are both keyed on
   *  it, and a shared public token would break both silently. */
  intake: ChannelKey;
  title: string;
  publishedAt: string;
  durationSec: number;
  viewCount?: number;
  /** Balance era, resolved from the date boundaries. Season 1 opened at launch
   *  and nothing else exists yet.
   *
   *  Unlike SF6 there IS a weak label signal here — highLevelReplays writes
   *  "(Season 1)" into its descriptions — but the date remains the authority
   *  and the label is only cross-checked, with disagreements counted in the
   *  report. A label that contradicts the calendar is an uploader's typo, not
   *  a boundary. */
  season: number;
  /** The YouTube id, when `id` is not it. A record is not required to be a
   *  whole video: an index intake publishes many records per VOD, so their ids
   *  are `${videoId}@${startSeconds}` and the YouTube id lives here. Every
   *  YouTube-shaped URL the engine builds resolves `videoId ?? id`. */
  videoId?: string;
  /** Where this record's footage starts inside `videoId`, in seconds. Absent
   *  (or 0) means the whole video. */
  startSeconds?: number;
  sides: [MatchSide, MatchSide];
}

/** data/source-pins.json — the carry pin for every `localFirst` intake, keyed
 *  by ChannelKey. Written by the rebuild, hard-asserted by every parse. A
 *  frozen channel pins in channels.ts instead, because its count never moves
 *  again; a local-first source grows, so hand-editing a constant every refresh
 *  would be friction that teaches people to skip the check. */
export type SourcePins = Partial<Record<ChannelKey, number>>;

/** data/players.json entry (mirrors the engine's Player). */
export interface PlayerRecord {
  id: string;
  handle: string;
  featured?: boolean;
  extra?: { aliases?: string[] };
}

/** data/characters.json entry (mirrors the engine's Character). `aliases` is
 *  the shared search/parse key — the app's search vocabulary and the parser's
 *  vocabulary are the same data, which is why a new nickname only has to be
 *  added once. */
export interface CharacterRecord {
  id: string;
  name: string;
  imgPortrait: string;
  imgSplash?: string;
  accent: string;
  extra?: { aliases: string[]; [k: string]: unknown };
}

/** Per-video manual corrections (data/overrides.json). A hand verdict beats
 *  every automatic tier. */
export type VideoOverride = Partial<Pick<MatchVideo, 'season' | 'sides' | 'channel'>> & {
  /** Free-text provenance note. JSON has no comment syntax and this file is
   *  read by humans as often as by code, so an entry says how it got there. */
  '//'?: string;
  exclude?: boolean;
  /** Who resolved this. 'extractor' marks a machine resolution, which only
   *  happens at or above auto-accept AND on a decided side.
   *
   *  Load-bearing for dedupe: extraction-origin overrides confer NO dedupe
   *  priority (only hand-authored ones protect a record), so the priority check
   *  must test THIS field — not the mere presence of `sides`. Testing for
   *  `sides` would make every extracted record beat every duplicate and
   *  silently invert declared channel precedence. */
  resolvedBy?: 'extractor' | 'human';
  /** The extractor's confidence when it resolved this (0..1). */
  confidence?: number;
  /** Signed vote margin from reading the HUD to decide which side each handle
   *  sat on. Recorded because attribution is the half of a footage-read record
   *  that no character-confidence number covers: the characters can be perfect
   *  while the players are swapped. Positive = the title's first-named player
   *  was on the left. */
  sideVotes?: number;
};

/** One pending item in data/review-queue.json — footage the pipeline refuses to
 *  publish. REGENERATED by every parse run (derived state: resolutions live
 *  solely in overrides.json, so the queue self-clears as verdicts land).
 *  Pending items NEVER reach videos.json or replays.json.
 *
 *  Kinds:
 *   'character-completion' — match-shaped footage whose characters no text states.
 *   'bench-conflict'       — title and description disagree about a side. Held
 *                            like the rest: a union of two disagreeing tiers is
 *                            unresolved data, not partial data, so it is not
 *                            the bench queue's case.
 *   'slot-ambiguous'       — a side segment carried 2+ parens, so which one names
 *                            the characters is a guess. Never guessed. */
export interface ReviewQueueItem {
  id: string;
  kind: 'character-completion' | 'bench-conflict' | 'slot-ambiguous';
  channel: ChannelKey;
  title: string;
  publishedAt: string;
  durationSec: number;
  /** Handles the title DID state, canonicalised against players.json.
   *  Pre-fills the review form so a reviewer answers only the characters — and,
   *  more importantly, stops a verdict minting a second player page under a
   *  different spelling of an existing player. */
  handles?: [string, string];
  /** For 'bench-conflict': what each tier claimed, so the reviewer sees the
   *  disagreement rather than re-deriving it. */
  conflict?: { side: 0 | 1; fromTitle: string[]; fromDescription: string[] };
}

/**
 * One item in data/bench-queue.json — a record that IS published but whose
 * bench is incomplete (fewer than 4 known on at least one side).
 *
 * WHY THIS IS A SEPARATE FILE FROM THE REVIEW QUEUE. The engine MUST is
 * "pending items never reach replays.json — an unresolved item is absent from
 * the site, not present-and-guessed." A side with 2 of 4 fighters is not a
 * guess; it is true-but-incomplete data, which the contract explicitly blesses
 * (`characters` is 1..N, emit hard-fails only on 0). Overloading the review
 * queue with these would force one of two bad outcomes: hold ~70% of the corpus
 * off the site, or break the "pending never ships" invariant on the very file
 * that invariant is asserted against. So: review-queue = not publishable,
 * bench-queue = published and improvable. The extractor's worklist is this one.
 *
 * (Reported upstream as a new-game-checklist gap — the checklist knows only one
 * queue because it assumes titles-or-footage, with nothing in between.)
 */
export interface BenchQueueItem {
  id: string;
  channel: ChannelKey;
  title: string;
  publishedAt: string;
  durationSec: number;
  /** How many characters are known per side right now, e.g. [2, 4]. */
  known: [number, number];
  /** The tier that got each side to its current state. */
  tiers: [CharTier, CharTier];
}

/** One balance era. Season 1 opened at launch; there is no second yet. */
export interface SeasonBoundary {
  season: number;
  start: string; // ISO date, inclusive
  end: string | null; // exclusive; null = open (current season)
  confirmed: boolean;
  /** Facet-parent display label. Defaults to `Season ${season}`, which reads
   *  wrong for the pre-release era — "Season 0" names a balance era the vendor
   *  never shipped. Set it there and nowhere else. */
  label?: string;
  note?: string;
}

/**
 * One released Tōkon patch.
 *
 * THE VENDOR PUBLISHES NO VERSION STRING. Arc System Works / Sony ship
 * date-titled posts on the Steam news hub — "Patch Update 8/10/2026" — and
 * nothing else: no semver, no build id, no update-history page. The one
 * version-shaped number in circulation (`1.002.002`) is a press report of a
 * PS5 system build, never vendor-published, and is deliberately not used.
 *
 * So the token IS the date, ISO-normalised for URL and sort stability. The
 * checklist's "never invent a version to fill a sequence gap" still holds and
 * gets stricter here: with dates there is no sequence to feel obliged to fill,
 * and `announcedOn` records where each row was found so an undocumented row is
 * visible rather than plausible.
 *
 * (Reported upstream as a checklist gap: step 4 assumes a version grammar
 * exists.)
 */
export interface PatchBoundary {
  /** ISO date, e.g. '2026-08-10' — unique, and never an era token. */
  version: string;
  /** ISO release day, inclusive. Equals `version`; the validator asserts it. */
  start: string;
  /** Where the vendor announced it. An undocumented row cannot hide.
   *
   *  'event' is the pre-release case and reads differently from the rest: that
   *  build was EXPOSED at a tournament, never announced anywhere. Recording it
   *  as its own value keeps the honest distinction — nobody can later mistake a
   *  playable-on-a-show-floor build for a published patch. */
  announcedOn: 'steam' | 'x' | 'discord' | 'launch' | 'event';
  /** Builds shipped inside this window that the vendor did not post
   *  separately, recorded so they are declared rather than silently absorbed. */
  includes?: string[];
  /** Short community-facing hint, surfaced beside the child in the dropdown. */
  note?: string;
}

/** A patch plus its computed window and resolved era. */
export interface PatchWindow extends PatchBoundary {
  /** exclusive end: the next patch's start within the era, else the era's end,
   *  else null (open). Computed, never authored. */
  end: string | null;
  season: number;
}

/** A time-bomb that has gone off: something the data can tell us is due, rather
 *  than something a human has to remember. See scripts/expiries.ts. */
export interface Expiry {
  kind: 'unreleased-character' | 'unconfirmed-season' | 'stale-patch-table';
  /** roster id, `S${n}` for a season row, or 'patch-table' */
  id: string;
  /** the ISO date that has now passed */
  date: string;
  /** what a human must do to clear it */
  action: string;
}
