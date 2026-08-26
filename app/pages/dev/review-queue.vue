<template>
  <ClientOnly>
    <section class="mx-auto w-full max-w-[1100px] px-4 py-8 md:px-[26px]">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <p class="font-mono text-label uppercase text-text-muted">Curation — dev only</p>
          <h1 class="mt-1 font-display text-d2 font-bold text-text">Review queue</h1>
        </div>
        <p class="font-mono text-[12px] text-text-muted">
          {{ doneCount }}/{{ items.length }} judged
        </p>
      </div>

      <p class="mt-3 max-w-[70ch] font-ui text-body text-text-secondary">
        Records held off the site because no fighter resolved in either title slot. Nothing here has
        frames — the extractor works from the bench queue, which these never reach — so the evidence
        is the title and the video itself. A verdict lands on the next
        <code class="font-mono text-[12px]">data:catchup</code>, not now.
      </p>
      <p
        v-if="otherKindsText"
        class="mt-2 font-mono text-[12px] text-warning"
      >
        Not shown here: {{ otherKindsText }} — different shape, no form built.
      </p>

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
      <p
        v-else-if="!items.length"
        class="mt-6 font-mono text-body text-text-muted"
      >
        review queue is empty 🎉
      </p>

      <article
        v-for="it in items"
        v-else
        :key="it.id"
        class="card"
        :class="{ judged: !!it.saved }"
      >
        <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="font-mono text-[12px] text-text-muted">{{ it.channel }}</span>
          <a
            class="font-mono text-[12px] text-primary underline"
            :href="`https://www.youtube.com/watch?v=${it.id}`"
            target="_blank"
            rel="noopener"
            >open on YouTube ↗</a
          >
          <span
            v-if="it.saved"
            class="ml-auto font-mono text-[12px] text-success"
            >{{ it.saved.verdict === 'reject' ? 'rejected' : 'completed' }}</span
          >
        </header>
        <p class="mt-1 font-ui text-body text-text">{{ it.title }}</p>

        <p
          v-if="it.blocked"
          class="mt-2 font-mono text-[12px] text-warning"
        >
          Cannot be judged here — {{ it.blocked }}. The title states its fighters with no
          parentheses, so the slot boundary is wrong and the whole span became the handle. A verdict
          would mint a second player page beside the real one. This needs a grammar, not an answer.
        </p>

        <div
          v-for="(handle, si) in it.handles"
          v-else
          :key="si"
          class="side"
        >
          <span class="font-mono text-[13px] font-semibold text-text">{{ handle || '—' }}</span>
          <select
            v-for="slot in SLOTS"
            :key="slot"
            v-model="picks[it.id]![si]![slot]"
            class="min-w-[150px] border border-border bg-surface-raised px-2 py-1 font-ui text-[13px] text-text cut-sm"
          >
            <option value="">—</option>
            <option
              v-for="c in roster"
              :key="c.id"
              :value="c.id"
            >
              {{ c.name }}
            </option>
          </select>
        </div>

        <footer class="mt-3 flex flex-wrap items-center gap-3">
          <button
            v-if="!it.blocked"
            class="btn"
            :disabled="!canSave(it.id) || posting === it.id"
            @click="save(it.id, 'complete')"
          >
            save verdict
          </button>
          <button
            class="btn warn"
            :disabled="posting === it.id"
            @click="save(it.id, 'reject')"
          >
            not a match
          </button>
          <span
            v-if="errs[it.id]"
            class="font-mono text-[12px] text-warning"
            >{{ errs[it.id] }}</span
          >
        </footer>
      </article>
    </section>
  </ClientOnly>
</template>

<script setup lang="ts">
/**
 * Dev-only: give a verdict on a record the parser could not resolve.
 *
 * THE ONLY EXIT THIS QUEUE HAS. A `character-completion` record is absent from
 * videos.json, therefore absent from bench-queue.json, so the extractor cannot
 * read its footage and /dev/bench-review cannot list it; and applyOverrides maps
 * over records the parser built, which these never become. Before this page,
 * resolving one took a commit.
 *
 * NOTHING IS PUBLISHED FROM HERE. A verdict is written to overrides.json and
 * read by scripts/parse.ts at the point the record would otherwise be queued —
 * so it takes effect on the next `data:catchup`, and is reversible by deleting
 * the entry. Same contract as every other override in the project.
 */

// Declares this tool on the /dev index (engine app/pages/dev/index.vue). Every
// value MUST stay a plain quoted literal — the build extracts them from the AST
// and a variable or backtick string drops the key silently.
definePageMeta({
  devTool: {
    title: 'Review queue',
    category: 'Curation',
    description:
      'Judge records the parser held off the site: name the fighters, or reject it as not a match.',
    writes: 'data/overrides.json',
  },
});

if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' });
}

/** Four slots per side — charactersPerSide for this game. A side may legitimately
 *  be shorter (the parser accepts 1..N), so empty picks are dropped rather than
 *  demanded; what is refused is a side with NOTHING picked. */
const SLOTS = [0, 1, 2, 3] as const;

interface Item {
  id: string;
  channel: string;
  title: string;
  handles: [string, string];
  /** non-null when the record's own handles make a verdict unsafe */
  blocked: string | null;
  saved: { verdict: 'reject' } | { verdict: 'complete'; sides: string[][] } | null;
}

const { data, pending, error, refresh } = await useAsyncData(
  'dev-review-queue',
  () =>
    $fetch<{
      roster: { id: string; name: string }[];
      otherKinds: Record<string, number>;
      items: Item[];
    }>('/api/dev/review-queue'),
  { server: false },
);

const roster = computed(() => data.value?.roster ?? []);
const items = computed(() => data.value?.items ?? []);
const doneCount = computed(() => items.value.filter((i) => i.saved).length);
const otherKindsText = computed(() =>
  Object.entries(data.value?.otherKinds ?? {})
    .map(([k, n]) => `${n} ${k}`)
    .join(' · '),
);

const picks = ref<Record<string, [Record<number, string>, Record<number, string>]>>({});
const posting = ref('');
const errs = ref<Record<string, string>>({});

// A SAVED VERDICT REOPENS AS ITSELF. bench-review records what the alternative
// costs: ticks that stay grey while writes land perfectly invite the same record
// to be judged twice, and a false grey is worse than a false green because it
// spends the scarcest thing here, which is somebody's attention.
watch(
  items,
  (list) => {
    for (const it of list) {
      if (picks.value[it.id]) continue;
      const from = it.saved?.verdict === 'complete' ? it.saved.sides : [[], []];
      picks.value[it.id] = [0, 1].map((si) =>
        Object.fromEntries(SLOTS.map((s) => [s, from[si]?.[s] ?? ''])),
      ) as [Record<number, string>, Record<number, string>];
    }
  },
  { immediate: true },
);

const sidesOf = (id: string): string[][] =>
  (picks.value[id] ?? [{}, {}]).map((side) => [
    ...new Set(SLOTS.map((s) => side[s] ?? '').filter(Boolean)),
  ]);

/** Both sides must name at least one fighter. Refusing an empty side here is the
 *  same rule the endpoint enforces server-side; this only saves a round trip. */
const canSave = (id: string): boolean => sidesOf(id).every((s) => s.length > 0);

async function save(id: string, verdict: 'complete' | 'reject'): Promise<void> {
  if (posting.value) return;
  posting.value = id;
  errs.value = { ...errs.value, [id]: '' };
  try {
    await $fetch('/api/dev/review-queue', {
      method: 'POST',
      body: verdict === 'reject' ? { id, verdict } : { id, verdict, sides: sidesOf(id) },
    });
    await refresh();
  } catch (e) {
    errs.value = {
      ...errs.value,
      [id]: (e as { statusMessage?: string }).statusMessage ?? String(e),
    };
  } finally {
    posting.value = '';
  }
}
</script>

<style scoped>
.card {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  padding: 1rem 1.1rem;
  margin-top: 1.25rem;
}
.card.judged {
  border-color: var(--color-success);
}
.side {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.side > span:first-child {
  min-width: 12ch;
}
.btn {
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text);
  padding: 0.4rem 0.9rem;
  font-family: var(--font-mono);
  font-size: 13px;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn.warn {
  color: var(--color-warning);
}
</style>
