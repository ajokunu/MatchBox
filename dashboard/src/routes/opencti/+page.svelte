<script lang="ts">
  import ServiceDetailLayout from '$lib/components/ServiceDetailLayout.svelte';
  import StatBox from '$lib/components/StatBox.svelte';
  import { publicUrls, LOADING_PLACEHOLDER } from '$lib/config';
</script>

<ServiceDetailLayout
  title="OpenCTI - Threat Intelligence"
  icon="Radar"
  endpoint="/api/opencti"
  externalUrl={publicUrls.opencti}
  externalLabel="Open OpenCTI"
  errorLabel="Could not reach OpenCTI"
  connectingLabel="Connecting to OpenCTI..."
>
  {#snippet children(data)}
    <div class="stats-row">
      <StatBox label="Status" value={String(data.status ?? 'unknown')} color="green" />
      <StatBox label="Version" value={String(data.version ?? LOADING_PLACEHOLDER)} />
      <StatBox label="Indicators" value={Number(data.indicators ?? 0)} color="accent" />
      <StatBox label="Observables" value={Number(data.observables ?? 0)} color="accent" />
      <StatBox label="Reports" value={Number(data.reports ?? 0)} />
      <StatBox label="Malwares" value={Number(data.malwares ?? 0)} />
      <StatBox
        label="Connectors"
        value={`${Number(data.activeConnectors ?? 0)}/${Number(data.connectors ?? 0)}`}
        color="green"
      />
      <StatBox label="Threat Actors" value={Number(data.threatActors ?? 0)} />
    </div>

    {#if data.note}
      <!-- Server note and client hint rendered as separate elements (no string concat). -->
      <div class="info-card">
        <p class="info-text">{data.note}</p>
        <p class="info-hint">Set OPENCTI_TOKEN in dashboard/.env to see full metrics.</p>
      </div>
    {/if}

    <div class="info-card" style="margin-top: 12px;">
      <div class="info-title">OpenCTI Platform</div>
      <p class="info-text">
        OpenCTI blocks iframe embedding (Content-Security-Policy: frame-ancestors 'none').
        Click "Open OpenCTI" to access the full platform with STIX/TAXII feeds,
        MITRE ATT&CK mapping, indicator enrichment, and threat intelligence reports.
        Import STIX bundles or configure connectors to populate threat data.
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
  .info-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
  .info-text { font-size: 11px; color: var(--text-secondary); line-height: 1.6; }
  .info-hint { font-size: 10px; color: var(--text-dim); line-height: 1.6; margin-top: 4px; }
</style>
