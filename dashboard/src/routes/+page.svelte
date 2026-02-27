<script lang="ts">
  import ServiceCard from '$lib/components/ServiceCard.svelte';
  import GrafanaEmbed from '$lib/components/GrafanaEmbed.svelte';
  import { services } from '$lib/config';
</script>

<div class="overview">
  <div class="section-header">
    <span class="section-label">Service Overview</span>
  </div>

  <div class="cards-grid">
    {#each services as svc (svc.id)}
      <ServiceCard service={svc} />
    {/each}
  </div>

  <div class="section-header" style="margin-top: 6px;">
    <span class="section-label">Live Monitoring</span>
  </div>

  <div class="grafana-section">
    <GrafanaEmbed height="100%" />
  </div>
</div>

<style>
  .overview {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 8px;
    gap: 6px;
  }
  .section-header {
    padding: 0 4px;
  }
  .section-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    flex-shrink: 0;
  }
  .grafana-section {
    flex: 1;
    min-height: 300px;
  }

  @media (max-width: 1400px) {
    .cards-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  @media (max-width: 900px) {
    .cards-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
