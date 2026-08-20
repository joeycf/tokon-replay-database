<template>
  <ClientOnly>
    <div class="wrap">
      <header class="bar">
        <strong>bench queue</strong>
        <span class="dim">{{ done }}/{{ total }} sides drained</span>
        <span class="dim keys">⏎ save · ←/→ move · type in a box to jump to a fighter</span>
      </header>

      <nav class="strip">
        <button
          v-for="it in items"
          :key="it.i"
          class="tick"
          :class="{ on: it.done, cur: it.i === cursor }"
          @click="cursor = it.i"
        />
      </nav>

      <p v-if="pending" class="dim">loading…</p>
      <p v-else-if="error" class="warn">{{ error }}</p>
      <p v-else-if="!cur" class="dim">bench queue is empty 🎉</p>

      <section v-else class="item">
        <div v-for="(f, fi) in [0, 1]" :key="f" class="panel">
          <p class="head">
            frame {{ fi === 0 ? 'A' : 'B' }} ·
            <span v-if="cur.points[fi]" class="pt">on point {{ cur.points[fi]!.name }}</span>
            <span v-else class="warn">the plate read nothing — read the bust too</span>
          </p>
          <img
            class="crop"
            :src="`/api/dev/portrait-crop?video=${cur.video}&sec=${secOf(fi)}&side=${cur.side}`"
            :alt="`side ${cursor + 1} frame ${fi}`"
          >
          <!-- A sampled frame can land on a cinematic or a super flash where the
               cluster is not drawn at all. Stepping costs nothing: every one of
               these seconds is already on disk. -->
          <p class="stepper">
            <button class="step" @click="stepFrame(fi, -1)">◀</button>
            <span class="dim mono">{{ secOf(fi) }}s · {{ frameIdx[fi]! + 1 }}/{{ cur.allSecs.length }}</span>
            <button class="step" @click="stepFrame(fi, 1)">▶</button>
          </p>
          <div v-for="(letter, k) in slotsFor(fi)" :key="letter" class="slot">
            <span class="letter" :class="{ bust: letter === '◆' }">{{ letter }}</span>
            <select v-model="picks[fi]![k]" class="sel">
              <option value="">— pick —</option>
              <option v-for="r in roster" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
        </div>

        <div class="actions">
          <!-- The plate could not say which player this screen side is, so the
               handle under the health bar is the evidence and the reviewer reads
               it. Never inferred from title order: one uploader reverses its
               second title slot on 27 of 34 videos. -->
          <div v-if="cur.needs.side" class="attrib">
            <p class="warn">Which player is this side?</p>
            <!-- The whole top quadrant, because the handle moves: under the health
                 bar in some uploads, in a banner above it in others, and inside a
                 channel's own overlay in others again. A band tuned to one layout
                 returned gameplay for the rest. -->
            <p class="dim">
              Handle placement varies by upload — look anywhere in this quadrant.
              Step the frames above if it is not drawn at this moment, or
              <a
                class="src"
                :href="`https://www.youtube.com/watch?v=${cur.video}&t=${secOf(0)}`"
                target="_blank"
                rel="noreferrer"
              >open the source at {{ secOf(0) }}s ↗</a>.
            </p>
            <img
              class="strip"
              :src="`/api/dev/portrait-crop?video=${cur.video}&sec=${secOf(0)}&side=${cur.side}&strip=1`"
              alt="this side's top corner"
            >
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
          <p v-if="cur.known.length" class="dim">
            already known: {{ cur.known.map((k) => k.name).join(', ') }}
          </p>
          <p v-if="restored === 'exact'" class="restored">
            saved earlier — showing exactly what you picked
          </p>
          <p v-else-if="restored === 'derived'" class="restored">
            saved earlier — fighters are exact; frame B's A/B/C order is
            reconstructed, since that save predates recording it
          </p>
          <p v-if="cur.savedPicks?.forced" class="warn">
            this one was saved with <em>use frame A anyway</em>
          </p>
          <p v-if="cur.recheck" class="warn">
            This side is complete but FAILS its own control — the title names a
            fighter the saved reading does not include. Re-read it.
          </p>
          <p v-if="titleMissing" class="warn">
            The title names <strong>{{ titleMissing.join(', ') }}</strong> on this
            side and your reading does not include them.<br >
            <span class="dim">
              If the attribution is right, this is a mid-set team change: the title
              witnesses that fighter, the frames witness the rest, and both are
              true. Keeping both records the side as it actually was.
            </span><br >
            <button class="act union" @click="saveKeepingTitled()">
              also keep {{ titleMissing.join(', ') }} — team changed
            </button>
            <button class="force" @click="save(true)">drop them and save</button>
          </p>
          <p v-if="disagree" class="warn">
            The two frames read different benches.<br >
            A: {{ disagree.a.join(', ') }}<br >
            B: {{ disagree.b.join(', ') }}<br >
            <span class="dim">
              If the team CHANGED between games, both readings are true and the
              side really did field more than four — keep both. Force frame A only
              when one frame was misread.
            </span><br >
            <button class="act union" @click="save(false, true)">
              both — the team changed mid-set
            </button>
            <button class="force" @click="save(true)">use frame A anyway</button>
          </p>
          <button class="save" :disabled="!ready || busy" @click="save(false)">
            {{ busy ? 'saving…' : cur.done ? 're-save side' : 'save side' }}
          </button>
          <p class="dim note">
            A person's read REPLACES this side — it does not merge with the
            description. Four of 189 hand-read slots named a fighter absent from
            both described benches, so when the pixels and the prose disagree the
            pixels win.
          </p>
        </div>
      </section>
    </div>
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
const LETTERS = ['A', 'B', 'C'] as const;

interface Item {
  i: number;
  video: string;
  recheck: boolean;
  secs: number[];
  allSecs: number[];
  side: 'L' | 'R';
  points: ({ id: string; name: string } | null)[];
  handles: [string, string];
  needs: { side: boolean; point: boolean };
  sideIndex: number | null;
  known: { id: string; name: string }[];
  saved: string[] | null;
  savedPicks: { a: string[]; b: string[]; forced?: boolean } | null;
  done: boolean;
}

const cursor = ref(0);
const busy = ref(false);
const sideIndex = ref<number | null>(null);
const disagree = ref<{ a: string[]; b: string[] } | null>(null);
const titleMissing = ref<string[] | null>(null);

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
  roster: { id: string; name: string }[];
  items: Item[];
}>('/api/dev/bench-review');

const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.total ?? 0);
const done = computed(() => data.value?.done ?? 0);
const roster = computed(() => data.value?.roster ?? []);
const cur = computed(() => items.value[cursor.value]);
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
watch(cursor, loadPicks);
watch(items, loadPicks, { immediate: true });

async function saveKeepingTitled(): Promise<void> {
  await save(false, false, true);
}

async function save(force: boolean, union = false, keepTitled = false): Promise<void> {
  if (!ready.value || busy.value) return;
  busy.value = true;
  try {
    const r = await $fetch<{
      ok: boolean;
      disagree?: boolean;
      a?: string[];
      b?: string[];
      titleMissing?: string[];
    }>(
      '/api/dev/bench-review',
      {
        method: 'POST',
        body: {
          video: cur.value!.video,
          side: cur.value!.side,
          sideIndex: sideIndex.value,
          a: picks.value[0]!.slice(0, slotsFor(0).length),
          b: picks.value[1]!.slice(0, slotsFor(1).length),
          force,
          union,
          keepTitled,
        },
      },
    );
    if (r.titleMissing) {
      titleMissing.value = r.titleMissing;
      return;
    }
    if (r.ok) {
      disagree.value = null;
      titleMissing.value = null;
      await refresh();
      if (cursor.value < total.value - 1) cursor.value++;
    } else if (r.disagree) {
      disagree.value = { a: r.a ?? [], b: r.b ?? [] };
    }
  } finally {
    busy.value = false;
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.target instanceof HTMLSelectElement) return;
  if (e.key === 'ArrowLeft') cursor.value = Math.max(0, cursor.value - 1);
  else if (e.key === 'ArrowRight') cursor.value = Math.min(total.value - 1, cursor.value + 1);
  else if (e.key === 'Enter') void save(false);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.wrap {
  max-width: 1500px;
  margin: 0 auto;
  padding: 1rem;
  font-family: var(--font-sans, system-ui), sans-serif;
}
.bar {
  display: flex;
  gap: 1rem;
  align-items: baseline;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.dim {
  color: var(--char-muted, #8b93a7);
  font-size: 0.85rem;
}
.keys {
  font-family: ui-monospace, monospace;
}
.warn {
  color: var(--char-danger, #ff5a5f);
}
.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: 1rem;
}
.tick {
  width: 8px;
  height: 14px;
  border: 0;
  padding: 0;
  background: #3a4055;
  cursor: pointer;
}
.tick.on {
  background: #35c46b;
}
.tick.cur {
  outline: 2px solid #00e5ff;
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
  color: #ff9d2e;
}
.crop {
  image-rendering: pixelated;
  max-width: 100%;
  border-radius: 4px;
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
  border: 1px solid #3a4055;
  background: transparent;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
}
.step:hover {
  border-color: #00e5ff;
}
.src {
  color: #00e5ff;
}
.slot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.letter {
  font-family: ui-monospace, monospace;
  font-weight: 700;
  color: #00e5ff;
  width: 1.2rem;
}
.letter.bust {
  color: #ff9d2e;
}
.attrib {
  margin-bottom: 1rem;
}
.strip {
  image-rendering: pixelated;
  width: 100%;
  max-width: 34rem;
  border-radius: 4px;
  margin: 0.3rem 0;
}
.who {
  font: inherit;
  padding: 0.4rem 0.8rem;
  border: 1px solid #3a4055;
  background: transparent;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
}
.who.on {
  background: #00e5ff;
  border-color: #00e5ff;
  color: #04121a;
  font-weight: 600;
}
.sel {
  font: inherit;
  padding: 0.3rem 0.5rem;
  border: 1px solid #3a4055;
  /* The popup list is drawn by the OS, and it does NOT inherit the page's colours
     — a transparent background there resolves against the widget's own light
     surface while the text keeps the dark theme's pale colour, which is why the
     names were unreadable. Both ends are stated explicitly. */
  background: #12151f;
  color: #e8ecf5;
  border-radius: 4px;
  min-width: 12rem;
}
.sel option {
  background: #12151f;
  color: #e8ecf5;
}
.sel option:checked {
  background: #00e5ff;
  color: #04121a;
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
  border-radius: 4px;
  background: #35c46b;
  color: #04121a;
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
  border-radius: 4px;
  cursor: pointer;
  border: 0;
  background: #35c46b;
  color: #04121a;
  font-weight: 600;
}
.force {
  font: inherit;
  margin-top: 0.4rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid currentcolor;
  background: transparent;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
}
.note {
  margin-top: 1rem;
  max-width: 26rem;
}
.restored {
  color: #35c46b;
  font-size: 0.85rem;
  max-width: 26rem;
}
</style>
