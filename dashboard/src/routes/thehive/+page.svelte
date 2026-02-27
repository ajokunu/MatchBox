<script lang="ts">
  import { Loader2, ExternalLink, RefreshCw } from 'lucide-svelte';

  let loading = $state(true);
  let src = $state('http://localhost:9000');

  function reload() {
    loading = true;
    const current = src;
    src = '';
    setTimeout(() => { src = current; }, 50);
  }
</script>

<div class="thehive-page">
  <div class="page-bar">
    <span class="page-label">TheHive - Incident Response Platform</span>
    <div class="page-actions">
      <button class="action-btn" onclick={reload}>
        <RefreshCw size={12} />
        <span>Reload</span>
      </button>
      <a href="http://localhost:9000" target="_blank" rel="noopener" class="action-btn">
        <ExternalLink size={12} />
        <span>Open Full</span>
      </a>
    </div>
  </div>
  <div class="frame-wrap">
    {#if loading}
      <div class="loading-overlay">
        <Loader2 size={28} class="spinner" />
        <span class="loading-text">Loading TheHive...</span>
      </div>
    {/if}
    {#if src}
      <iframe {src} title="TheHive" onload={() => { loading = false; }}></iframe>
    {/if}
  </div>
</div>

<style>
  .thehive-page { display: flex; flex-direction: column; height: 100%; }
  .page-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 12px; background: var(--bg-secondary);
    border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .page-label { font-size: 11px; color: var(--text-secondary); letter-spacing: 0.5px; }
  .page-actions { display: flex; gap: 4px; }
  .action-btn {
    display: flex; align-items: center; gap: 4px;
    padding: 4px 10px; font-size: 10px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 4px; color: var(--text-secondary);
    cursor: pointer; font-family: inherit; transition: all 0.2s;
    text-decoration: none;
  }
  .action-btn:hover { border-color: var(--accent-orange); color: var(--text-primary); }
  .frame-wrap { flex: 1; position: relative; }
  .frame-wrap iframe { width: 100%; height: 100%; border: none; background: var(--bg-primary); }
  .loading-overlay {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: var(--bg-secondary); z-index: 5; gap: 10px;
  }
  .loading-text { font-size: 10px; color: var(--text-dim); letter-spacing: 1px; }
  :global(.spinner) { animation: spin 1s linear infinite; color: var(--accent-orange); }
</style>
