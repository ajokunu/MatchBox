<script lang="ts">
import ServiceDetailLayout from '$lib/components/ServiceDetailLayout.svelte';
import StatBox from '$lib/components/StatBox.svelte';
import { LOADING_PLACEHOLDER, publicUrls } from '$lib/config';
</script>

<ServiceDetailLayout
  title="TheHive - Incident Response"
  icon="ShieldAlert"
  endpoint="/api/thehive"
  externalUrl={publicUrls.thehive}
  externalLabel="Open TheHive"
  errorLabel="Could not reach TheHive"
  connectingLabel="Connecting to TheHive..."
>
  {#snippet children(data)}
    <!--
      Distinguish a genuine zero from "no data yet" (finding 22/59). When the server omits
      the count fields entirely (no API key → only `status`/`note` returned), the metric was
      never populated, so render the muted empty placeholder instead of a misleading `0`.
      When the field IS present (key configured), a real 0 renders as a normal zero.
    -->
    {@const hasCaseMetrics = data.openCases !== undefined}
    {@const hasAlertMetrics = data.alerts !== undefined}
    <div class="stats-row">
      <StatBox label="Status" value={String(data.status ?? 'unknown')} color="green" />
      <StatBox label="Version" value={String(data.version ?? LOADING_PLACEHOLDER)} empty={data.version === undefined} />
      <StatBox label="Open Cases" value={Number(data.openCases ?? 0)} color="accent" empty={!hasCaseMetrics} />
      <StatBox label="Alerts" value={Number(data.alerts ?? 0)} color="accent" empty={!hasAlertMetrics} />
    </div>

    {#if data.note}
      <!-- Server note and client hint rendered as separate elements (no string concat). -->
      <div class="info-card">
        <p class="info-text">{data.note}</p>
        <p class="info-hint">Set THEHIVE_API_KEY in dashboard/.env to see full metrics.</p>
      </div>
    {/if}

    <div class="info-card" style="margin-top: 12px;">
      <div class="info-title">TheHive Incident Response Platform</div>
      <p class="info-text">
        TheHive is your incident response platform for managing security cases, alerts,
        and observables. Create cases from Wazuh alerts, enrich IOCs with Cortex analyzers,
        and track incident investigations. Click "Open TheHive" to access the full interface.
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
