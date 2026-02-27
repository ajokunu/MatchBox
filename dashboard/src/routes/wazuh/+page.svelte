<script lang="ts">
  import { onMount } from 'svelte';
  import { Shield, ExternalLink, RefreshCw, AlertTriangle, Users, Activity } from 'lucide-svelte';
  import StatBox from '$lib/components/StatBox.svelte';

  let data = $state<Record<string, unknown> | null>(null);
  let error = $state('');
  let loading = $state(true);

  async function fetchData() {
    loading = true;
    error = '';
    try {
      const resp = await fetch('/api/wazuh');
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

<div class="wazuh-page">
  <div class="page-bar">
    <div class="page-title">
      <Shield size={18} strokeWidth={1.8} />
      <span>Wazuh SIEM / XDR</span>
    </div>
    <div class="page-actions">
      <button class="action-btn" onclick={fetchData}>
        <RefreshCw size={12} />
        <span>Refresh</span>
      </button>
      <a href="https://localhost:5601/app/wazuh" target="_blank" rel="noopener" class="action-btn accent">
        <ExternalLink size={12} />
        <span>Open Wazuh Dashboard</span>
      </a>
    </div>
  </div>

  <div class="page-content">
    {#if loading && !data}
      <div class="center-msg">
        <Activity size={24} class="spinner" />
        <span>Connecting to Wazuh API...</span>
      </div>
    {:else if error && !data}
      <div class="center-msg error">
        <AlertTriangle size={24} />
        <span>Could not reach Wazuh API</span>
        <span class="error-detail">{error}</span>
        <span class="error-hint">Ensure port-forward is running: kubectl port-forward -n wazuh svc/wazuh-manager 55000:55000</span>
      </div>
    {:else if data}
      <div class="stats-row">
        <div class="stat-large">
          <Shield size={20} />
          <div>
            <div class="stat-lg-value" style="color: var(--accent-red)">
              {data.totalAlerts ?? 0}
            </div>
            <div class="stat-lg-label">Total Alerts</div>
          </div>
        </div>
        <div class="stat-large">
          <Users size={20} />
          <div>
            <div class="stat-lg-value" style="color: var(--accent-green)">
              {data.activeAgents ?? 0}
            </div>
            <div class="stat-lg-label">Active Agents</div>
          </div>
        </div>
        <div class="stat-large">
          <Users size={20} />
          <div>
            <div class="stat-lg-value" style="color: var(--text-secondary)">
              {data.totalAgents ?? 0}
            </div>
            <div class="stat-lg-label">Total Agents</div>
          </div>
        </div>
      </div>

      <div class="info-card">
        <div class="info-title">Wazuh Dashboard</div>
        <p class="info-text">
          The Wazuh Dashboard blocks iframe embedding (X-Frame-Options: sameorigin).
          Click "Open Wazuh Dashboard" above to view the full UI with alerts, agents,
          vulnerabilities, and compliance modules.
        </p>
        <div class="info-stats">
          <StatBox label="API Endpoint" value="localhost:55000" />
          <StatBox label="Dashboard" value="localhost:5601" />
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .wazuh-page { display: flex; flex-direction: column; height: 100%; }
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
  .action-btn:hover { border-color: var(--accent-red); color: var(--text-primary); }
  .action-btn.accent {
    background: var(--accent-red); border-color: var(--accent-red);
    color: #fdf6e3;
  }
  .action-btn.accent:hover { opacity: 0.9; }
  .page-content { flex: 1; padding: 16px; overflow-y: auto; }
  .center-msg {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 200px; gap: 8px;
    color: var(--text-dim); font-size: 12px;
  }
  .center-msg.error { color: var(--accent-red); }
  .error-detail { font-size: 10px; color: var(--text-dim); }
  .error-hint {
    font-size: 9px; color: var(--text-dim); margin-top: 8px;
    background: var(--bg-card); padding: 8px 12px; border-radius: 4px;
    border: 1px solid var(--border); font-family: inherit;
  }
  .stats-row {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 12px; margin-bottom: 16px;
  }
  .stat-large {
    display: flex; align-items: center; gap: 12px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px; color: var(--text-dim);
  }
  .stat-lg-value { font-size: 28px; font-weight: 700; }
  .stat-lg-label { font-size: 10px; color: var(--text-dim); letter-spacing: 0.5px; text-transform: uppercase; }
  .info-card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px;
  }
  .info-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
  .info-text { font-size: 11px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 12px; }
  .info-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  :global(.spinner) { animation: spin 1s linear infinite; color: var(--accent-red); }
</style>
