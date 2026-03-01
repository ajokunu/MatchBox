<script lang="ts">
  import { onMount } from 'svelte';
  import { ShieldAlert, ExternalLink, RefreshCw, TriangleAlert, Activity } from 'lucide-svelte';
  import StatBox from '$lib/components/StatBox.svelte';

  let data = $state<Record<string, unknown> | null>(null);
  let error = $state('');
  let loading = $state(true);

  async function fetchData() {
    loading = true;
    error = '';
    try {
      const resp = await fetch('/api/thehive');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
    } catch (err) {
      error = (err as Error).message;
      data = null;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  });
</script>

<div class="thehive-page">
  <div class="page-bar">
    <div class="page-title">
      <ShieldAlert size={18} strokeWidth={1.8} />
      <span>TheHive - Incident Response</span>
    </div>
    <div class="page-actions">
      <button class="action-btn" onclick={fetchData}>
        <RefreshCw size={12} />
        <span>Refresh</span>
      </button>
      <a href="http://localhost:9000" target="_blank" rel="noopener" class="action-btn accent">
        <ExternalLink size={12} />
        <span>Open TheHive</span>
      </a>
    </div>
  </div>

  <div class="page-content">
    {#if loading && !data}
      <div class="center-msg">
        <Activity size={24} class="spinner" />
        <span>Connecting to TheHive...</span>
      </div>
    {:else if error && !data}
      <div class="center-msg error">
        <TriangleAlert size={24} />
        <span>Could not reach TheHive</span>
        <span class="error-detail">{error}</span>
      </div>
    {:else if data}
      <div class="stats-row">
        <StatBox label="Status" value={String(data.status ?? 'unknown')} color="var(--accent-green)" />
        <StatBox label="Version" value={String(data.version ?? '...')} />
        <StatBox label="Open Cases" value={data.openCases ?? 0} color="var(--accent)" />
        <StatBox label="Alerts" value={data.alerts ?? 0} color="var(--accent)" />
      </div>

      {#if data.note}
        <div class="info-card">
          <p class="info-text">{data.note}. Set THEHIVE_API_KEY in dashboard/.env to see full metrics.</p>
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
    {/if}
  </div>
</div>

<style>
  .thehive-page { display: flex; flex-direction: column; height: 100%; }
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
  .action-btn.accent {
    background: var(--accent); border-color: var(--accent); color: #fdf6e3;
  }
  .action-btn.accent:hover { opacity: 0.9; }
  .page-content { flex: 1; padding: 16px; overflow-y: auto; }
  .center-msg {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 200px; gap: 8px;
    color: var(--text-dim); font-size: 12px;
  }
  .center-msg.error { color: var(--accent); }
  .error-detail { font-size: 10px; color: var(--text-dim); }
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
  :global(.spinner) { animation: spin 1s linear infinite; color: var(--accent); }
</style>
