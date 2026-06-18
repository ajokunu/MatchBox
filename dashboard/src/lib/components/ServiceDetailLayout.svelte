<script lang="ts">
import { fetchMetrics } from '$lib/api';
import { iconMap, storeKeyForEndpoint } from '$lib/config';
import { metricsStatusStore, metricsStore } from '$lib/stores';
import { Activity, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-svelte';
/**
 * Shared scaffolding for the per-service detail pages (Wazuh/TheHive/Cortex/OpenCTI).
 * Owns the page bar, refresh/open actions, and loading/error states; each page supplies
 * only its unique stats markup via the children snippet.
 *
 * Data source: the SINGLE global poller in api.ts (started once in +layout.svelte) that
 * already owns the fetch cadence, tab-hidden pause and failure backoff. This component
 * READS metricsStore[serviceId] rather than running a second setInterval against the same
 * /api/<service> endpoint — that double-poll doubled SOC API load (findings 47/48). The
 * Refresh button triggers a one-off fetchMetrics() for the active service; the background
 * cadence/backoff stays in the poller so we never have two competing timers.
 */
import type { Snippet } from 'svelte';

let {
  title,
  icon,
  endpoint,
  externalUrl,
  externalLabel,
  errorLabel,
  connectingLabel = 'Connecting...',
  errorHint = '',
  children,
}: {
  title: string;
  icon: string;
  endpoint: string;
  externalUrl: string;
  externalLabel: string;
  errorLabel: string;
  connectingLabel?: string;
  errorHint?: string;
  // Receives the metrics payload so the page can render its stats.
  children: Snippet<[Record<string, unknown>]>;
} = $props();

const Icon = $derived(iconMap[icon]);
// serviceId is the metricsStore key for this endpoint (via the shared map, not a re-fetch).
const serviceId = $derived(storeKeyForEndpoint(endpoint));

// Derive view state purely from the shared stores the global poller writes.
const data = $derived(($metricsStore[serviceId] ?? null) as Record<string, unknown> | null);
const status = $derived($metricsStatusStore[serviceId] ?? 'loading');
const loading = $derived(status === 'loading' && !data);
const error = $derived(status === 'error' && !data);
let refreshing = $state(false);

// Manual one-off refresh of just this service; the background cadence stays in the poller.
async function refresh() {
  refreshing = true;
  try {
    await fetchMetrics(serviceId);
  } finally {
    refreshing = false;
  }
}
</script>

<div class="detail-page">
  <div class="page-bar">
    <div class="page-title">
      <Icon size={18} strokeWidth={1.8} />
      <span>{title}</span>
    </div>
    <div class="page-actions">
      <button class="action-btn" onclick={refresh} disabled={refreshing} aria-label="Refresh {title}">
        <RefreshCw size={12} />
        <span>Refresh</span>
      </button>
      <a
        href={externalUrl}
        target="_blank"
        rel="noopener"
        class="action-btn accent"
        aria-label="{externalLabel} (opens in new tab)"
      >
        <ExternalLink size={12} />
        <span>{externalLabel}</span>
      </a>
    </div>
  </div>

  <div class="page-content">
    {#if loading && !data}
      <div class="center-msg">
        <Activity size={24} class="spinner" aria-hidden="true" />
        <span>{connectingLabel}</span>
      </div>
    {:else if error && !data}
      <div class="center-msg error" role="alert">
        <TriangleAlert size={24} aria-hidden="true" />
        <span>{errorLabel}</span>
        {#if errorHint}
          <span class="error-hint">{errorHint}</span>
        {/if}
      </div>
    {:else if data}
      {@render children(data)}
    {/if}
  </div>
</div>

<style>
  .detail-page { display: flex; flex-direction: column; height: 100%; }
  .page-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px; background: var(--bg-secondary);
    border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .page-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 600; color: var(--text-primary);
  }
  .page-actions { display: flex; gap: 6px; }
  .action-btn {
    display: flex; align-items: center; gap: 4px;
    padding: 5px 12px; font-size: 10px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 4px; color: var(--text-secondary);
    cursor: pointer; font-family: inherit; transition: all 0.2s;
    text-decoration: none;
  }
  .action-btn:hover { border-color: var(--accent); color: var(--text-primary); }
  .action-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .action-btn:disabled { opacity: 0.5; cursor: progress; }
  .action-btn.accent { background: var(--accent); border-color: var(--accent); color: #fdf6e3; }
  .action-btn.accent:hover { opacity: 0.9; }
  .page-content { flex: 1; padding: 16px; overflow-y: auto; background: var(--bg-primary); }
  .center-msg {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 200px; gap: 8px;
    color: var(--text-dim); font-size: 12px;
  }
  .center-msg.error { color: var(--accent); }
  .error-hint {
    font-size: 9px; color: var(--text-dim); margin-top: 8px;
    background: var(--bg-card); padding: 8px 12px; border-radius: 4px;
    border: 1px solid var(--border); font-family: inherit; text-align: center;
  }
</style>
