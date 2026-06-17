<script lang="ts">
  // `label` lets callers name the service so screen readers announce e.g. "Wazuh: online"
  // rather than status being conveyed by color/animation alone.
  let {
    status = 'checking',
    label = ''
  }: {
    status: 'online' | 'degraded' | 'offline' | 'checking';
    label?: string;
  } = $props();

  let ariaLabel = $derived(label ? `${label}: ${status}` : `Status: ${status}`);
</script>

<span
  class="dot"
  class:online={status === 'online'}
  class:degraded={status === 'degraded'}
  class:offline={status === 'offline'}
  class:checking={status === 'checking'}
  role="img"
  aria-label={ariaLabel}
></span>

<style>
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    transition: all 0.3s ease;
  }
  .online {
    background: var(--accent-green);
    box-shadow: 0 0 4px rgba(42, 161, 152, 0.4);
  }
  .degraded {
    background: var(--accent-yellow);
    box-shadow: 0 0 4px rgba(181, 137, 0, 0.4);
    animation: blink 2s ease-in-out infinite;
  }
  .offline {
    background: var(--accent);
    box-shadow: 0 0 4px rgba(203, 45, 62, 0.4);
    animation: blink 1s ease-in-out infinite;
  }
  .checking {
    background: var(--accent-yellow);
    box-shadow: 0 0 4px rgba(181, 137, 0, 0.4);
  }

  /* Respect reduced-motion: hold dots static instead of blinking. */
  @media (prefers-reduced-motion: reduce) {
    .degraded,
    .offline {
      animation: none;
    }
  }
</style>
