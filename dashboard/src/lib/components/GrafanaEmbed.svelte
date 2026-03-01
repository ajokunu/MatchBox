<script lang="ts">
  import { LoaderCircle, ExternalLink, RefreshCw } from 'lucide-svelte';
  import { grafanaDashboards } from '$lib/config';
  import { themeStore } from '$lib/stores';

  let { height = '100%' }: { height?: string } = $props();

  let activeTab = $state(0);
  let loading = $state(true);
  let reloading = $state(false);

  // Build Grafana URL with theme param synced to dashboard theme
  function buildSrc(index: number, theme: string): string {
    if (index < 0 || index >= grafanaDashboards.length) return '';
    const grafanaTheme = theme === 'dark' ? 'dark' : 'light';
    return `http://localhost:3000${grafanaDashboards[index].path}&theme=${grafanaTheme}`;
  }

  let iframeSrc = $derived(buildSrc(activeTab, $themeStore));
  let externalHref = $derived(
    activeTab >= 0 && activeTab < grafanaDashboards.length
      ? `http://localhost:3000${grafanaDashboards[activeTab].path.replace('&kiosk', '')}`
      : '#'
  );

  function switchDash(index: number) {
    activeTab = index;
    loading = true;
  }

  let loadError = $state(false);

  function reload() {
    loading = true;
    loadError = false;
    reloading = true;
    setTimeout(() => { reloading = false; }, 50);
  }

  // Timeout: if iframe doesn't load in 10s, show error
  $effect(() => {
    if (loading && !reloading) {
      const timer = setTimeout(() => {
        if (loading) { loadError = true; loading = false; }
      }, 10_000);
      return () => clearTimeout(timer);
    }
  });
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
        href={externalHref}
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
        <LoaderCircle size={28} class="spinner" />
        <span class="loading-text">Loading dashboard...</span>
      </div>
    {:else if loadError}
      <div class="loading-overlay">
        <RefreshCw size={24} />
        <span class="loading-text">Could not reach Grafana at localhost:3000</span>
        <button class="retry-btn" onclick={reload}>Retry</button>
      </div>
    {/if}
    {#if !reloading && iframeSrc}
      <iframe
        src={iframeSrc}
        title="Grafana Dashboard"
        class:blend={$themeStore !== 'dark'}
        onload={() => { loading = false; loadError = false; }}
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
    color: var(--accent);
    border-bottom-color: var(--accent);
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
    background: var(--hover-overlay);
    color: var(--text-primary);
  }
  .frame-container {
    flex: 1;
    position: relative;
    background: var(--bg-primary);
  }
  .frame-container iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
  .frame-container iframe.blend {
    mix-blend-mode: multiply;
  }
  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    z-index: 5;
    gap: 10px;
    color: var(--text-dim);
  }
  .loading-text {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 1px;
  }
  .retry-btn {
    margin-top: 4px;
    padding: 4px 14px;
    font-size: 10px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    transition: all 0.2s;
  }
  .retry-btn:hover { border-color: var(--accent); color: var(--text-primary); }
  :global(.spinner) {
    animation: spin 1s linear infinite;
    color: var(--accent);
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
