<template>
  <ClientOnly>
    <div class="wrap">
      <header class="bar">
        <div>
          <strong>blind labelling</strong>
          <span class="dim">
            {{ savedCount }}/{{ items.length }} labelled · {{ disputedCount }} disputed
          </span>
        </div>
        <div class="dim keys">
          keys: ⏎ save · s swap sides · d next disputed · ←/→ · 1-8 frame
        </div>
      </header>

      <!-- FILL is save state, BORDER is dispute. They are independent facts and
           collapsing them into one colour would make a disputed item
           indistinguishable from an unreviewed one. -->
      <nav class="strip">
        <button
          v-for="(it, i) in items"
          :key="it.id"
          class="tick"
          :class="{ on: it.saved, dis: it.disputed, cur: i === cursor }"
          :title="it.id"
          @click="cursor = i"
        />
      </nav>

      <p v-if="pending" class="dim">loading…</p>
      <p v-else-if="!item" class="dim">nothing to label.</p>

      <section v-else class="item">
        <h1>{{ item.title }}</h1>
        <p class="dim">
          {{ item.channel }} · {{ Math.round(item.durationSec / 60) }} min · {{ item.id }}
          <span v-if="item.disputed" class="flag">the reader disagrees — look again</span>
        </p>

        <p v-if="!item.frames.length" class="warn">
          No frames cached for this video. Run the extractor over it first.
        </p>

        <template v-else>
          <!-- Full width on purpose: the bench icons sit in the top corners at
               roughly 45px, and the whole point of this page is that a human can
               read all four off one frame. -->
          <img class="frame" :src="frameSrc" :alt="`frame at ${item.frames[frame]}s`" >
          <div class="frames">
            <button
              v-for="(sec, i) in item.frames"
              :key="sec"
              class="fbtn"
              :class="{ cur: i === frame }"
              @click="frame = i"
            >
              {{ sec }}s
            </button>
          </div>
        </template>

        <div class="sides">
          <div v-for="(h, s) in item.handles" :key="s" class="side">
            <h2>
              {{ h }}
              <button class="swap" :class="{ on: leftIs === s }" @click="leftIs = s as 0 | 1">
                {{ leftIs === s ? 'on screen LEFT' : 'set as LEFT' }}
              </button>
            </h2>

            <p class="lbl">bench — all four, from the corner icons ({{ benchOf(s).length }}/4)</p>
            <div class="chips">
              <button
                v-for="c in roster"
                :key="c.id"
                class="chip"
                :class="{ on: benchOf(s).includes(c.id) }"
                @click="toggleBench(s as 0 | 1, c.id)"
              >
                {{ c.name }}
              </button>
            </div>

            <p class="lbl">held point — which of those four actually came in</p>
            <div class="chips">
              <button
                v-for="c in benchOf(s)"
                :key="c"
                class="chip pt"
                :class="{ on: pointOf(s).includes(c) }"
                @click="togglePoint(s as 0 | 1, c)"
              >
                {{ nameOf(c) }}
              </button>
              <span v-if="!benchOf(s).length" class="dim">pick the bench first</span>
            </div>
          </div>
        </div>

        <p v-if="error" class="warn">{{ error }}</p>
        <button class="save" :disabled="!complete || posting" @click="save()">
          {{ posting ? 'saving…' : 'save  ⏎' }}
        </button>
      </section>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
// Dev-only blind-labelling surface. Verdicts POST to /api/dev/source-review,
// which validates and writes ONLY data/labels.json.
//
// THIS PAGE NEVER SHOWS THE MACHINE'S ANSWER. The server computes `disputed` and
// throws the extractor's characters away before responding, so a reviewer cannot
// absorb a suggestion — not from the UI and not from a devtools tab. A flag says
// "look again"; it cannot say "say this". The whole value of these labels is
// that they were produced without seeing the thing they are measuring.
//
// It also does not show the DESCRIPTION's bench, for the same reason: the
// description is one of the two answers under test.
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' });
}

interface Label {
  point: [string[], string[]];
  bench: [string[], string[]];
  leftIsFirst: boolean | null;
  at: string;
}
interface Item {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  handles: [string, string];
  titleChars: [string, string];
  frames: number[];
  cached: boolean;
  saved: Label | null;
  /** the reader read this differently from the saved label. A BOOLEAN ONLY. */
  disputed: boolean;
}

const { data, pending, refresh } = await useAsyncData(
  'dev-source-review',
  () => $fetch<{ roster: { id: string; name: string }[]; items: Item[] }>('/api/dev/source-review'),
  { server: false },
);
const roster = computed(() => data.value?.roster ?? []);
const items = computed(() => data.value?.items ?? []);
const savedCount = computed(() => items.value.filter((i) => i.saved).length);
const disputedCount = computed(() => items.value.filter((i) => i.disputed).length);

const cursor = ref(0);
const frame = ref(0);
const item = computed(() => items.value[cursor.value]);
const frameSrc = computed(() =>
  item.value?.frames.length
    ? `/api/dev/review-frame?id=${item.value.id}&sec=${item.value.frames[frame.value]}`
    : '',
);
// The v-for index is a plain `number`, so indexing the tuples with it widens
// to `string[] | undefined`. These keep the template honest without scattering
// non-null assertions through the markup.
const benchOf = (s: number): string[] => bench.value[s as 0 | 1] ?? [];
const pointOf = (s: number): string[] => point.value[s as 0 | 1] ?? [];
const nameOf = (id: string): string => roster.value.find((c) => c.id === id)?.name ?? id;

const bench = ref<[string[], string[]]>([[], []]);
const point = ref<[string[], string[]]>([[], []]);
const leftIs = ref<0 | 1>(0);
const posting = ref(false);
const error = ref('');

// Form state resets per item. A REVISIT loads the reviewer's OWN previous
// answer back — it is their verdict, not a machine suggestion — while an
// unlabelled item always opens blank, so a first pass is never primed.
watch(
  item,
  (it) => {
    frame.value = 0;
    error.value = '';
    bench.value = it?.saved ? [[...it.saved.bench[0]], [...it.saved.bench[1]]] : [[], []];
    point.value = it?.saved ? [[...it.saved.point[0]], [...it.saved.point[1]]] : [[], []];
    leftIs.value = it?.saved?.leftIsFirst === false ? 1 : 0;
  },
  { immediate: true },
);

function toggleBench(s: 0 | 1, id: string): void {
  const list = bench.value[s];
  const i = list.indexOf(id);
  if (i >= 0) {
    list.splice(i, 1);
    // dropping someone from the bench drops them from point too — point is a
    // subset by definition and the server rejects it otherwise
    const p = point.value[s].indexOf(id);
    if (p >= 0) point.value[s].splice(p, 1);
  } else if (list.length < 4) {
    list.push(id);
  }
}
function togglePoint(s: 0 | 1, id: string): void {
  const list = point.value[s];
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
}

const complete = computed(
  () =>
    bench.value[0].length === 4 &&
    bench.value[1].length === 4 &&
    point.value[0].length > 0 &&
    point.value[1].length > 0,
);

async function save(): Promise<void> {
  if (!item.value || !complete.value || posting.value) return;
  posting.value = true;
  error.value = '';
  try {
    await $fetch('/api/dev/source-review', {
      method: 'POST',
      body: {
        id: item.value.id,
        bench: bench.value,
        point: point.value,
        leftIsFirst: leftIs.value === 0,
      },
    });
    await refresh();
    const next = items.value.findIndex((it, i) => i > cursor.value && !it.saved);
    if (next >= 0) cursor.value = next;
  } catch (e) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? String(e);
  } finally {
    posting.value = false;
  }
}

/** Jump to the next disputed item, wrapping. With every tile filled the strip
 *  cannot be scanned by eye for the ones needing a second look, which is the
 *  situation this exists for. */
function nextDisputed(): void {
  const n = items.value.length;
  for (let k = 1; k <= n; k++) {
    const i = (cursor.value + k) % n;
    if (items.value[i]?.disputed) {
      cursor.value = i;
      return;
    }
  }
}

function onKey(e: KeyboardEvent): void {
  // Enter commits from anywhere. A labelling pass is a handful of clicks and a
  // commit; reaching for the mouse each time is the whole cost of the session.
  if (e.key === 'Enter') {
    void save();
    return;
  }
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'ArrowRight') cursor.value = Math.min(cursor.value + 1, items.value.length - 1);
  else if (e.key === 'ArrowLeft') cursor.value = Math.max(cursor.value - 1, 0);
  else if (e.key === 'd') nextDisputed();
  else if (e.key === 's') leftIs.value = leftIs.value === 0 ? 1 : 0;
  else if (/^[1-8]$/.test(e.key)) {
    const i = Number(e.key) - 1;
    if (item.value && i < item.value.frames.length) frame.value = i;
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.wrap {
  max-width: 1400px;
  margin: 0 auto;
  padding: 1rem;
  font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
  color: #e8ecf5;
  background: #101627;
  min-height: 100vh;
}
.bar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: baseline;
  padding-bottom: 0.5rem;
}
.dim {
  color: #8e9bb5;
}
.keys {
  font-size: 12px;
}
.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 0.5rem 0 1rem;
}
.tick {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 2px solid #2a3550;
  background: #1a2338;
  cursor: pointer;
  padding: 0;
}
.tick.on {
  background: #23c29e;
}
.tick.dis {
  border-color: #ff4b42;
}
.tick.cur {
  transform: scale(1.35);
}
h1 {
  font-size: 1rem;
  margin: 0.25rem 0;
}
h2 {
  font-size: 0.9rem;
  margin: 0 0 0.5rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.flag {
  color: #ff4b42;
  margin-left: 0.5rem;
}
.warn {
  color: #ffb45f;
}
.frame {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 6px;
  image-rendering: crisp-edges;
}
.frames {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin: 0.5rem 0 1rem;
}
.fbtn,
.chip,
.swap,
.save {
  background: #1a2338;
  color: #e8ecf5;
  border: 1px solid #2a3550;
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.fbtn.cur {
  border-color: #03a5fe;
  color: #03a5fe;
}
.sides {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 1.5rem;
}
.lbl {
  margin: 0.75rem 0 0.25rem;
  font-size: 12px;
  color: #8e9bb5;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip.on {
  background: #23c29e;
  border-color: #23c29e;
  color: #06131c;
}
.chip.pt.on {
  background: #ec51c9;
  border-color: #ec51c9;
}
.swap.on {
  border-color: #03a5fe;
  color: #03a5fe;
}
.save {
  margin-top: 1.25rem;
  padding: 8px 18px;
  font-size: 14px;
}
.save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
