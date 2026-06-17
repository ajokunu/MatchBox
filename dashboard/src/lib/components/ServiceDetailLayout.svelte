<script lang="ts">
  /**
   * Shared scaffolding for the per-service detail pages (Wazuh/TheHive/Cortex/OpenCTI).
   * Owns the page bar, refresh/open actions, loading/error states, and the polling
   * lifecycle (visibilitychange pause + exponential backoff) so each page only supplies
   * its unique stats markup via the default slot. Kills the ~40-line copy-pasted block
   * and the duplicated setInterval(fetchData, 60_000) that lived in 4 files.
   */
  import { onMount, type Snippet } from 'svelte';
  import { ExternalLink, RefreshCw, TriangleAlert, Activity } from 'lucide-svelte';
  import { iconMap } from '$lib/config';

  let {
    title,
    icon,
    endpoint,
    externalUrl,
    externalLabel,
    errorLabel,
    connectingLabel = 'Connecting...',
    errorHint = '',
    children
  }: {
    title: string;
    icon: string;
    endpoint: string;
    externalUrl: string;
    externalLabel: string;
    errorLabel: string;
    connectingLabel?: string;
    errorHint?: string;
    // Receives the fetched payload so the page can render its stats.
    children: Snippet<[Record<string, unknown>]>;
  } = $props();

  const Icon = $derived(iconMap[icon]);

  let data = $state<Record<string, unknown> | null>(null);
  let error = $state(false);
  let loading = $state(true);

  const BASE_INTERVAL = 60_000;
  const MAX_INTERVAL = 8 * 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoff = BASE_INTERVAL;
  let stopped = false;

  async function fetchData() {
    loading = true;
    try {
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
      error = false;
      backoff = BASE_INTERVAL; // reset backoff on success
    } catch {
      // Do not surface the raw error string (server already redacts it); show a label.
      error = true;
      data = null;
      backoff = Math.min(backoff * 2, MAX_INTERVAL); // exponential backoff on failure
    } finally {
      loading = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || document.hidden) return; // pause when tab hidden
    timer = setTimeout(async () => {
      await fetchData();
      schedule();
    }, backoff);
  }

  function onVisibility() {
    if (document.hidden) {
      clearTimeout(timer);
    } else {
      // Refresh immediately when the tab becomes visible again, then resume polling.
      fetchData().then(schedule);
    }
  }

  onMount(() => {
    fetchData().then(schedule);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
</script>

<div class="detail-page">
  <div class="page-bar">
    <div class="page-title">
      <Icon size={18} strokeWidth={1.8} />
      <span>{title}</span>
    </div>
    <div class="page-actions">
      <button class="action-btn" onclick={fetchData} aria-label="Refresh {title}">
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
