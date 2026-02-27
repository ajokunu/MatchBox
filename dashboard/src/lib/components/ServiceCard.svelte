<script lang="ts">
  import { goto } from '$app/navigation';
  import { Shield, BarChart3, Radar, ShieldAlert, Brain, ExternalLink } from 'lucide-svelte';
  import StatusDot from './StatusDot.svelte';
  import StatBox from './StatBox.svelte';
  import { healthStore, metricsStore } from '$lib/stores';
  import type { ServiceConfig } from '$lib/config';

  let { service }: { service: ServiceConfig } = $props();

  const iconMap: Record<string, typeof Shield> = {
    Shield, BarChart3, Radar, ShieldAlert, Brain
  };

  function navigate() { goto(`/${service.id}`); }
  function openExternal(e: MouseEvent) {
    e.stopPropagation();
    window.open(service.dashboardUrl, '_blank');
  }

  let health = $derived($healthStore[service.id]);
  let metrics = $derived($metricsStore[service.id] ?? {});
  let Icon = $derived(iconMap[service.icon] || Shield);

  function getStats(): Array<{ label: string; value: string | number; color: string }> {
    switch (service.id) {
      case 'wazuh':
        return [
          { label: 'Alerts', value: metrics.totalAlerts ?? '...', color: 'var(--accent-red)' },
          { label: 'Agents', value: metrics.activeAgents ?? '...', color: 'var(--accent-green)' }
        ];
      case 'grafana':
        return [
          { label: 'Dashboards', value: metrics.dashboards ?? '...', color: 'var(--accent-green)' },
          { label: 'Version', value: metrics.version ? String(metrics.version).slice(0, 6) : '...', color: '' }
        ];
      case 'opencti':
        return [
          { label: 'Indicators', value: metrics.indicators ?? '...', color: 'var(--accent-purple)' },
          { label: 'Connectors', value: metrics.connectors ?? '...', color: '' }
        ];
      case 'thehive':
        return [
          { label: 'Cases', value: metrics.openCases ?? '...', color: 'var(--accent-orange)' },
          { label: 'Version', value: metrics.version ? String(metrics.version).slice(0, 8) : '...', color: '' }
        ];
      case 'cortex':
        return [
          { label: 'Analyzers', value: metrics.analyzers ?? '...', color: 'var(--accent-cyan)' },
          { label: 'Version', value: metrics.version ? String(metrics.version).slice(0, 8) : '...', color: '' }
        ];
      default:
        return [];
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="card" style="--card-color: {service.color}" onclick={navigate}>
  <div class="card-top">
    <div class="card-title">
      <svelte:component this={Icon} size={18} strokeWidth={1.8} />
      <span class="card-name">{service.name}</span>
      <span class="card-badge" style="background: color-mix(in srgb, {service.color} 20%, transparent); color: {service.color};">
        {service.badge}
      </span>
    </div>
    <div class="card-right">
      <StatusDot status={health?.status ?? 'checking'} />
      <button
        class="open-btn"
        onclick={openExternal}
        title="Open in new tab"
      >
        <ExternalLink size={12} />
      </button>
    </div>
  </div>

  <div class="card-stats">
    {#each getStats() as stat}
      <StatBox label={stat.label} value={stat.value} color={stat.color} />
    {/each}
  </div>

  <div class="card-role">{service.role}</div>
</div>

<style>
  .card {
    display: block;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    transition: all 0.2s;
    text-decoration: none;
    position: relative;
    color: inherit;
    cursor: pointer;
  }
  .card:hover {
    background: var(--bg-card-hover);
    border-color: var(--card-color);
  }
  .card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 12px;
    bottom: 12px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: transparent;
    transition: background 0.2s;
  }
  .card:hover::before {
    background: var(--card-color);
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
  }
  .card-name {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .card-badge {
    font-size: 8px;
    padding: 2px 5px;
    border-radius: 3px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .card-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .open-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.2s;
    opacity: 0;
  }
  .card:hover .open-btn {
    opacity: 1;
  }
  .open-btn:hover {
    background: rgba(7, 54, 66, 0.08);
    color: var(--text-primary);
  }
  .card-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 8px;
  }
  .card-role {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.5px;
  }
</style>
