<template>
  <ClientOnly>
    <section class="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-[26px]">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <p class="font-mono text-label uppercase text-text-muted">Curation — dev only</p>
          <h1 class="mt-1 font-display text-d2 font-bold text-text">Bench queue</h1>
        </div>
        <p class="font-mono text-[12px] text-text-muted">
          {{ done }}/{{ total }} sides drained
          <button
            type="button"
            class="ml-2 cursor-pointer underline"
            :class="showResolved ? 'text-primary' : 'text-text-muted'"
            @click="
              showResolved = !showResolved;
              cursor = 0;
            "
          >
            {{ showResolved ? 'back to open' : 'show drained' }}
          </button>
          <span
            v-if="awaiting.length"
            class="ml-2 text-warning"
            :title="awaiting.join('\n')"
            >· {{ awaiting.length }} record(s) awaiting footage</span
          >
        </p>
        <p class="ml-auto font-mono text-[12px] text-text-muted">
          ⏎ save · ←/→ move · type in a box to jump to a fighter
        </p>
      </div>

      <nav class="strip">
        <button
          v-for="(it, k) in items"
          :key="it.i"
          class="tick"
          :class="{ on: it.done && !it.recheck, re: it.done && it.recheck, cur: k === cursor }"
          @click="cursor = k"
        />
      </nav>

      <p
        v-if="pending"
        class="mt-6 font-mono text-body text-text-muted"
      >
        loading…
      </p>
      <p
        v-else-if="error"
        class="mt-6 font-mono text-body text-warning"
      >
        {{ error }}
      </p>
      <!-- Empty is not the same as drained: a record the cron added from its
           title has no footage to show until a catchup downloads it. -->
      <p
        v-else-if="!cur && awaiting.length && !showResolved"
        class="mt-6 font-mono text-body text-warning"
      >
        nothing to read yet — {{ awaiting.length }} queued record(s) have no footage downloaded. Run
        <code>npm run data:catchup</code>, then reload.
      </p>
      <p
        v-else-if="!cur"
        class="mt-6 font-mono text-body text-text-muted"
      >
        bench queue is empty 🎉
      </p>

      <section
        v-else
        class="item"
      >
        <div
          v-for="(f, fi) in [0, 1]"
          :key="f"
          class="panel"
        >
          <p class="head">
            frame {{ fi === 0 ? 'A' : 'B' }} ·
            <span
              v-if="cur.points[fi]"
              class="pt"
              >on point {{ cur.points[fi]!.name }}</span
            >
            <span
              v-else
              class="warn"
              >the plate read nothing — read the bust too</span
            >
          </p>
          <img
            class="crop"
            :src="`/api/dev/portrait-crop?video=${cur.video}&sec=${secOf(fi)}&side=${cur.side}`"
            :alt="`side ${cursor + 1} frame ${fi}`"
          />
          <!-- A sampled frame can land on a cinematic or a super flash where the
               cluster is not drawn at all. Stepping costs nothing: every one of
               these seconds is already on disk. -->
          <p class="stepper">
            <button
              class="step"
              @click="stepFrame(fi, -1)"
            >
              ◀
            </button>
            <span class="dim mono"
              >{{ secOf(fi) }}s · {{ frameIdx[fi]! + 1 }}/{{ cur.allSecs.length }}</span
            >
            <button
              class="step"
              @click="stepFrame(fi, 1)"
            >
              ▶
            </button>
          </p>
          <div
            v-for="(letter, k) in slotsFor(fi)"
            :key="letter"
            class="slot"
          >
            <span
              class="letter"
              :class="{ bust: letter === '◆' }"
              >{{ letter }}</span
            >
            <select
              v-model="picks[fi]![k]"
              class="sel"
            >
              <option value="">— pick —</option>
              <option
                v-for="r in roster"
                :key="r.id"
                :value="r.id"
              >
                {{ r.name }}
              </option>
            </select>
          </div>
        </div>

        <div class="actions">
          <!-- The title, shown. Every refusal below is a judgement about it, and
               until 2026-10-14 the page never displayed it: dE1pzpogWsU's title
               hands NITRO's Black Panther to K7, which is plain the moment the
               title and the HUD are on one screen. -->
          <div class="titlebox">
            <p class="ttl">{{ cur.title }}</p>
            <p
              v-for="(ts, k) in cur.titleSides"
              :key="k"
              class="dim"
            >
              <span :class="{ here: (cur.sideIndex ?? sideIndex) === k }"
                >side {{ k + 1 }} · {{ ts.handle }}</span
              >
              — the title names
              {{ ts.claim.length ? ts.claim.map((c) => c.name).join(', ') : 'no fighter' }}
              <span
                v-if="ts.refuted.length"
                class="warn"
              >
                · ruled wrong: {{ ts.refuted.map((c) => c.name).join(', ') }}</span
              >
            </p>
          </div>
          <!-- The plate could not say which player this screen side is, so the
               handle under the health bar is the evidence and the reviewer reads
               it. Never inferred from title order: one uploader reverses its
               second title slot on 27 of 34 videos. -->
          <div
            v-if="cur.needs.side"
            class="attrib"
          >
            <p class="warn">Which player is this side?</p>
            <!-- The whole top quadrant, because the handle moves: under the health
                 bar in some uploads, in a banner above it in others, and inside a
                 channel's own overlay in others again. A band tuned to one layout
                 returned gameplay for the rest. -->
            <p class="dim">
              Handle placement varies by upload — look anywhere in this quadrant. Step the frames
              above if it is not drawn at this moment, or open the source linked below.
            </p>
            <img
              class="side-strip"
              :src="`/api/dev/portrait-crop?video=${cur.video}&sec=${secOf(0)}&side=${cur.side}&strip=1`"
              alt="this side's top corner"
            />
            <div class="acts">
              <button
                v-for="(h, hi) in cur.handles"
                :key="hi"
                class="who"
                :class="{ on: sideIndex === hi }"
                @click="sideIndex = hi"
              >
                {{ h }}
              </button>
            </div>
          </div>
          <p
            v-if="cur.known.length"
            class="dim"
          >
            already known: {{ cur.known.map((k) => k.name).join(', ') }}
          </p>
          <p
            v-if="restored === 'exact'"
            class="restored"
          >
            saved earlier — showing exactly what you picked
          </p>
          <p
            v-else-if="restored === 'derived'"
            class="restored"
          >
            saved earlier — fighters are exact; frame B's A/B/C order is reconstructed, since that
            save predates recording it
          </p>
          <p
            v-if="cur.savedPicks?.forced"
            class="warn"
          >
            this one was saved with <em>use frame A anyway</em>
          </p>
          <p
            v-if="cur.savedRefuted"
            class="warn"
          >
            saved with the title ruled wrong:
            <strong>{{ cur.savedRefuted.ids.map((c) => c.name).join(', ') }}</strong>
            [{{ cur.savedRefuted.at }}]<br />
            <span class="dim">{{ cur.savedRefuted.why }}</span>
          </p>
          <p
            v-if="cur.recheck"
            class="warn"
          >
            This side is complete but FAILS its own control — the title names a fighter the saved
            reading does not include, and nobody recorded that the title is wrong. Re-read it.
          </p>
          <div
            v-if="titleMissing"
            class="warn"
          >
            <p>
              The title names <strong>{{ namesOf(titleMissing) }}</strong> on this side and your
              reading does not include them.
            </p>
            <p
              v-if="missingOpposite.length"
              class="dim"
            >
              The plate read <strong>{{ namesOf(missingOpposite) }}</strong> on the OTHER player's
              side. Check the attribution first; if it is right, the title put that fighter on the
              wrong player.
            </p>
            <p class="dim">
              If the attribution is right, there are two honest answers. A mid-set team change: the
              title witnesses that fighter, the frames witness the rest, and both are true — keep
              both. Or the title is simply wrong — say what shows it, and it is recorded on the side
              rather than silently dropped.
            </p>
            <button
              class="act union"
              @click="saveKeepingTitled()"
            >
              also keep {{ namesOf(titleMissing) }} — team changed
            </button>
            <!-- "drop them and save" stood here and recorded nothing, so the side
                 failed e2e forever and nobody could tell a verdict from a misread.
                 The verdict needs its evidence; the server refuses it without. -->
            <div class="refute">
              <label
                class="dim"
                for="refute-why"
                >the title is wrong — what shows it?</label
              >
              <textarea
                id="refute-why"
                v-model="refuteWhy"
                class="why"
                rows="3"
                placeholder="the HUD handle, the plate, the description, another upload of the same match…"
              />
              <label class="dim check">
                <input
                  v-model="refuteWholeSlot"
                  type="checkbox"
                />
                the whole slot was copied from another video — refute every fighter it names, even
                one this player really fielded
              </label>
              <button
                class="force"
                :disabled="!refuteWhy.trim() || busy"
                @click="saveTitleWrong()"
              >
                the title is wrong — record it
              </button>
            </div>
          </div>
          <p
            v-if="disagree"
            class="warn"
          >
            The two frames read different benches.<br />
            A: {{ disagree.a.join(', ') }}<br />
            B: {{ disagree.b.join(', ') }}<br />
            <span class="dim">
              If the team CHANGED between games, both readings are true and the side really did
              field more than four — keep both. Use frame A only when frame B was misread. </span
            ><br />
            <button
              class="act union"
              @click="save({ union: true })"
            >
              both — the team changed mid-set
            </button>
            <button
              class="force"
              @click="save({ useFrameA: true })"
            >
              use frame A anyway
            </button>
          </p>
          <p
            v-if="refused"
            class="warn"
          >
            <strong>Refused — nothing was written.</strong><br />
            {{ refused }}<br />
            <span class="dim">
              When the two frames are far apart, check the point fighter in each header: if they
              name the two DIFFERENT players, the quadrant changed hands between games and the
              frames belong to different sides. Step frame B back into the same game as frame A, or
              use frame A alone.
            </span>
          </p>
          <button
            class="save"
            :disabled="!ready || busy"
            @click="save()"
          >
            {{ busy ? 'saving…' : cur.done ? 're-save side' : 'save side' }}
          </button>
          <p class="dim note">
            A person's read REPLACES this side — it does not merge with the description. Four of 189
            hand-read slots named a fighter absent from both described benches, so when the pixels
            and the prose disagree the pixels win.
          </p>
          <!-- Always shown, not only when attribution is asked for: an uploader's
               title can be wrong, and the upload itself is the tiebreaker. LAST in the
               column so it is also last in tab order: tabbing out of the final pick
               must reach "save side" without stopping on a link first. -->
          <p class="source">
            <a
              class="src"
              :href="`https://www.youtube.com/watch?v=${cur.video}&t=${secOf(0)}`"
              target="_blank"
              rel="noreferrer"
              >youtube.com/watch?v={{ cur.video }} · {{ secOf(0) }}s ↗</a
            >
          </p>
        </div>
      </section>
    </section>
  </ClientOnly>
</template>

<script setup lang="ts">
/**
 * Dev-only: drain the bench queue by reading the HUD's portrait cluster.
 *
 * This is the tier that ships. The portrait READER was built, measured and stopped —
 * a fighter's own bench icon varies by 20-24 bits across matches while different
 * fighters differ by only 26-29 — so nothing here suggests an answer from a hash.
 * The nameplate reader still supplies the point fighter, which is why three picks
 * complete a side of four.
 *
 * Two frames from different bursts, compared as SETS. The icons permute between
 * cells, so cell-by-cell comparison would flag disagreements that are not
 * disagreements; what must match is who is on the team.
 */

// Declares this tool on the /dev index (engine app/pages/dev/index.vue). Every
// value MUST stay a plain quoted literal — the build extracts them from the AST
// and a variable or backtick string drops the key silently.
definePageMeta({
  devTool: {
    title: 'Bench queue',
    category: 'Curation',
    description:
      'Drain the bench queue by reading the HUD portrait cluster — two frames per side, compared as sets.',
    queue: '/api/dev/bench-review',
  },
});

if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' });
}

const LETTERS = ['A', 'B', 'C'] as const;

interface Named {
  id: string;
  name: string;
}
interface Item {
  i: number;
  video: string;
  recheck: boolean;
  secs: number[];
  allSecs: number[];
  side: 'L' | 'R';
  points: (Named | null)[];
  handles: [string, string];
  needs: { side: boolean; point: boolean };
  sideIndex: number | null;
  known: Named[];
  title: string;
  titleSides: { handle: string; claim: Named[]; refuted: Named[] }[];
  opposite: Named[];
  saved: string[] | null;
  savedPicks: { a: string[]; b: string[]; forced?: boolean } | null;
  savedRefuted: { ids: Named[]; why: string; at: string } | null;
  done: boolean;
}

/** One answer to a refusal, at most (server/utils/portraitWork.ts SaveIntents).
 *  The old single `force` meant two things and recorded neither. */
interface SaveMode {
  useFrameA?: boolean;
  union?: boolean;
  keepTitled?: boolean;
  titleWrong?: { why: string; wholeSlot: boolean };
}

const cursor = ref(0);
const busy = ref(false);
const sideIndex = ref<number | null>(null);
const disagree = ref<{ a: string[]; b: string[] } | null>(null);
const titleMissing = ref<string[] | null>(null);
/** A refusal the server explained — shown verbatim, because the alternative is a
 *  button that looks broken. */
const refused = ref<string | null>(null);
/** "the title is wrong": the evidence, and whether the whole slot was copied */
const refuteWhy = ref('');
const refuteWholeSlot = ref(false);
/** The frames half of the request the title refusal answered. Its answer is
 *  resent WITH it: a title refusal that follows "use frame A anyway" or "both —
 *  the team changed" must not quietly drop that choice. */
const frameMode = ref<Pick<SaveMode, 'useFrameA' | 'union'>>({});

/** Three diamonds when the plate named the point fighter; the bust as a fourth
 *  when it did not. `◆` is the bust so the row cannot be mistaken for a diamond. */
function slotsFor(fi: number): string[] {
  return cur.value?.points[fi] ? [...LETTERS] : ['◆', ...LETTERS];
}
const picks = ref<string[][]>([
  ['', '', ''],
  ['', '', ''],
]);
/** which of the video's cached seconds each panel is showing */
const frameIdx = ref<number[]>([0, 0]);

function secOf(fi: number): number {
  const it = cur.value;
  if (!it) return 0;
  return it.allSecs[frameIdx.value[fi]!] ?? it.secs[fi]!;
}
function stepFrame(fi: number, d: number): void {
  const it = cur.value;
  if (!it) return;
  const n = it.allSecs.length;
  frameIdx.value = frameIdx.value.map((v, i) => (i === fi ? (v + d + n) % n : v));
}

const { data, pending, error, refresh } = await useFetch<{
  total: number;
  done: number;
  awaitingFootage: string[];
  roster: { id: string; name: string }[];
  counts: { total: number; pending: number; done: number; unreadable: number };
  items: Item[];
  resolved: Item[];
}>('/api/dev/bench-review');

// The OPEN sides. A drained bench is not work, and listing it as work is how
// this queue's sibling ended up advertising 171 records when 65 were incomplete.
const showResolved = ref(false);
const items = computed(() =>
  showResolved.value ? (data.value?.resolved ?? []) : (data.value?.items ?? []),
);
const total = computed(() => data.value?.total ?? 0);
const done = computed(() => data.value?.done ?? 0);
const awaiting = computed(() => data.value?.awaitingFootage ?? []);
const roster = computed(() => data.value?.roster ?? []);
const cur = computed(() => items.value[cursor.value]);
const nameOf = computed(() => new Map(roster.value.map((r) => [r.id, r.name])));
function namesOf(ids: string[]): string {
  return ids.map((id) => nameOf.value.get(id) ?? id).join(', ');
}
/** title fighters this reading lacks that the plate saw on the other player */
const missingOpposite = computed(() =>
  (titleMissing.value ?? []).filter((id) => cur.value?.opposite.some((o) => o.id === id)),
);
const ready = computed(() => {
  const it = cur.value;
  if (!it) return false;
  if (it.needs.side && sideIndex.value === null) return false;
  return [0, 1].every((fi) => {
    const want = slotsFor(fi).length;
    const row = picks.value[fi] ?? [];
    return row.length >= want && row.slice(0, want).every(Boolean);
  });
});

/**
 * Reopening a finished side shows what was read, not a blank form.
 *
 * Saves made from now on carry their per-frame picks verbatim. Earlier ones do
 * not, and frame A is still exact for them: `characters` is stored as
 * [point, ...frame A's picks] in the order they were entered, so removing the
 * point fighter recovers the row. Frame B's SET is equally certain — the save was
 * only accepted because both frames agreed on the bench — but which cell held whom
 * was never written down, so it is reconstructed and labelled as such rather than
 * presented as a faithful record.
 */
const restored = ref<'exact' | 'derived' | null>(null);

function loadPicks(): void {
  const it = cur.value;
  disagree.value = null;
  titleMissing.value = null;
  refused.value = null;
  frameMode.value = {};
  // a re-read of a side already ruled wrong starts from the recorded evidence
  refuteWhy.value = it?.savedRefuted?.why ?? '';
  refuteWholeSlot.value = false;
  const blank = (): string[][] => [
    new Array<string>(slotsFor(0).length).fill(''),
    new Array<string>(slotsFor(1).length).fill(''),
  ];
  sideIndex.value = it?.sideIndex ?? null;
  // start each panel on the second the worklist chose, then let the reviewer move
  frameIdx.value = [0, 1].map((fi) => {
    const at = it?.allSecs.indexOf(it.secs[fi]!) ?? -1;
    return at >= 0 ? at : fi === 0 ? 0 : Math.max(0, (it?.allSecs.length ?? 1) - 1);
  });
  if (!it) {
    picks.value = blank();
    restored.value = null;
    return;
  }
  if (it.savedPicks) {
    picks.value = [[...it.savedPicks.a], [...it.savedPicks.b]];
    restored.value = 'exact';
    return;
  }
  if (it.saved?.length) {
    const three = (point: string): string[] => {
      const rest = it.saved!.filter((c) => c !== point);
      return [rest[0] ?? '', rest[1] ?? '', rest[2] ?? ''];
    };
    picks.value = [three(it.points[0]!.id), three(it.points[1]!.id)];
    restored.value = 'derived';
    return;
  }
  picks.value = blank();
  restored.value = null;
}
// The list shrinks under the cursor on every save; keep it on a real row.
watch(items, (list) => {
  if (cursor.value > list.length - 1) cursor.value = Math.max(0, list.length - 1);
});
watch(cursor, loadPicks);
watch(items, loadPicks, { immediate: true });

async function saveKeepingTitled(): Promise<void> {
  await save({ ...frameMode.value, keepTitled: true });
}

async function saveTitleWrong(): Promise<void> {
  if (!refuteWhy.value.trim()) return;
  await save({
    ...frameMode.value,
    titleWrong: { why: refuteWhy.value.trim(), wholeSlot: refuteWholeSlot.value },
  });
}

async function save(mode: SaveMode = {}): Promise<void> {
  if (!ready.value || busy.value) return;
  busy.value = true;
  refused.value = null;
  try {
    const r = await $fetch<{
      ok: boolean;
      disagree?: boolean;
      a?: string[];
      b?: string[];
      titleMissing?: string[];
      unionSlip?: boolean;
      message?: string;
    }>('/api/dev/bench-review', {
      method: 'POST',
      body: {
        video: cur.value!.video,
        side: cur.value!.side,
        sideIndex: sideIndex.value,
        a: picks.value[0]!.slice(0, slotsFor(0).length),
        b: picks.value[1]!.slice(0, slotsFor(1).length),
        ...mode,
      },
    });
    if (r.titleMissing) {
      // One refusal at a time: the frames question was answered to get here.
      disagree.value = null;
      titleMissing.value = r.titleMissing;
      frameMode.value = { useFrameA: mode.useFrameA, union: mode.union };
      return;
    }
    if (r.ok) {
      disagree.value = null;
      titleMissing.value = null;
      refused.value = null;
      const saved = { video: cur.value!.video, side: cur.value!.side };
      await refresh();
      // A SAVED SIDE LEAVES THE OPEN LIST, so the next one has already slid into
      // this slot. Stepping forward as well skipped every other side and walked the
      // cursor off the end, where the page said "bench queue is empty" over 48 open
      // sides. Step only when the side is still listed, as it is under "show drained".
      const at = items.value.findIndex((x) => x.video === saved.video && x.side === saved.side);
      if (at >= 0) cursor.value = Math.min(at + 1, items.value.length - 1);
    } else if (r.disagree) {
      titleMissing.value = null;
      disagree.value = { a: r.a ?? [], b: r.b ?? [] };
    } else {
      // EVERY OTHER REFUSAL LANDS HERE, AND IT MUST SAY SOMETHING. The union-slip
      // guard answers `{ ok: false, unionSlip, message }` and had no branch at all,
      // so clicking "both — the team changed mid-set" on a side-swapped set did
      // nothing visible: the click was refused, correctly, and silently. A guard
      // nobody can see is indistinguishable from a broken button.
      refused.value = r.message ?? 'the server refused this read and gave no reason';
    }
  } catch (e) {
    // A 400 or a 409 REJECTS rather than resolving, so without this the same click
    // vanishes into an unhandled rejection. A stale cursor (409) is the likely one.
    const msg = (e as { data?: { message?: string }; message?: string })?.data?.message;
    refused.value = msg ?? (e as Error)?.message ?? 'the request failed before the server answered';
  } finally {
    busy.value = false;
  }
}

function onKey(e: KeyboardEvent): void {
  // Typing the evidence for "the title is wrong" must not save the side plainly
  // on Enter, nor move the cursor on an arrow key.
  if (
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLInputElement
  ) {
    return;
  }
  if (e.key === 'ArrowLeft') cursor.value = Math.max(0, cursor.value - 1);
  else if (e.key === 'ArrowRight')
    cursor.value = Math.min(items.value.length - 1, cursor.value + 1);
  else if (e.key === 'Enter') void save();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
/* Structural only: the progress strip, the pixelated crops, the frame stepper
   and the per-slot roster grid. Every colour is an engine semantic token now —
   the `var(--char-*, #hex)` pairs this file used to carry named custom
   properties that exist nowhere in the engine, so they always resolved to the
   hardcoded fallback. */
.dim {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.warn {
  color: var(--color-warning);
}
.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin: 1.5rem 0 1rem;
}
.tick {
  width: 8px;
  height: 14px;
  border: 0;
  padding: 0;
  background: var(--color-surface-raised);
  cursor: pointer;
}
.tick.on {
  background: var(--color-success);
}
/* saved, but failing its title control — not drained */
.tick.re {
  background: var(--color-warning);
}
.tick.cur {
  outline: 2px solid var(--color-primary);
}
.item {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
  flex-wrap: wrap;
}
.panel {
  flex: 0 1 460px;
}
.head {
  margin: 0 0 0.4rem;
  font-size: 0.9rem;
}
.pt {
  color: var(--color-secondary);
}
.crop {
  image-rendering: pixelated;
  max-width: 100%;
  display: block;
  margin-bottom: 0.25rem;
}
.stepper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
}
.step {
  font: inherit;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--color-border);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.step:hover {
  border-color: var(--color-primary);
}
.src {
  color: var(--color-primary);
}
.source {
  font-family: var(--font-mono, monospace);
  font-size: 0.85rem;
  margin-top: 0.75rem;
  overflow-wrap: anywhere;
}
.slot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.letter {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--color-primary);
  width: 1.2rem;
}
.letter.bust {
  color: var(--color-secondary);
}
.attrib {
  margin-bottom: 1rem;
}
/* Renamed from `.strip`, which this file also uses for the progress nav above:
   both rules matched, the image inherited `display: flex` and the two margin
   declarations fought. Distinct names, no cascade accident. */
.side-strip {
  image-rendering: pixelated;
  width: 100%;
  max-width: 34rem;
  margin: 0.3rem 0;
}
.who {
  font: inherit;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--color-border);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.who.on {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-primary-contrast);
  font-weight: 600;
}
.sel {
  font: inherit;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  /* The popup list is drawn by the OS, and it does NOT inherit the page's colours
     — a transparent background there resolves against the widget's own light
     surface while the text keeps the dark theme's pale colour, which is why the
     names were unreadable. Both ends are stated explicitly. */
  background: var(--color-surface-raised);
  color: var(--color-text);
  min-width: 12rem;
}
.sel option {
  background: var(--color-surface-raised);
  color: var(--color-text);
}
.sel option:checked {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}
.actions {
  flex: 1 1 16rem;
  min-width: 16rem;
}
.save {
  font: inherit;
  font-weight: 600;
  padding: 0.6rem 1.2rem;
  border: 0;
  background: var(--color-success);
  color: var(--color-bg);
  cursor: pointer;
}
.save:disabled {
  opacity: 0.4;
  cursor: default;
}
.act.union {
  font: inherit;
  margin-top: 0.5rem;
  margin-right: 0.4rem;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  border: 0;
  background: var(--color-success);
  color: var(--color-bg);
  font-weight: 600;
}
.force {
  font: inherit;
  margin-top: 0.4rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid currentcolor;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.note {
  margin-top: 1rem;
  max-width: 26rem;
}
.titlebox {
  margin-bottom: 0.75rem;
  max-width: 34rem;
}
.titlebox p {
  margin: 0 0 0.2rem;
}
.ttl {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.here {
  color: var(--color-primary);
  font-weight: 600;
}
.refute {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.75rem;
  max-width: 30rem;
}
.why {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text);
  resize: vertical;
}
.check {
  display: flex;
  gap: 0.4rem;
  align-items: flex-start;
}
.refute .force {
  align-self: flex-start;
}
.force:disabled {
  opacity: 0.4;
  cursor: default;
}
.restored {
  color: var(--color-success);
  font-size: 0.85rem;
  max-width: 26rem;
}
</style>
