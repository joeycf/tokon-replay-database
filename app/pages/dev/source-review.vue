<template>
  <ClientOnly>
    <section class="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-[26px]">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <p class="font-mono text-label uppercase text-text-muted">Curation — dev only</p>
          <h1 class="mt-1 font-display text-d2 font-bold text-text">Plate reading</h1>
        </div>
        <p class="font-mono text-[12px] text-text-muted">{{ savedCount }}/{{ total }} done</p>
        <p class="ml-auto font-mono text-[12px] text-text-muted">
          ⏎ save &amp; next · ←/→ move · u unreadable both
        </p>
      </div>

      <nav class="strip">
        <button
          v-for="it in items"
          :key="it.i"
          class="tick"
          :class="{ on: it.saved, cur: it.i === cursor }"
          @click="cursor = it.i"
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

      <section
        v-else
        class="item"
      >
        <!-- Full width: the plates are ~145px of a 1280px frame and the whole
             task is reading them. Nothing else is on screen on purpose — see
             server/api/dev/source-review.get.ts. -->
        <img
          class="frame"
          :src="`/api/dev/review-frame?sample=${cursor}`"
          :alt="`sample ${cursor + 1}`"
        />

        <div class="row">
          <label>
            <span class="mb-1 block font-mono text-[12px] text-text-muted">LEFT plate</span>
            <select
              v-model="left"
              class="min-w-[220px] border border-border bg-surface-raised px-2.5 py-1.5 font-ui text-body text-text cut-sm"
            >
              <option
                :value="UNSET"
                disabled
              >
                — pick —
              </option>
              <option :value="NONE">— no readable plate —</option>
              <option
                v-for="c in roster"
                :key="c.id"
                :value="c.id"
              >
                {{ c.name }}
              </option>
            </select>
          </label>
          <label>
            <span class="mb-1 block font-mono text-[12px] text-text-muted">RIGHT plate</span>
            <select
              v-model="right"
              class="min-w-[220px] border border-border bg-surface-raised px-2.5 py-1.5 font-ui text-body text-text cut-sm"
            >
              <option
                :value="UNSET"
                disabled
              >
                — pick —
              </option>
              <option :value="NONE">— no readable plate —</option>
              <option
                v-for="c in roster"
                :key="c.id"
                :value="c.id"
              >
                {{ c.name }}
              </option>
            </select>
          </label>
          <button
            class="border border-border bg-surface-raised px-[18px] py-2 font-ui text-body text-text transition-colors cut-sm hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!answered || posting"
            @click="save()"
          >
            {{ posting ? 'saving…' : 'save  ⏎' }}
          </button>
        </div>

        <p class="mt-3 font-mono text-[12px] text-text-muted">
          sample {{ cursor + 1 }} of {{ total }}
        </p>
        <p
          v-if="postError"
          class="mt-2 font-mono text-body text-warning"
        >
          {{ postError }}
        </p>
      </section>
    </section>
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

// Declares this tool on the /dev index (engine app/pages/dev/index.vue). Every
// value MUST stay a plain quoted literal — the build extracts them from the AST
// and a variable or backtick string drops the key silently.
definePageMeta({
  devTool: {
    title: 'Plate reading',
    category: 'Curation',
    description:
      'Label the left and right nameplates on each sampled frame. No title, no handles, nothing to anchor on.',
    writes: 'data/plate-labels.json',
  },
});

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
  () =>
    $fetch<{ roster: { id: string; name: string }[]; total: number; items: Item[] }>(
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
/* Only what Tailwind has no good answer for: the progress strip's tick states
   and the full-bleed frame. Everything else is engine utilities, and every
   colour is a semantic token — the page used to paint its own #101627 over the
   layout's background. */
.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 1.5rem 0 1rem;
}
.tick {
  width: 12px;
  height: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  cursor: pointer;
  padding: 0;
}
.tick.on {
  background: var(--color-success);
}
.tick.cur {
  transform: scale(1.5);
  border-color: var(--color-primary);
}
.frame {
  width: 100%;
  height: auto;
  display: block;
}
.row {
  display: flex;
  gap: 1.5rem;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-top: 1rem;
}
</style>
