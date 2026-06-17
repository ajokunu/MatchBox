<script lang="ts">
  // `color` is constrained to a known variant set mapped to CSS classes instead of
  // free-form inline `style` interpolation — removes the CSS-injection surface and
  // centralizes theming (was `style={`color: ${color}`}` from an arbitrary string).
  type ColorVariant = 'default' | 'accent' | 'green' | 'yellow';

  let {
    label = '',
    value = '...',
    color = 'default'
  }: { label: string; value: string | number; color?: ColorVariant } = $props();
</script>

<div class="stat-box">
  <div class="stat-label">{label}</div>
  <div class="stat-value" class:accent={color === 'accent'} class:green={color === 'green'} class:yellow={color === 'yellow'}>
    {value}
  </div>
</div>

<style>
  .stat-box {
    background: var(--bg-primary);
    border-radius: 5px;
    padding: 6px 8px;
    border: 1px solid var(--border);
  }
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
</style>
