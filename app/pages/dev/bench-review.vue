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
            <span class="pt">on point {{ cur.points[fi]!.name }}</span>
          </p>
          <img
            class="crop"
            :src="`/api/dev/portrait-crop?pool=bench&i=${cursor}&frame=${fi}`"
            :alt="`side ${cursor + 1} frame ${fi}`"
          >
          <div v-for="(letter, k) in LETTERS" :key="letter" class="slot">
            <span class="letter">{{ letter }}</span>
            <select v-model="picks[fi]![k]" class="sel">
              <option value="">— pick —</option>
              <option v-for="r in roster" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
        </div>

        <div class="actions">
          <p v-if="cur.known.length" class="dim">
            already known: {{ cur.known.map((k) => k.name).join(', ') }}
          </p>
          <p v-if="disagree" class="warn">
            The two frames read different benches.<br >
            A: {{ disagree.a.join(', ') }}<br >
            B: {{ disagree.b.join(', ') }}<br >
            <button class="force" @click="save(true)">use frame A anyway</button>
          </p>
          <button class="save" :disabled="!ready || busy" @click="save(false)">
            {{ busy ? 'saving…' : 'save side' }}
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
  side: 'L' | 'R';
  points: { id: string; name: string }[];
  known: { id: string; name: string }[];
  saved: string[] | null;
  done: boolean;
}

const cursor = ref(0);
const busy = ref(false);
const disagree = ref<{ a: string[]; b: string[] } | null>(null);
const picks = ref<string[][]>([
  ['', '', ''],
  ['', '', ''],
]);

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
const ready = computed(() => picks.value.every((row) => row.every(Boolean)));

watch(cursor, () => {
  picks.value = [
    ['', '', ''],
    ['', '', ''],
  ];
  disagree.value = null;
});

async function save(force: boolean): Promise<void> {
  if (!ready.value || busy.value) return;
  busy.value = true;
  try {
    const r = await $fetch<{ ok: boolean; disagree?: boolean; a?: string[]; b?: string[] }>(
      '/api/dev/bench-review',
      { method: 'POST', body: { i: cursor.value, a: picks.value[0], b: picks.value[1], force } },
    );
    if (r.ok) {
      disagree.value = null;
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
  margin-bottom: 0.5rem;
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
.sel {
  font: inherit;
  padding: 0.3rem 0.5rem;
  border: 1px solid #3a4055;
  background: transparent;
  color: inherit;
  border-radius: 4px;
  min-width: 12rem;
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
</style>
