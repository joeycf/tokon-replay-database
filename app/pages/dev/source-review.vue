<template>
  <ClientOnly>
    <div class="wrap">
      <header class="bar">
        <strong>plate reading</strong>
        <span class="dim">{{ savedCount }}/{{ total }} done</span>
        <span class="dim keys">⏎ save &amp; next · ←/→ move · u unreadable both</span>
      </header>

      <nav class="strip">
        <button
          v-for="it in items"
          :key="it.i"
          class="tick"
          :class="{ on: it.saved, cur: it.i === cursor }"
          @click="cursor = it.i"
        />
      </nav>

      <p v-if="pending" class="dim">loading…</p>
      <p v-else-if="error" class="warn">{{ error }}</p>

      <section v-else class="item">
        <!-- Full width: the plates are ~145px of a 1280px frame and the whole
             task is reading them. Nothing else is on screen on purpose — see
             server/api/dev/source-review.get.ts. -->
        <img class="frame" :src="`/api/dev/review-frame?sample=${cursor}`" :alt="`sample ${cursor + 1}`" >

        <div class="row">
          <label>
            <span class="lbl">LEFT plate</span>
            <select v-model="left" class="sel">
              <option :value="UNSET" disabled>— pick —</option>
              <option :value="NONE">— no readable plate —</option>
              <option v-for="c in roster" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <label>
            <span class="lbl">RIGHT plate</span>
            <select v-model="right" class="sel">
              <option :value="UNSET" disabled>— pick —</option>
              <option :value="NONE">— no readable plate —</option>
              <option v-for="c in roster" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <button class="save" :disabled="!answered || posting" @click="save()">
            {{ posting ? 'saving…' : 'save  ⏎' }}
          </button>
        </div>

        <p class="dim small">sample {{ cursor + 1 }} of {{ total }}</p>
        <p v-if="postError" class="warn">{{ postError }}</p>
      </section>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
// Dev-only per-frame plate-labelling surface. Verdicts POST to
// /api/dev/source-review, which writes ONLY data/plate-labels.json.
//
// The page is given a picture and an index and nothing else — no title, no
// description, no handles, no channel, no video id, no reader answer. That is a
// correction, not minimalism: the previous version showed the video title, every
// Tōkon title names two fighters per side, and all 17 labels it collected
// reproduced the title exactly.
//
// NO DEFAULT MAY PASS FOR AN ANSWER. Both selects start at a disabled sentinel,
// so "not yet answered" is structurally distinguishable from any real verdict —
// including "no readable plate", which IS a verdict here and one of the main
// things this pass measures.
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' });
}

/** Never saved. Distinguishes "untouched" from the real answer `NONE`. */
const UNSET = '__unset__';
/** A real verdict: there is no legible nameplate on this plate. */
const NONE = '';

interface Item {
  i: number;
  saved: { left: string | null; right: string | null } | null;
}

const { data, pending, error, refresh } = await useAsyncData(
  'dev-plate-review',
  () => $fetch<{ roster: { id: string; name: string }[]; total: number; items: Item[] }>(
    '/api/dev/source-review',
  ),
  { server: false },
);
const roster = computed(() => data.value?.roster ?? []);
const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.total ?? 0);
const savedCount = computed(() => items.value.filter((i) => i.saved).length);

const cursor = ref(0);
const left = ref<string>(UNSET);
const right = ref<string>(UNSET);
const posting = ref(false);
const postError = ref('');

const current = computed(() => items.value[cursor.value]);

// Reset per frame. A REVISIT reloads the labeller's own previous answer, which
// is theirs; an unlabelled frame always opens at the sentinel.
watch(
  current,
  (it) => {
    postError.value = '';
    left.value = it?.saved ? (it.saved.left ?? NONE) : UNSET;
    right.value = it?.saved ? (it.saved.right ?? NONE) : UNSET;
  },
  { immediate: true },
);

const answered = computed(() => left.value !== UNSET && right.value !== UNSET);

async function save(): Promise<void> {
  if (!answered.value || posting.value) return;
  posting.value = true;
  postError.value = '';
  try {
    await $fetch('/api/dev/source-review', {
      method: 'POST',
      body: {
        i: cursor.value,
        left: left.value === NONE ? null : left.value,
        right: right.value === NONE ? null : right.value,
      },
    });
    await refresh();
    const next = items.value.findIndex((it) => it.i > cursor.value && !it.saved);
    if (next >= 0) cursor.value = items.value[next]!.i;
    else if (cursor.value + 1 < total.value) cursor.value += 1;
  } catch (e) {
    postError.value = (e as { statusMessage?: string }).statusMessage ?? String(e);
  } finally {
    posting.value = false;
  }
}

function onKey(e: KeyboardEvent): void {
  // Enter commits from anywhere including the selects — the loop is two
  // type-aheads and a commit, and reaching for the mouse is the whole cost.
  if (e.key === 'Enter') {
    e.preventDefault();
    void save();
    return;
  }
  if (e.target instanceof HTMLSelectElement) return;
  if (e.key === 'ArrowRight') cursor.value = Math.min(cursor.value + 1, total.value - 1);
  else if (e.key === 'ArrowLeft') cursor.value = Math.max(cursor.value - 1, 0);
  else if (e.key === 'u') {
    left.value = NONE;
    right.value = NONE;
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
  gap: 1rem;
  align-items: baseline;
  flex-wrap: wrap;
  padding-bottom: 0.5rem;
}
.dim {
  color: #8e9bb5;
}
.keys {
  font-size: 12px;
  margin-left: auto;
}
.small {
  font-size: 12px;
}
.warn {
  color: #ffb45f;
}
.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 0.5rem 0 1rem;
}
.tick {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid #2a3550;
  background: #1a2338;
  cursor: pointer;
  padding: 0;
}
.tick.on {
  background: #23c29e;
}
.tick.cur {
  transform: scale(1.5);
  border-color: #03a5fe;
}
.frame {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 6px;
}
.row {
  display: flex;
  gap: 1.5rem;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-top: 1rem;
}
.lbl {
  display: block;
  font-size: 12px;
  color: #8e9bb5;
  margin-bottom: 0.25rem;
}
.sel,
.save {
  background: #1a2338;
  color: #e8ecf5;
  border: 1px solid #2a3550;
  border-radius: 5px;
  padding: 7px 10px;
  font: inherit;
  cursor: pointer;
}
.sel {
  min-width: 220px;
}
.save {
  padding: 8px 18px;
}
.save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
