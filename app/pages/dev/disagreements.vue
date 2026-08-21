<template>
  <ClientOnly>
    <section class="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-[26px]">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <p class="font-mono text-label uppercase text-text-muted">Diagnostic — dev only</p>
          <h1 class="mt-1 font-display text-d2 font-bold text-text">Disagreements</h1>
        </div>
        <p class="ml-auto font-mono text-[12px] text-text-muted">
          human reads vs the automatic tiers
        </p>
      </div>

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

      <template v-else>
        <section class="block">
          <h2>cross-tier</h2>
          <p
            v-if="!crossRows.length"
            class="ok"
          >
            No disagreements across {{ scanned }} human-read sides — no title, description or
            footage tier named a fighter the reader did not see.
          </p>
          <table
            v-else
            class="tbl"
          >
            <thead>
              <tr>
                <th>record</th>
                <th>side</th>
                <th>tier</th>
                <th>tier claimed</th>
                <th>human read</th>
                <th>missing</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(r, i) in crossRows"
                :key="i"
              >
                <td class="mono">{{ r.video }}</td>
                <td>{{ r.sideIndex + 1 }}</td>
                <td>{{ r.tier }}</td>
                <td>{{ r.claimedNames.join(', ') }}</td>
                <td>{{ r.humanNames.join(', ') }}</td>
                <td class="warn">{{ r.missingNames.join(', ') }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="block">
          <h2>
            off-bench reads <span class="dim">({{ off.length }})</span>
          </h2>
          <p class="dim note">
            A fighter read in a diamond that appears in <em>neither</em> of the record's described
            benches. Tōkon allows a mid-set team change and the contract counts sides of more than
            four, so the question is whether the uploader left a swap out of their description or
            the read was wrong.
          </p>
          <p
            v-if="!off.length"
            class="ok"
          >
            None outstanding.
          </p>

          <article
            v-for="o in off"
            :key="o.key"
            class="item"
          >
            <img
              class="crop"
              :src="`/api/dev/portrait-crop?video=${o.video}&sec=${o.sec}&side=${o.side}`"
              :alt="o.key"
              @error="onCropError"
            />
            <div class="detail">
              <p class="mono dim">{{ o.key }}</p>
              <p class="dim">
                The cyan diamonds are what was read; the dashed box is the point fighter.
                <strong>{{ o.cell }}</strong> is the one in question.
              </p>
              <p>
                read <strong class="hot">{{ o.readName }}</strong> in the
                <strong>{{ o.cell }}</strong> diamond · on point {{ o.pointName }}
              </p>
              <p class="dim">
                described benches —
                <span
                  v-for="(b, bi) in o.benchNames"
                  :key="bi"
                  class="bench"
                >
                  {{ b.join('/') }}<span v-if="bi === 0"> · </span>
                </span>
              </p>
              <p
                v-if="o.applied"
                class="ok"
              >
                already appended to side {{ o.sideIndex + 1 }}
              </p>
              <div
                v-else
                class="acts"
              >
                <button
                  class="act keep"
                  :disabled="busy"
                  @click="decide(o.key, 'team-change')"
                >
                  the read is right — append to side {{ o.sideIndex + 1 }}
                </button>
                <select
                  class="sel"
                  :disabled="busy"
                  @change="reassign(o.key, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">it is actually…</option>
                  <option
                    v-for="r in roster"
                    :key="r.id"
                    :value="r.id"
                  >
                    {{ r.name }}
                  </option>
                </select>
                <button
                  class="act drop"
                  :disabled="busy"
                  @click="decide(o.key, 'misread')"
                >
                  nothing readable — drop it
                </button>
              </div>
            </div>
          </article>
        </section>
      </template>
    </section>
  </ClientOnly>
</template>

<script setup lang="ts">
/**
 * Dev-only review of human-vs-machine disagreements.
 *
 * The cross-tier table is empty today and says so with its denominator. That is
 * deliberate: a check reporting nothing and a check that never ran look identical
 * on a blank page, and this one is the standing guard over every side drained from
 * here on.
 */

// Declares this tool on the /dev index (engine app/pages/dev/index.vue). Every
// value MUST stay a plain quoted literal — the build extracts them from the AST
// and a variable or backtick string drops the key silently.
definePageMeta({
  devTool: {
    title: 'Disagreements',
    category: 'Diagnostic',
    description:
      'Human reads versus the automatic tiers — cross-tier conflicts and the off-bench read queue.',
  },
});

if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' });
}

interface Cross {
  video: string;
  sideIndex: number;
  tier: string;
  claimedNames: string[];
  humanNames: string[];
  missingNames: string[];
}
interface Off {
  key: string;
  video: string;
  sec: number;
  side: 'L' | 'R';
  cell: string;
  readName: string;
  pointName: string;
  sideIndex: number;
  benchNames: string[][];
  applied: boolean;
}

const busy = ref(false);
const { data, pending, error, refresh } = await useFetch<{
  crossTier: { scanned: number; rows: Cross[] };
  offBench: Off[];
  roster: { id: string; name: string }[];
}>('/api/dev/disagreements');

const crossRows = computed(() => data.value?.crossTier.rows ?? []);
const scanned = computed(() => data.value?.crossTier.scanned ?? 0);
const off = computed(() => data.value?.offBench ?? []);
const roster = computed(() => data.value?.roster ?? []);

async function reassign(key: string, char: string): Promise<void> {
  if (!char) return;
  busy.value = true;
  try {
    await $fetch('/api/dev/disagreements', {
      method: 'POST',
      body: { key, verdict: 'reassign', char },
    });
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function decide(key: string, verdict: 'team-change' | 'misread'): Promise<void> {
  busy.value = true;
  try {
    await $fetch('/api/dev/disagreements', { method: 'POST', body: { key, verdict } });
    await refresh();
  } finally {
    busy.value = false;
  }
}

// The crop is addressed directly by video + second now, so the only way here is a
// frame that has actually been evicted from the cache. Worth saying plainly,
// because a verdict cast without the evidence is the thing this page exists to
// prevent.
function onCropError(e: Event): void {
  const el = e.target as HTMLImageElement;
  el.replaceWith(
    Object.assign(document.createElement('p'), {
      className: 'warn',
      textContent: 'frame is gone from the cache — do not judge this one blind',
    }),
  );
}
</script>

<style scoped>
/* Two report tables and a decision list — the shape Tailwind is worst at, so it
   stays scoped CSS. What changed is the palette: every colour is now an engine
   semantic token. The old `var(--char-muted, #8b93a7)` pairs were fiction —
   no `--char-*` custom property is defined anywhere in the engine, so each one
   always resolved to its hardcoded fallback. */
h2 {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
  margin: 0 0 0.75rem;
}
.block {
  margin-top: 2.5rem;
}
.dim {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.warn {
  color: var(--color-warning);
}
.ok {
  color: var(--color-success);
  font-size: 0.9rem;
}
.hot {
  color: var(--color-secondary);
}
.mono {
  font-family: var(--font-mono);
}
.note {
  max-width: 46rem;
}
.tbl {
  border-collapse: collapse;
  font-size: 0.85rem;
  width: 100%;
}
.tbl th,
.tbl td {
  text-align: left;
  padding: 0.3rem 0.6rem;
  border-bottom: 1px solid var(--color-border-subtle);
}
.tbl th {
  color: var(--color-text-muted);
  font-weight: 600;
}
.item {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin: 1rem 0;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-wrap: wrap;
}
.crop {
  image-rendering: pixelated;
  width: 340px;
  max-width: 100%;
}
.detail {
  flex: 1 1 20rem;
}
.detail p {
  margin: 0 0 0.4rem;
}
.acts {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
  flex-wrap: wrap;
}
.act {
  font: inherit;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: transparent;
  color: inherit;
}
.act.keep {
  background: var(--color-success);
  border-color: var(--color-success);
  color: var(--color-bg);
  font-weight: 600;
}
.act.drop {
  border-color: var(--color-warning);
  color: var(--color-warning);
}
.act:disabled {
  opacity: 0.4;
  cursor: default;
}
.sel {
  font: inherit;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text);
}
.sel option {
  background: var(--color-surface-raised);
  color: var(--color-text);
}
</style>
