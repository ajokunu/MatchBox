<script lang="ts">
// `color` is constrained to a known variant set mapped to CSS classes instead of
// free-form inline `style` interpolation — removes the CSS-injection surface and
// centralizes theming (was `style={`color: ${color}`}` from an arbitrary string).
type ColorVariant = 'default' | 'accent' | 'green' | 'yellow';

let {
  label = '',
  value = '...',
  color = 'default',
  // `empty` marks a "no data yet" state — a service that was reached but has not been
  // populated yet (e.g. no API key, or a metric the upstream did not return). It renders
  // a muted em-dash placeholder so it is visually distinct from a *genuine* zero value
  // (finding 22 / 59). Genuine zeros keep their normal emphasized styling.
  empty = false,
  emptyHint = 'no data yet',
}: {
  label: string;
  value: string | number;
  color?: ColorVariant;
  empty?: boolean;
  emptyHint?: string;
} = $props();
</script>

<div class="stat-box" class:is-empty={empty}>
  <div class="stat-label">{label}</div>
  {#if empty}
    <!-- No-data placeholder: muted em-dash, never styled as a real metric. -->
    <div class="stat-value empty" title={emptyHint} aria-label="{label}: {emptyHint}">—</div>
  {:else}
    <div class="stat-value" class:accent={color === 'accent'} class:green={color === 'green'} class:yellow={color === 'yellow'}>
      {value}
    </div>
  {/if}
</div>

<style>
  .stat-box {
    background: var(--bg-primary);
    border-radius: 5px;
    padding: 6px 8px;
    border: 1px solid var(--border);
  }
  /* Dashed border signals "awaiting data" at a glance, distinct from a populated card. */
  .stat-box.is-empty { border-style: dashed; }
  .stat-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .stat-value {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
  }
  .stat-value.accent { color: var(--accent); }
  .stat-value.green { color: var(--accent-green); }
  .stat-value.yellow { color: var(--accent-yellow); }
  /* Empty state: de-emphasized so a placeholder never reads as a real measurement. */
  .stat-value.empty { color: var(--text-dim); font-weight: 400; opacity: 0.65; }
</style>
