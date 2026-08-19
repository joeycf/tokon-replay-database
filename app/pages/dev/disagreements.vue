<template>
  <ClientOnly>
    <div class="wrap">
      <header class="bar">
        <strong>disagreements</strong>
        <span class="dim">human reads vs the automatic tiers</span>
      </header>

      <p v-if="pending" class="dim">loading…</p>
      <p v-else-if="error" class="warn">{{ error }}</p>

      <template v-else>
        <section class="block">
          <h2>cross-tier</h2>
          <p v-if="!crossRows.length" class="ok">
            No disagreements across {{ scanned }} human-read sides — no title,
            description or footage tier named a fighter the reader did not see.
          </p>
          <table v-else class="tbl">
            <thead>
              <tr><th>record</th><th>side</th><th>tier</th><th>tier claimed</th><th>human read</th><th>missing</th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in crossRows" :key="i">
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
          <h2>off-bench reads <span class="dim">({{ off.length }})</span></h2>
          <p class="dim note">
            A fighter read in a diamond that appears in <em>neither</em> of the
            record's described benches. Tōkon allows a mid-set team change and the
            contract counts sides of more than four, so the question is whether the
            uploader left a swap out of their description or the read was wrong.
          </p>
          <p v-if="!off.length" class="ok">None outstanding.</p>

          <article v-for="o in off" :key="o.key" class="item">
            <img
              class="crop"
              :src="`/api/dev/portrait-crop?pool=bench&video=${o.video}&side=${o.side}&frame=0`"
              :alt="o.key"
              @error="onCropError"
            >
            <div class="detail">
              <p class="mono dim">{{ o.key }}</p>
              <p>read <strong class="hot">{{ o.readName }}</strong> in the
                <strong>{{ o.cell }}</strong> diamond · on point {{ o.pointName }}</p>
              <p class="dim">
                described benches —
                <span v-for="(b, bi) in o.benchNames" :key="bi" class="bench">
                  {{ b.join('/') }}<span v-if="bi === 0"> · </span>
                </span>
              </p>
              <p v-if="o.applied" class="ok">already appended to side {{ o.sideIndex + 1 }}</p>
              <div v-else class="acts">
                <button class="act keep" :disabled="busy" @click="decide(o.key, 'team-change')">
                  team change — append to side {{ o.sideIndex + 1 }}
                </button>
                <button class="act drop" :disabled="busy" @click="decide(o.key, 'misread')">
                  misread — drop the label
                </button>
              </div>
            </div>
          </article>
        </section>
      </template>
    </div>
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
}>('/api/dev/disagreements');

const crossRows = computed(() => data.value?.crossTier.rows ?? []);
const scanned = computed(() => data.value?.crossTier.scanned ?? 0);
const off = computed(() => data.value?.offBench ?? []);

async function decide(key: string, verdict: 'team-change' | 'misread'): Promise<void> {
  busy.value = true;
  try {
    await $fetch('/api/dev/disagreements', { method: 'POST', body: { key, verdict } });
    await refresh();
  } finally {
    busy.value = false;
  }
}

// The crop endpoint serves the bench worklist, which these description-derived
// records are not in. Say so rather than leaving a broken-image icon, which is how
// the last endpoint mismatch presented itself.
function onCropError(e: Event): void {
  const el = e.target as HTMLImageElement;
  el.replaceWith(
    Object.assign(document.createElement('p'), {
      className: 'dim',
      textContent: 'crop unavailable — this record is not in the bench worklist',
    }),
  );
}
</script>

<style scoped>
.wrap {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
  font-family: var(--font-sans, system-ui), sans-serif;
}
.bar {
  display: flex;
  gap: 1rem;
  align-items: baseline;
  margin-bottom: 1rem;
}
h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}
.block {
  margin-bottom: 2rem;
}
.dim {
  color: var(--char-muted, #8b93a7);
  font-size: 0.85rem;
}
.warn {
  color: var(--char-danger, #ff5a5f);
}
.ok {
  color: #35c46b;
  font-size: 0.9rem;
}
.hot {
  color: #ff9d2e;
}
.mono {
  font-family: ui-monospace, monospace;
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
  border-bottom: 1px solid #2a2f3f;
}
.item {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin: 1rem 0;
  padding-bottom: 1rem;
  border-bottom: 1px solid #2a2f3f;
  flex-wrap: wrap;
}
.crop {
  image-rendering: pixelated;
  width: 340px;
  max-width: 100%;
  border-radius: 4px;
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
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid #3a4055;
  background: transparent;
  color: inherit;
}
.act.keep {
  background: #35c46b;
  border-color: #35c46b;
  color: #04121a;
  font-weight: 600;
}
.act.drop {
  border-color: #ff5a5f;
  color: #ff5a5f;
}
.act:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
