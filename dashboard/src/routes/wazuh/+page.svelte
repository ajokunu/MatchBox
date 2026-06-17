<script lang="ts">
  import { Shield, TriangleAlert, Users, CircleCheck, CircleX } from 'lucide-svelte';
  import ServiceDetailLayout from '$lib/components/ServiceDetailLayout.svelte';
  import StatBox from '$lib/components/StatBox.svelte';
  import { publicUrls, LOADING_PLACEHOLDER } from '$lib/config';

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

  // External link host/port now come from PUBLIC_* config (were hardcoded localhost).
  const wazuhAppUrl = `${publicUrls.wazuhDashboard}/app/wazuh`;
  // Display-only host strings derived from config (was hardcoded "localhost:5601"/":55000").
  const dashboardHost = publicUrls.wazuhDashboard.replace(/^https?:\/\//, '');
</script>

<ServiceDetailLayout
  title="Wazuh SIEM / XDR"
  icon="Shield"
  endpoint="/api/wazuh"
  externalUrl={wazuhAppUrl}
  externalLabel="Open Wazuh Dashboard"
  errorLabel="Could not reach Wazuh API"
  connectingLabel="Connecting to Wazuh API..."
  errorHint="Ensure port-forward is running: kubectl port-forward -n wazuh svc/wazuh-manager 55000:55000"
>
  {#snippet children(data)}
    {@const agents = (data.agents as Agent[]) ?? []}
    {@const sca = (data.sca as ScaPolicy[]) ?? []}
    <!-- Top stats -->
    <div class="stats-row">
      <div class="stat-large">
        <Shield size={20} aria-hidden="true" />
        <div>
          <div class="stat-lg-value accent">{data.totalAlerts ?? 0}</div>
          <div class="stat-lg-label">Total Alerts</div>
        </div>
      </div>
      <div class="stat-large">
        <TriangleAlert size={20} aria-hidden="true" />
        <div>
          <div class="stat-lg-value accent">{data.criticalAlerts ?? 0}</div>
          <div class="stat-lg-label">Critical (lvl 10+)</div>
        </div>
      </div>
      <div class="stat-large">
        <Users size={20} aria-hidden="true" />
        <div>
          <div class="stat-lg-value green">{data.activeAgents ?? 0}/{data.totalAgents ?? 0}</div>
          <div class="stat-lg-label">Agents (active/total)</div>
        </div>
      </div>
    </div>

    <div class="stats-row-sm">
      <StatBox label="Version" value={String(data.version ?? LOADING_PLACEHOLDER)} />
      <StatBox label="Rules Loaded" value={Number(data.totalRules ?? 0)} color="accent" />
      <StatBox label="Server API" value="port 55000" />
      <StatBox label="Dashboard" value={dashboardHost} />
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
                    <CircleCheck size={10} aria-hidden="true" />
                  {:else}
                    <CircleX size={10} aria-hidden="true" />
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
  {/snippet}
</ServiceDetailLayout>

<style>
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
</style>
