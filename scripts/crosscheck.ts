// THE SECOND WITNESS, as a pure predicate.
//
// WHAT THIS MEASURES, and why it is worth a file. Replay Theater's catalogue is
// mostly NOT tournament footage: of the 236 Tōkon entries a sweep saw, 44 carry
// an event tag and the other 192 are online ranked play. Those are out of
// INGESTION scope by design — this repo already carries six channels of exactly
// that, and what it had none of was tournament sets, which is the whole reason
// the index intake exists.
//
// But out of ingestion scope is not out of scope as EVIDENCE. Measured
// 2026-08-31: 111 of the catalogue's rows point at a video THIS REPO HAS
// ALREADY PUBLISHED from a tracked channel — 101 from highLevelReplays, 8 from
// proReplays, 2 from hadoukenReplays. Each one is an independent human reading
// of the same match: a stranger typed two handles and eight fighters into a
// form, and our parser read them out of the uploader's title. Neither saw the
// other.
//
// That makes this the first continuous accuracy measurement of this repo's own
// title parser against something that is not us. Every other number in
// report.md — the provenance tiers, the side-size distribution, the residue —
// is the pipeline grading its own homework.
//
// FIRST MEASUREMENT, 2026-08-31, against a stand-in witness built from the 236
// Tōkon rows in raw/.replayTheater.partial.json (the real
// raw/replayTheater.witness.json lands with the next pull; the stand-in is the
// same rows in the same shape):
//   players (both handles)   111 / 111   100.00%
//   fighters (per side)      221 / 222    99.55%   0 disagreements, 1 unwitnessable
//   side order differed on 3 records; the comparison realigns on handles first.
//
// IT PRODUCES NO FIELD AND GATES NOTHING. A disagreement is written to
// data/theater-disagreements.json with both claims side by side; it never edits
// a record, never outranks a confident parse, and never outranks a human
// override. In particular it does NOT touch CharProvenance: `fromIndex` is
// populated only on records the index intake itself CREATED, and the two
// witnesses deliberately never meet on the same row. RT is a witness, not an
// authority — the same posture the intake already takes when it resolves
// characters on an exact alias only and drops the rest to residue.
//
// THE THIRD OUTCOME IS THE POINT, AND IN THIS GAME THE CEILING IS REAL. agree /
// disagree is not enough, because a witness that CANNOT REPRESENT the answer is
// not disagreeing with it. The catalogue carries exactly four character columns
// per side and fills all four on 100% of its rows (472 of 472 sides, measured
// the same day). A side here is a union of 1..N and 7 of the corpus's sides hold
// five or six — a mid-set team change, which report.md already counts and emit
// already excludes from pairing. One of those 7 is inside the compared
// population, and it is not a row the catalogue declined to report; it is a row
// it could not have said. Scoring it as a disagreement would make agreement
// structurally unreachable for exactly the records a resolver would want to
// look at. It is counted as `cannotWitness`, in a column of its own.
//
// THE REALIGNMENT AND THE CEILING ARE THE WHOLE DIFFERENCE, and that is
// measurable rather than asserted. A comparison that skipped both — normalise
// the catalogue's string, normalise our id, compare — reports 7 character
// disagreements on this population. Six of them are the three records whose
// p1/p2 is the reverse of ours, counted twice each; the seventh is that side of
// six. Zero are real.
//
// EXACT ALIAS, NEVER FUZZY, even though it costs nothing here YET. The
// catalogue's whole Tōkon vocabulary today is 21 distinct strings against a
// 21-fighter roster, and the roster's own alias table covers all 21 — so on this
// corpus the alias table and a naive lowercase-and-strip resolve identically,
// and saying otherwise would be borrowing the sibling's number. What the rule
// buys is the day that stops being true, and this repo already has the shape on
// file: report.md's "Unmatched text in character slots" lists `C.America`,
// `P.Parker` and `B.Panther` — spellings no alias covers. Under the alias table
// such a string is `cannotWitness`, a witness we decline to read. Under a
// normaliser it silently becomes a disagreement about our parse. The sibling SF6
// corpus is what that looks like at scale: 1,236 spurious disagreements naive,
// 7 through the alias table. Never reach for the title parser's fuzzy ladder
// here — its job is to read prose out of a sentence, and a witness that guesses
// is not a witness; a guessing witness agrees with the parser it is checking.

import type { MatchVideo } from '../types/index';

/** One catalogue entry, exactly as the catalogue publishes it. Everything is
 *  nullable: this is someone else's schema and we do not get to assume. */
export interface WitnessEntry {
  id?: number;
  game?: string | null;
  video_link?: string | null;
  tag?: string | null;
  p1_name?: string | null;
  p2_name?: string | null;
  p1_char?: string | null;
  p1_char2?: string | null;
  p1_char3?: string | null;
  p1_char4?: string | null;
  p2_char?: string | null;
  p2_char2?: string | null;
  p2_char3?: string | null;
  p2_char4?: string | null;
}

/** raw/replayTheater.witness.json, written by scripts/fetch-theater.ts. */
export interface WitnessFile {
  mode?: 'cursor' | 'full';
  maxEntryId?: number;
  pagesRead?: number;
  hitBound?: boolean;
  entries?: WitnessEntry[];
}

/** One row the cross-check could not settle, carrying BOTH claims. This is the
 *  whole output — never a rewritten record. */
export interface Disagreement {
  videoId: string;
  field: 'players' | 'characters';
  /** 0 or 1, in our record's side order. Absent for a whole-record player miss. */
  side?: number;
  ours: string[];
  theirs: string[];
  title: string;
}

export interface CrossCheckResult {
  /** Videos where exactly one catalogue entry lines up with one of our
   *  whole-video records. A video the catalogue has cut into several segments is
   *  excluded: those are the index intake's own territory and there is no 1:1
   *  claim to compare against. */
  compared: number;
  /** Catalogue videos we do not hold as a whole-video record. Not a failure —
   *  it is most of the catalogue — but the denominator of "reach". 86 of 197 on
   *  2026-08-31, and five of those are the tournament VODs the catalogue
   *  segments: this repo holds those only as `${videoId}@${startSeconds}`
   *  segments, so they never reach the `segmented` bucket below. */
  unmatched: number;
  /** Videos we hold as ONE record that the catalogue indexes as several. Zero
   *  here today for the reason above, and it stays a separate number because the
   *  day one of those VODs is also published whole by a tracked channel, the
   *  reason it is excluded is different from "we do not hold it". */
  segmented: number;
  players: { both: number; one: number; neither: number; flipped: number };
  characters: {
    sides: number;
    agree: number;
    subset: number;
    disagree: number;
    cannotWitness: number;
  };
  disagreements: Disagreement[];
}

/** The YouTube id inside a catalogue link. The catalogue's submission form
 *  concatenates rather than builds — `https://youtu.be/<id>&t=554s` is a PATH
 *  with no query string — so this matches the id SHAPE explicitly and refuses
 *  anything else rather than guessing. The same regex the intake uses, kept
 *  literally identical: a join key that read links differently from the intake
 *  would compare rows the intake never saw. */
const VIDEO_ID =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/(?:live|shorts|embed)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

/** A side's declared fighters, in slot order, blanks dropped. Four columns —
 *  the same four scripts/fetch-theater.ts reads, and the reason `sideCap` has a
 *  number to be. */
const charsOf = (e: WitnessEntry, side: 1 | 2): string[] =>
  ([`p${side}_char`, `p${side}_char2`, `p${side}_char3`, `p${side}_char4`] as const)
    .map((k) => (e as unknown as Record<string, unknown>)[k])
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    .map((c) => c.trim());

const setEq = (a: string[], b: string[]): boolean => {
  const A = new Set(a);
  const B = new Set(b);
  return A.size === B.size && [...A].every((x) => B.has(x));
};
const subsetOf = (a: string[], b: string[]): boolean => a.every((x) => b.includes(x));

/**
 * @param witness      every entry the pull saw, tagged and untagged
 * @param committed    our published records (post-override — what videos.json
 *                     actually holds, so a disagreement always names a row a
 *                     visitor can open)
 * @param byAlias      the roster's exact-alias table: display name → roster id
 * @param resolveKey   this repo's player identity key (scripts/players.ts)
 * @param stripSponsor the catalogue's own handle cleanup (scripts/channels.ts),
 *                     applied to its strings and not to ours — ours were
 *                     stripped when the record was built
 * @param sideCap      how many characters the CATALOGUE can express per side.
 *                     Four columns, and this game's sides regularly reach four
 *                     and occasionally exceed it, which is why the ceiling is a
 *                     live outcome here rather than a defensive one.
 */
export function crossCheck(
  witness: WitnessFile,
  committed: MatchVideo[],
  byAlias: Map<string, string>,
  resolveKey: (h: string) => string,
  stripSponsor: (h: string) => string,
  sideCap = 4,
): CrossCheckResult {
  // Only WHOLE-VIDEO records are comparable. This repo's index-intake records
  // are `${videoId}@${startSeconds}` segments built FROM this catalogue, so
  // checking them against it would be checking it against itself.
  const ours = new Map<string, MatchVideo>();
  for (const v of committed) if (!v.id.includes('@')) ours.set(v.id, v);

  const byVideo = new Map<string, WitnessEntry[]>();
  for (const e of witness.entries ?? []) {
    const m = VIDEO_ID.exec(e.video_link ?? '');
    if (!m) continue;
    byVideo.set(m[1]!, [...(byVideo.get(m[1]!) ?? []), e]);
  }

  const r: CrossCheckResult = {
    compared: 0,
    unmatched: 0,
    segmented: 0,
    players: { both: 0, one: 0, neither: 0, flipped: 0 },
    characters: { sides: 0, agree: 0, subset: 0, disagree: 0, cannotWitness: 0 },
    disagreements: [],
  };

  for (const [videoId, entries] of byVideo) {
    const mine = ours.get(videoId);
    if (!mine) {
      r.unmatched++;
      continue;
    }
    // The catalogue cut this VOD into segments. Our record is the whole video,
    // so there is no single claim to compare against — and those rows are the
    // index intake's own anyway.
    if (entries.length > 1) {
      r.segmented++;
      continue;
    }
    const e = entries[0]!;
    r.compared++;

    // ONE HANDLE PER SIDE, NEVER SPLIT. The reference splits `p1_name` on
    // `/`, `&` and `+` because its game has team-battle rows with two humans a
    // side. This one does not: a side here is one player with a team of up to
    // four fighters, which is exactly why scripts/channels.ts STRIPS the
    // sponsor prefix rather than splitting on it — "NP | Senshi" is one person,
    // and splitting would mint a player called "NP".
    const theirSides = ([1, 2] as const).map((n) => ({
      players: [resolveKey(stripSponsor(String(e[`p${n}_name`] ?? '')))].filter(Boolean),
      chars: charsOf(e, n),
    }));
    const ourSides = mine.sides.map((s) => ({
      players: [resolveKey(s.handle)],
      chars: s.characters,
    }));

    // ORIENTATION. The catalogue's p1/p2 is the submitter's reading of the
    // screen and ours is the title's; they usually agree but not always, and
    // comparing characters across a swapped pair would manufacture two
    // disagreements out of none — and in a game where a side carries four
    // fighters, two swapped sides are eight wrong fighters. Aligned on the
    // handles, which is the field the two sources agree on most.
    const score = (a: typeof ourSides, b: typeof theirSides) =>
      a.reduce((n, s, i) => n + (s.players.some((p) => b[i]!.players.includes(p)) ? 1 : 0), 0);
    const flipped = score(ourSides, [theirSides[1]!, theirSides[0]!]) > score(ourSides, theirSides);
    const theirs = flipped ? [theirSides[1]!, theirSides[0]!] : theirSides;
    if (flipped) r.players.flipped++;

    const hits = ourSides.reduce(
      (n, s, i) => n + (s.players.some((p) => theirs[i]!.players.includes(p)) ? 1 : 0),
      0,
    );
    if (hits === 2) r.players.both++;
    else if (hits === 1) r.players.one++;
    else {
      r.players.neither++;
      r.disagreements.push({
        videoId,
        field: 'players',
        ours: ourSides.flatMap((s) => s.players),
        theirs: theirs.flatMap((s) => s.players),
        title: mine.title,
      });
    }

    for (let i = 0; i < 2; i++) {
      r.characters.sides++;
      const mineChars = ourSides[i]!.chars;
      // EXACT ALIAS ONLY. A catalogue string the roster does not know is not a
      // disagreement — it is a witness we cannot read, and guessing at it is how
      // a second witness quietly becomes a second parser. Same rule the intake
      // applies when it drops an unresolved slot to residue rather than
      // approximating it.
      const raw = theirs[i]!.chars;
      const resolved = raw.map((c) => byAlias.get(c.toLowerCase()));
      if (raw.length === 0 || resolved.some((x) => x === undefined)) {
        r.characters.cannotWitness++;
        continue;
      }
      // THE SCHEMA CEILING, AND IT IS REAL IN THIS GAME. The catalogue carries
      // `sideCap` character columns and fills all four on essentially every
      // row. A side of ours that is LONGER than that is a mid-set team change —
      // five or six fighters, which report.md counts and emit excludes from
      // pairing. It is not something the catalogue declined to report; it is
      // something it could not have said.
      if (mineChars.length > sideCap) {
        r.characters.cannotWitness++;
        continue;
      }
      const theirChars = resolved as string[];
      if (setEq(mineChars, theirChars)) r.characters.agree++;
      // PARTIAL, not agreement and not a disagreement. Our side is 1-of-4 until
      // something drains it — the bench queue is the whole apparatus for that —
      // so "we say Wolverine, they say Wolverine + three more" is the bench
      // backlog showing through, not a contradiction.
      else if (subsetOf(mineChars, theirChars) || subsetOf(theirChars, mineChars))
        r.characters.subset++;
      else {
        r.characters.disagree++;
        r.disagreements.push({
          videoId,
          field: 'characters',
          side: i,
          ours: mineChars,
          theirs: theirChars,
          title: mine.title,
        });
      }
    }
  }
  return r;
}

const pct = (n: number, total: number) =>
  total === 0 ? '—' : `${((n / total) * 100).toFixed(2)}%`;

/** The report.md block. Frozen per run: every number is computed from THIS
 *  run's witness and THIS run's records, and nothing is carried between runs. */
export function formatCrossCheck(r: CrossCheckResult, mode: string | undefined): string[] {
  if (r.compared === 0) return [];
  const c = r.characters;
  return [
    '## Replay Theater cross-check',
    '',
    `An independent reading of **${r.compared}** of our own records, from the catalogue's`,
    'UNTAGGED entries — online replays it indexes that we also parse from a tracked',
    'channel. Neither side saw the other, so this is the only accuracy number on this',
    'page the pipeline did not produce about itself. It changes nothing: a disagreement',
    'is recorded in data/theater-disagreements.json with both claims and is never',
    'written into a record. The catalogue does not outrank a confident parse and never',
    'outranks a human override.',
    '',
    `_Measured this run against a ${mode ?? 'partial'} pull. ${r.unmatched} catalogue entr(ies) point at videos_`,
    `_we do not hold; ${r.segmented} are VODs the catalogue segments, which the index intake owns._`,
    '',
    '| field | population | agree | partial | disagree | cannot witness |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    `| players (both handles) | ${r.compared} | ${r.players.both} (${pct(r.players.both, r.compared)}) | ${r.players.one} | ${r.players.neither} | — |`,
    `| fighters (per side) | ${c.sides} | ${c.agree} (${pct(c.agree, c.sides)}) | ${c.subset} | ${c.disagree} (${pct(c.disagree, c.sides)}) | ${c.cannotWitness} |`,
    '',
    '**Cannot witness** is not disagreement. The catalogue holds four character columns',
    'a side; a side of ours that is longer — a mid-set team change — is something it',
    'could not have said, and a catalogue string no roster alias covers is a witness we',
    'decline to read rather than guess at. Both are counted here and neither is scored',
    'against the parser.',
    '',
    `Side order differed on **${r.players.flipped}** record(s); the comparison realigns on the`,
    'handles before reading fighters, so a swapped pair is not counted twice — here,',
    'eight times — as a character disagreement.',
    '',
    ...(r.disagreements.length
      ? [
          `**${r.disagreements.length} disagreement(s)** — both claims, ours first:`,
          '',
          ...r.disagreements
            .slice(0, 25)
            .map(
              (d) =>
                `- \`${d.videoId}\`${d.side !== undefined ? ` side ${d.side}` : ''} ${d.field}: ` +
                `**${d.ours.join(', ') || '(none)'}** vs catalogue **${d.theirs.join(', ') || '(none)'}** — ${d.title.slice(0, 70)}`,
            ),
          ...(r.disagreements.length > 25 ? [`- … ${r.disagreements.length - 25} more`] : []),
          '',
        ]
      : ['No disagreements this run.', '']),
  ];
}
