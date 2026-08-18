<template>
  <ClientOnly>
    <div class="wrap">
      <header class="bar">
        <strong>bench diamonds</strong>
        <span class="dim">{{ labelled }}/{{ total }} sides · {{ crops }} crops</span>
        <span v-if="offBench" class="off-count">{{ offBench }} off-bench</span>
        <span class="dim keys">1/2/3 assign A · qwe assign B · asd assign C · ←/→ move · x clear</span>
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
      <p v-else-if="!cur" class="dim">nothing to label</p>

      <section v-else class="item">
        <!-- The corner at 4x with the three diamonds outlined and lettered. The
             dashed box is the point fighter's bust, which is WHY the candidate
             list is only three names: point plus three assists is the whole side. -->
        <img class="crop" :src="`/api/dev/portrait-crop?i=${cursor}`" :alt="`side ${cursor + 1}`" >

        <div class="panel">
          <p class="point">
            on point <strong>{{ cur.pointName }}</strong>
            <span class="dim"> · screen {{ cur.side === 'L' ? 'left' : 'right' }}</span>
          </p>

          <div v-for="(cell, k) in CELLS" :key="cell" class="cellrow">
            <span class="letter">{{ LETTERS[k] }}</span>
            <button
              v-for="(c, ci) in cur.candidates"
              :key="c.id"
              class="cand"
              :class="{ picked: cur.saved[k] === c.id }"
              @click="assign(cell, c.id)"
            >
              <kbd>{{ KEYS[k]![ci] }}</kbd> {{ c.name }}
            </button>
            <select
              class="other"
              :class="{ picked: cur.off[k] }"
              :value="cur.off[k] ? cur.saved[k] : ''"
              @change="assign(cell, ($event.target as HTMLSelectElement).value || null)"
            >
              <option value="">other…</option>
              <option v-for="r in roster" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
            <button class="cand clear" @click="assign(cell, null)">clear</button>
          </div>

          <p class="dim note">
            Each diamond should hold one of these three, and the order changes as
            the point fighter changes. If the pixels show someone else, pick them
            from <em>other…</em> — the description is wrong, not you, and the
            disagreement is recorded as a measurement of the truth set.
          </p>
        </div>
      </section>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
/**
 * Dev-only labelling page for the bench-portrait diamonds.
 *
 * A side's three diamonds hold a KNOWN set of three fighters — the description
 * names the bench and the plate names who is on point — but which diamond holds
 * whom changes through the match. So this is a three-way assignment, not a recall
 * test, and it is fast enough that ~50 sides is one sitting.
 *
 * Nothing here pre-selects an answer. The candidates are ordered, never chosen:
 * this project has already lost seventeen plate labels to a page that showed the
 * labeller what to say, and an auto-selected suggestion is the same mistake with
 * a friendlier face.
 */
const CELLS = ['left', 'right', 'bottom'] as const;
const LETTERS = ['A', 'B', 'C'] as const;
const KEYS = [
  ['1', '2', '3'],
  ['q', 'w', 'e'],
  ['a', 's', 'd'],
] as const;

interface Item {
  i: number;
  side: 'L' | 'R';
  point: string;
  pointName: string;
  candidates: { id: string; name: string }[];
  saved: (string | null)[];
  /** per cell: this label contradicts the description's bench */
  off: boolean[];
  done: boolean;
}

const cursor = ref(0);
const { data, pending, error, refresh } = await useFetch<{
  total: number;
  labelled: number;
  crops: number;
  offBench: number;
  roster: { id: string; name: string }[];
  items: Item[];
}>('/api/dev/portrait-review');

const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.total ?? 0);
const labelled = computed(() => data.value?.labelled ?? 0);
const crops = computed(() => data.value?.crops ?? 0);
const offBench = computed(() => data.value?.offBench ?? 0);
const roster = computed(() => data.value?.roster ?? []);
const cur = computed(() => items.value[cursor.value]);

async function assign(cell: string, char: string | null): Promise<void> {
  await $fetch('/api/dev/portrait-review', {
    method: 'POST',
    body: { i: cursor.value, cell, char },
  });
  await refresh();
  // advance only once every diamond on this side has an answer, so a correction
  // does not throw the cursor forward mid-item
  if (cur.value?.done && cursor.value < total.value - 1) cursor.value++;
}

function onKey(e: KeyboardEvent): void {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === 'ArrowLeft') return void (cursor.value = Math.max(0, cursor.value - 1));
  if (e.key === 'ArrowRight') return void (cursor.value = Math.min(total.value - 1, cursor.value + 1));
  for (const [k, row] of KEYS.entries()) {
    const ci = row.indexOf(e.key as never);
    if (ci >= 0) {
      const c = cur.value?.candidates[ci];
      if (c) void assign(CELLS[k]!, c.id);
      return;
    }
  }
  if (e.key === 'x') for (const c of CELLS) void assign(c, null);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.wrap {
  max-width: 1400px;
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
  width: 10px;
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
  gap: 1.5rem;
  align-items: flex-start;
  flex-wrap: wrap;
}
.crop {
  image-rendering: pixelated;
  max-width: 100%;
  border-radius: 4px;
}
.panel {
  min-width: 22rem;
  flex: 1;
}
.point {
  margin: 0 0 1rem;
}
.cellrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}
.letter {
  font-family: ui-monospace, monospace;
  font-weight: 700;
  color: #00e5ff;
  width: 1.2rem;
}
.cand {
  font: inherit;
  padding: 0.4rem 0.7rem;
  border: 1px solid #3a4055;
  background: transparent;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
}
.cand:hover {
  border-color: #00e5ff;
}
.cand.picked {
  background: #35c46b;
  border-color: #35c46b;
  color: #04121a;
  font-weight: 600;
}
.cand.clear {
  opacity: 0.6;
}
.other {
  font: inherit;
  padding: 0.4rem 0.5rem;
  border: 1px dashed #6b7391;
  background: transparent;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
  max-width: 12rem;
}
.other.picked {
  background: #ff9d2e;
  border-style: solid;
  border-color: #ff9d2e;
  color: #04121a;
  font-weight: 600;
}
.off-count {
  font-size: 0.85rem;
  color: #ff9d2e;
}
kbd {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  opacity: 0.7;
}
.note {
  margin-top: 1rem;
  max-width: 30rem;
}
</style>
