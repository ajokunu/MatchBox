<script lang="ts">
  import { goto } from '$app/navigation';
  import { Shield, ChartColumn, Radar, ShieldAlert, Brain, ExternalLink } from 'lucide-svelte';
  import StatusDot from './StatusDot.svelte';
  import StatBox from './StatBox.svelte';
  import { healthStore, metricsStore } from '$lib/stores';
  import type { ServiceConfig } from '$lib/config';

  let { service }: { service: ServiceConfig } = $props();

  const iconMap: Record<string, typeof Shield> = {
    Shield, ChartColumn, Radar, ShieldAlert, Brain
  };

  function navigate() { goto(`/${service.id}`); }
  function openExternal(e: MouseEvent) {
    e.stopPropagation();
    window.open(service.dashboardUrl, '_blank');
  }

  let health = $derived($healthStore[service.id]);
  let metrics = $derived($metricsStore[service.id] ?? {});
  let Icon = $derived(iconMap[service.icon] || Shield);

  function fmt(v: unknown): string | number {
    if (v === undefined || v === null) return '...';
    return v as string | number;
  }

  let stats = $derived.by(() => {
    const m = metrics;
    switch (service.id) {
      case 'wazuh':
        return [
          { label: 'Alerts', value: fmt(m.totalAlerts), color: 'var(--accent)' },
          { label: 'Agents', value: `${fmt(m.activeAgents)}/${fmt(m.totalAgents)}`, color: '' }
        ];
      case 'grafana':
        return [
          { label: 'Dashboards', value: fmt(m.dashboards), color: 'var(--accent)' },
          { label: 'Version', value: m.version ? String(m.version).slice(0, 6) : '...', color: '' }
        ];
      case 'opencti':
        return [
          { label: 'Indicators', value: fmt(m.indicators), color: 'var(--accent)' },
          { label: 'Connectors', value: `${fmt(m.activeConnectors)}/${fmt(m.connectors)}`, color: '' }
        ];
      case 'thehive':
        return [
          { label: 'Cases', value: fmt(m.openCases), color: 'var(--accent)' },
          { label: 'Alerts', value: fmt(m.alerts), color: '' }
        ];
      case 'cortex':
        return [
          { label: 'Analyzers', value: fmt(m.analyzers), color: 'var(--accent)' },
          { label: 'Status', value: m.configured ? 'Active' : 'Setup', color: '' }
        ];
      default:
        return [];
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="card" onclick={navigate}>
  <div class="card-top">
    <div class="card-title">
      <Icon size={18} strokeWidth={1.8} />
      <span class="card-name">{service.name}</span>
      <span class="card-badge">{service.badge}</span>
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
    {#each stats as stat}
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
    border-color: var(--accent);
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
    background: var(--accent);
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
    background: var(--badge-bg);
    color: var(--badge-text);
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
    background: var(--hover-overlay);
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
