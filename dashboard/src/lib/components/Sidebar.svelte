<script lang="ts">
import { page } from '$app/stores';
import { iconMap, services } from '$lib/config';
import { healthStore } from '$lib/stores';
import { ExternalLink, LayoutDashboard } from 'lucide-svelte';
import StatusDot from './StatusDot.svelte';

// Single version source — injected from package.json via Vite (was a stale "v1.5.0" literal).
const version = __APP_VERSION__;
</script>

<nav class="sidebar">
  <a href="/" class="nav-item" class:active={$page.url.pathname === '/'}>
    <LayoutDashboard size={16} />
    <span>Overview</span>
  </a>

  <div class="nav-divider"></div>
  <div class="nav-label">Services</div>

  {#each services as svc}
    {@const health = $healthStore[svc.id]}
    {@const Icon = iconMap[svc.icon]}
    <a
      href="/{svc.id}"
      class="nav-item"
      class:active={$page.url.pathname === `/${svc.id}`}
    >
      <Icon size={16} aria-hidden="true" />
      <span class="nav-name">{svc.name}</span>
      <StatusDot status={health?.status ?? 'checking'} label={svc.name} />
    </a>
  {/each}

  <div class="nav-divider"></div>
  <div class="nav-label">Quick Links</div>

  {#each services as svc}
    <a
      href={svc.dashboardUrl}
      target="_blank"
      rel="noopener"
      class="nav-item external"
    >
      <ExternalLink size={12} aria-hidden="true" />
      <span class="nav-name">{svc.name}</span>
    </a>
  {/each}

  <div class="nav-footer">
    <span class="footer-version">v{version}</span>
  </div>
</nav>

<style>
  .sidebar {
    width: 180px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    flex-shrink: 0;
    overflow-y: auto;
    transition: background 0.2s, border-color 0.2s;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    font-size: 11px;
    color: var(--text-secondary);
    transition: all 0.15s;
    text-decoration: none;
    border-left: 2px solid transparent;
  }
  .nav-item:hover {
    background: var(--hover-overlay);
    color: var(--text-primary);
  }
  .nav-item.active {
    color: var(--text-primary);
    background: var(--accent-muted);
    border-left-color: var(--accent);
  }
  .nav-item.external {
    font-size: 10px;
    color: var(--text-dim);
    padding: 4px 14px;
  }
  .nav-item.external:hover {
    color: var(--text-secondary);
  }
  .nav-name {
    flex: 1;
  }
  .nav-divider {
    height: 1px;
    background: var(--border);
    margin: 6px 14px;
  }
  .nav-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 2px;
    text-transform: uppercase;
    padding: 4px 14px 2px;
  }
  .nav-footer {
    margin-top: auto;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
  }
  .footer-version {
    font-size: 9px;
    color: var(--text-dim);
    background: var(--bg-card);
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid var(--border);
  }
</style>
