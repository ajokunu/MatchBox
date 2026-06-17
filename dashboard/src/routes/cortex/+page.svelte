<script lang="ts">
  import ServiceDetailLayout from '$lib/components/ServiceDetailLayout.svelte';
  import StatBox from '$lib/components/StatBox.svelte';
  import { publicUrls, LOADING_PLACEHOLDER } from '$lib/config';
</script>

<ServiceDetailLayout
  title="Cortex - Analysis & Response"
  icon="Brain"
  endpoint="/api/cortex"
  externalUrl={publicUrls.cortex}
  externalLabel="Open Cortex"
  errorLabel="Could not reach Cortex"
  connectingLabel="Connecting to Cortex..."
>
  {#snippet children(data)}
    <div class="stats-row">
      <StatBox label="Status" value={String(data.status ?? 'unknown')} color="green" />
      <StatBox label="Version" value={String(data.version ?? LOADING_PLACEHOLDER)} />
      <StatBox label="Analyzers" value={Number(data.analyzers ?? 0)} color="accent" />
      <StatBox
        label="Config"
        value={data.configured ? 'Active' : 'Setup Required'}
        color={data.configured ? 'green' : 'yellow'}
      />
    </div>

    {#if !data.configured}
      <div class="info-card warn">
        <div class="info-title">Initial Setup Required</div>
        <p class="info-text">
          Cortex needs an organization and admin user before analyzers can be configured.
          Click "Open Cortex" above to complete the initial setup wizard, then update
          CORTEX_API_KEY in dashboard/.env with the generated API key.
        </p>
      </div>
    {/if}

    <div class="info-card" style="margin-top: 12px;">
      <div class="info-title">Cortex SOAR Platform</div>
      <p class="info-text">
        Cortex provides automated analysis of observables (IPs, hashes, domains)
        using configurable analyzers and responders. Integrated with TheHive for
        one-click analysis during incident investigations.
      </p>
    </div>
  {/snippet}
</ServiceDetailLayout>

<style>
  .stats-row {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 8px; margin-bottom: 16px;
  }
  .info-card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px;
  }
  .info-card.warn { border-color: var(--accent-yellow); }
  .info-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
  .info-text { font-size: 11px; color: var(--text-secondary); line-height: 1.6; }
</style>
