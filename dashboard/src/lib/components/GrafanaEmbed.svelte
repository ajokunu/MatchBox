<script lang="ts">
  import { Loader2, ExternalLink, RefreshCw } from 'lucide-svelte';
  import { grafanaDashboards } from '$lib/config';

  let { height = '100%' }: { height?: string } = $props();

  let activeTab = $state(0);
  let loading = $state(true);
  let iframeSrc = $state('http://localhost:3000' + grafanaDashboards[0].path);

  function switchDash(index: number) {
    activeTab = index;
    loading = true;
    iframeSrc = 'http://localhost:3000' + grafanaDashboards[index].path;
  }

  function reload() {
    loading = true;
    const current = iframeSrc;
    iframeSrc = '';
    setTimeout(() => { iframeSrc = current; }, 50);
  }
</script>

<div class="grafana-embed" style="height: {height}">
  <div class="tab-bar">
    {#each grafanaDashboards as dash, i}
      <button
        class="tab"
        class:active={activeTab === i}
        onclick={() => switchDash(i)}
      >
        {dash.label}
      </button>
    {/each}
    <div class="tab-actions">
      <button class="tab-btn" onclick={reload} title="Reload">
        <RefreshCw size={12} />
      </button>
      <a
        href="http://localhost:3000{grafanaDashboards[activeTab].path.replace('&kiosk', '')}"
        target="_blank"
        rel="noopener"
        class="tab-btn"
        title="Open in Grafana"
      >
        <ExternalLink size={12} />
      </a>
    </div>
  </div>

  <div class="frame-container">
    {#if loading}
      <div class="loading-overlay">
        <Loader2 size={28} class="spinner" />
        <span class="loading-text">Loading dashboard...</span>
      </div>
    {/if}
    {#if iframeSrc}
      <iframe
        src={iframeSrc}
        title="Grafana Dashboard"
        onload={() => { loading = false; }}
      ></iframe>
    {/if}
  </div>
</div>

<style>
  .grafana-embed {
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 0;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    padding: 0 4px;
    flex-shrink: 0;
  }
  .tab {
    padding: 6px 12px;
    font-size: 10px;
    color: var(--text-dim);
    cursor: pointer;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    font-family: inherit;
    transition: all 0.2s;
    white-space: nowrap;
  }
  .tab:hover { color: var(--text-secondary); }
  .tab.active {
    color: var(--accent-red);
    border-bottom-color: var(--accent-red);
  }
  .tab-actions {
    margin-left: auto;
    display: flex;
    gap: 2px;
    padding: 0 4px;
  }
  .tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.2s;
    text-decoration: none;
  }
  .tab-btn:hover {
    background: rgba(7, 54, 66, 0.06);
    color: var(--text-primary);
  }
  .frame-container {
    flex: 1;
    position: relative;
  }
  .frame-container iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: var(--bg-primary);
  }
  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary);
    z-index: 5;
    gap: 10px;
  }
  .loading-text {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 1px;
  }
  :global(.spinner) {
    animation: spin 1s linear infinite;
    color: var(--accent-red);
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
