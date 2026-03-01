<script lang="ts">
  import { onMount } from 'svelte';
  import { Shield, ExternalLink, RefreshCw, TriangleAlert, Users, Activity, CircleCheck, CircleX } from 'lucide-svelte';
  import StatBox from '$lib/components/StatBox.svelte';

  interface Agent {
    id: string;
    name: string;
    status: string;
    os: string;
    ip: string;
    version: string;
    registered: string;
  }

  interface ScaPolicy {
    name: string;
    score: number;
    pass: number;
    fail: number;
    invalid: number;
    notApplicable: number;
    total: number;
    policyId: string;
  }

  let data = $state<Record<string, unknown> | null>(null);
  let error = $state('');
  let loading = $state(true);

  let agents = $derived((data?.agents as Agent[]) ?? []);
  let sca = $derived((data?.sca as ScaPolicy[]) ?? []);

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
        <TriangleAlert size={24} />
        <span>Could not reach Wazuh API</span>
        <span class="error-detail">{error}</span>
        <span class="error-hint">Ensure port-forward is running: kubectl port-forward -n wazuh svc/wazuh-manager 55000:55000</span>
      </div>
    {:else if data}
      <!-- Top stats -->
      <div class="stats-row">
        <div class="stat-large">
          <Shield size={20} />
          <div>
            <div class="stat-lg-value accent">{data.totalAlerts ?? 0}</div>
            <div class="stat-lg-label">Total Alerts</div>
          </div>
        </div>
        <div class="stat-large">
          <TriangleAlert size={20} />
          <div>
            <div class="stat-lg-value accent">{data.criticalAlerts ?? 0}</div>
            <div class="stat-lg-label">Critical (lvl 10+)</div>
          </div>
        </div>
        <div class="stat-large">
          <Users size={20} />
          <div>
            <div class="stat-lg-value green">{data.activeAgents ?? 0}/{data.totalAgents ?? 0}</div>
            <div class="stat-lg-label">Agents (active/total)</div>
          </div>
        </div>
      </div>

      <div class="stats-row-sm">
        <StatBox label="Version" value={String(data.version ?? '...')} />
        <StatBox label="Rules Loaded" value={data.totalRules ?? '...'} color="var(--accent)" />
        <StatBox label="API" value="localhost:55000" />
        <StatBox label="Dashboard" value="localhost:5601" />
      </div>

      <!-- Agents table -->
      <div class="section-title">Registered Agents</div>
      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>OS</th>
              <th>IP</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {#each agents as agent}
              <tr>
                <td class="mono">{agent.id}</td>
                <td class="bold">{agent.name}</td>
                <td>
                  <span class="status-badge" class:online={agent.status === 'active'} class:offline={agent.status !== 'active'}>
                    {#if agent.status === 'active'}
                      <CircleCheck size={10} />
                    {:else}
                      <CircleX size={10} />
                    {/if}
                    {agent.status}
                  </span>
                </td>
                <td>{agent.os}</td>
                <td class="mono">{agent.ip}</td>
                <td>{agent.version}</td>
              </tr>
            {/each}
            {#if agents.length === 0}
              <tr><td colspan="6" class="empty-row">No agents registered</td></tr>
            {/if}
          </tbody>
        </table>
      </div>

      <!-- SCA Compliance -->
      {#if sca.length > 0}
        <div class="section-title">Security Configuration Assessment</div>
        {#each sca as policy}
          {@const passPct = policy.total > 0 ? (policy.pass / policy.total) * 100 : 0}
          {@const failPct = policy.total > 0 ? (policy.fail / policy.total) * 100 : 0}
          {@const invalidPct = policy.total > 0 ? (policy.invalid / policy.total) * 100 : 0}
          {@const naPct = policy.total > 0 ? (policy.notApplicable / policy.total) * 100 : 0}
          <div class="sca-card">
            <div class="sca-header">
              <span class="sca-name">{policy.name}</span>
              <span class="sca-score" class:good={policy.score >= 70} class:warn={policy.score >= 40 && policy.score < 70} class:bad={policy.score < 40}>
                {policy.score}%
              </span>
            </div>
            <div class="sca-bar-segmented">
              <div class="sca-seg pass" style="width: {passPct}%" title="{policy.pass} passed"></div>
              <div class="sca-seg fail" style="width: {failPct}%" title="{policy.fail} failed"></div>
              <div class="sca-seg invalid" style="width: {invalidPct}%" title="{policy.invalid} invalid"></div>
              <div class="sca-seg na" style="width: {naPct}%" title="{policy.notApplicable} N/A"></div>
            </div>
            <div class="sca-details">
              <span class="sca-stat pass">{policy.pass} passed</span>
              <span class="sca-stat fail">{policy.fail} failed</span>
              {#if policy.invalid > 0}
                <span class="sca-stat invalid">{policy.invalid} invalid</span>
              {/if}
              {#if policy.notApplicable > 0}
                <span class="sca-stat na">{policy.notApplicable} N/A</span>
              {/if}
              <span class="sca-stat">{policy.total} total</span>
            </div>
          </div>
        {/each}
      {/if}
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
  .action-btn:hover { border-color: var(--accent); color: var(--text-primary); }
  .action-btn.accent { background: var(--accent); border-color: var(--accent); color: #fdf6e3; }
  .action-btn.accent:hover { opacity: 0.9; }
  .page-content { flex: 1; padding: 16px; overflow-y: auto; background: var(--bg-primary); }
  .center-msg {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 200px; gap: 8px;
    color: var(--text-dim); font-size: 12px;
  }
  .center-msg.error { color: var(--accent); }
  .error-detail { font-size: 10px; color: var(--text-dim); }
  .error-hint {
    font-size: 9px; color: var(--text-dim); margin-top: 8px;
    background: var(--bg-card); padding: 8px 12px; border-radius: 4px;
    border: 1px solid var(--border); font-family: inherit;
  }
  .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
  .stats-row-sm { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .stat-large {
    display: flex; align-items: center; gap: 12px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px; color: var(--text-dim);
  }
  .stat-lg-value { font-size: 28px; font-weight: 700; }
  .stat-lg-value.accent { color: var(--accent); }
  .stat-lg-value.green { color: var(--accent-green); }
  .stat-lg-label { font-size: 10px; color: var(--text-dim); letter-spacing: 0.5px; text-transform: uppercase; }

  /* Section titles */
  .section-title {
    font-size: 11px; font-weight: 600; color: var(--text-secondary);
    letter-spacing: 1px; text-transform: uppercase;
    margin-bottom: 8px; margin-top: 4px;
  }

  /* Agents table */
  .table-card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden; margin-bottom: 16px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead { background: var(--bg-secondary); }
  th {
    text-align: left; padding: 8px 12px; font-size: 9px;
    color: var(--text-dim); letter-spacing: 1px; text-transform: uppercase;
    border-bottom: 1px solid var(--border);
  }
  td { padding: 10px 12px; color: var(--text-secondary); border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  .mono { font-family: inherit; opacity: 0.8; }
  .bold { font-weight: 600; color: var(--text-primary); }
  .empty-row { text-align: center; color: var(--text-dim); padding: 20px; }
  .status-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;
  }
  .status-badge.online { color: var(--accent-green); background: rgba(42, 161, 152, 0.1); }
  .status-badge.offline { color: var(--accent); background: rgba(203, 45, 62, 0.1); }

  /* SCA cards */
  .sca-card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px 16px; margin-bottom: 10px;
  }
  .sca-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .sca-name { font-size: 11px; font-weight: 600; color: var(--text-primary); }
  .sca-score { font-size: 18px; font-weight: 700; }
  .sca-score.good { color: var(--accent-green); }
  .sca-score.warn { color: var(--accent-yellow); }
  .sca-score.bad { color: var(--accent); }
  .sca-bar-segmented {
    display: flex; height: 6px; border-radius: 3px;
    overflow: hidden; margin-bottom: 8px;
    background: var(--bg-secondary);
  }
  .sca-seg { height: 100%; transition: width 0.3s; }
  .sca-seg.pass { background: var(--accent-green); }
  .sca-seg.fail { background: var(--accent); }
  .sca-seg.invalid { background: var(--accent-yellow); }
  .sca-seg.na { background: var(--text-dim); opacity: 0.4; }
  .sca-details { display: flex; gap: 16px; flex-wrap: wrap; }
  .sca-stat { font-size: 10px; color: var(--text-dim); }
  .sca-stat.pass { color: var(--accent-green); }
  .sca-stat.fail { color: var(--accent); }
  .sca-stat.invalid { color: var(--accent-yellow); }
  .sca-stat.na { color: var(--text-dim); opacity: 0.7; }
  :global(.spinner) { animation: spin 1s linear infinite; color: var(--accent); }
</style>
