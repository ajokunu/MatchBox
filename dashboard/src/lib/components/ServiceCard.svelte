<script lang="ts">
  import { ExternalLink } from 'lucide-svelte';
  import StatusDot from './StatusDot.svelte';
  import StatBox from './StatBox.svelte';
  import { healthStore, metricsStore } from '$lib/stores';
  import { iconMap, CHECKING_STATUS, LOADING_PLACEHOLDER, type ServiceConfig } from '$lib/config';

  let { service }: { service: ServiceConfig } = $props();

  type ColorVariant = 'default' | 'accent' | 'green' | 'yellow';

  function openExternal(e: MouseEvent) {
    e.stopPropagation();
    window.open(service.dashboardUrl, '_blank', 'noopener');
  }

  let health = $derived($healthStore[service.id]);
  let metrics = $derived($metricsStore[service.id] ?? {});
  let Icon = $derived(iconMap[service.icon]);
  let statusLabel = $derived(health?.status ?? CHECKING_STATUS);

  function fmt(v: unknown): string | number {
    if (v === undefined || v === null) return LOADING_PLACEHOLDER;
    return v as string | number;
  }

  let stats = $derived.by<Array<{ label: string; value: string | number; color: ColorVariant }>>(() => {
    const m = metrics;
    switch (service.id) {
      case 'wazuh':
        return [
          { label: 'Alerts', value: fmt(m.totalAlerts), color: 'accent' },
          { label: 'Agents', value: `${fmt(m.activeAgents)}/${fmt(m.totalAgents)}`, color: 'default' }
        ];
      case 'grafana':
        return [
          { label: 'Dashboards', value: fmt(m.dashboards), color: 'accent' },
          { label: 'Version', value: m.version ? String(m.version).slice(0, 6) : LOADING_PLACEHOLDER, color: 'default' }
        ];
      case 'opencti':
        return [
          { label: 'Indicators', value: fmt(m.indicators), color: 'accent' },
          { label: 'Connectors', value: `${fmt(m.activeConnectors)}/${fmt(m.connectors)}`, color: 'default' }
        ];
      case 'thehive':
        return [
          { label: 'Cases', value: fmt(m.openCases), color: 'accent' },
          { label: 'Alerts', value: fmt(m.alerts), color: 'default' }
        ];
      case 'cortex':
        return [
          { label: 'Analyzers', value: fmt(m.analyzers), color: 'accent' },
          { label: 'Status', value: m.configured ? 'Active' : 'Setup', color: 'default' }
        ];
      default:
        return [];
    }
  });
</script>

<!--
  The card is a real <a> so it is keyboard-focusable and Enter-activatable for navigation
  (was a <div onclick> with a11y warnings suppressed). The external-launch button is a
  sibling OUTSIDE the anchor to avoid nesting interactive controls.
-->
<div class="card-wrapper">
  <a class="card" href="/{service.id}" aria-label="{service.name} — {service.role}, status {statusLabel}">
    <div class="card-top">
      <div class="card-title">
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        <span class="card-name">{service.name}</span>
        <span class="card-badge">{service.badge}</span>
      </div>
      <div class="card-right">
        <StatusDot status={statusLabel} label={service.name} />
      </div>
    </div>

    <div class="card-stats">
      {#each stats as stat}
        <StatBox label={stat.label} value={stat.value} color={stat.color} />
      {/each}
    </div>

    <div class="card-role">{service.role}</div>
  </a>

  <button
    class="open-btn"
    onclick={openExternal}
    aria-label="Open {service.name} in new tab"
    title="Open in new tab"
  >
    <ExternalLink size={12} aria-hidden="true" />
  </button>
</div>

<style>
  .card-wrapper {
    position: relative;
  }
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
  .card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
    position: absolute;
    top: 10px;
    right: 12px;
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
  .card-wrapper:hover .open-btn,
  .open-btn:focus-visible {
    opacity: 1;
  }
  .open-btn:hover {
    background: var(--hover-overlay);
    color: var(--text-primary);
  }
  .open-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
