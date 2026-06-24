<script lang="ts">
import ServiceDetailLayout from '$lib/components/ServiceDetailLayout.svelte';
import StatBox from '$lib/components/StatBox.svelte';
import { LOADING_PLACEHOLDER, publicUrls } from '$lib/config';
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
    <!--
      Distinguish genuine zeros from "no data yet" (finding 22/59). Without a token the
      server returns only `status`/`note` (count fields undefined) — those render as muted
      placeholders rather than a misleading `0`. A real 0 (token configured, empty graph)
      still renders as a normal zero.
    -->
    <div class="stats-row">
      <StatBox label="Status" value={String(data.status ?? 'unknown')} color="green" />
      <StatBox label="Version" value={String(data.version ?? LOADING_PLACEHOLDER)} empty={data.version === undefined} />
      <StatBox label="Indicators" value={Number(data.indicators ?? 0)} color="accent" empty={data.indicators === undefined} />
      <StatBox label="Observables" value={Number(data.observables ?? 0)} color="accent" empty={data.observables === undefined} />
      <StatBox label="Reports" value={Number(data.reports ?? 0)} empty={data.reports === undefined} />
      <StatBox label="Malwares" value={Number(data.malwares ?? 0)} empty={data.malwares === undefined} />
      <StatBox
        label="Connectors"
        value={`${Number(data.activeConnectors ?? 0)}/${Number(data.connectors ?? 0)}`}
        color="green"
        empty={data.connectors === undefined}
      />
      <StatBox label="Threat Actors" value={Number(data.threatActors ?? 0)} empty={data.threatActors === undefined} />
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
