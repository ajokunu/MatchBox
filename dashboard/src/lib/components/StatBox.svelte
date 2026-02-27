<script lang="ts">
  let {
    label = '',
    value = '...',
    color = ''
  }: { label: string; value: string | number; color?: string } = $props();
</script>

<div class="stat-box">
  <div class="stat-label">{label}</div>
  <div class="stat-value" style={color ? `color: ${color}` : ''}>
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
</style>
