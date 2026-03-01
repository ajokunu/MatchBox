<script lang="ts">
  import { onMount } from 'svelte';
  import { Sun, Moon } from 'lucide-svelte';
  import StatusDot from './StatusDot.svelte';
  import { healthStore, themeStore, toggleTheme } from '$lib/stores';
  import { services } from '$lib/config';

  let clock = $state('--:--:-- UTC');
  let isDark = $derived($themeStore === 'dark');

  onMount(() => {
    document.documentElement.setAttribute('data-theme', $themeStore);
    const update = () => {
      clock = new Date().toISOString().slice(11, 19) + ' UTC';
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  });
</script>

<header class="header">
  <div class="logo-section">
    <svg class="logo-svg" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="var(--accent)"/>
          <stop offset="60%" stop-color="#ef7b45"/>
          <stop offset="100%" stop-color="#fbbf24"/>
        </linearGradient>
      </defs>
      <rect x="2" y="10" width="28" height="20" rx="3" fill="var(--bg-card)" stroke="var(--border)" stroke-width="1"/>
      <rect x="2" y="24" width="28" height="6" rx="0 0 3 3" fill="var(--accent)"/>
      <rect x="14.5" y="4" width="3" height="18" rx="1.5" fill="var(--border)"/>
      <ellipse cx="16" cy="5" rx="3.5" ry="4" fill="url(#flame)"/>
    </svg>
    <div>
      <div class="title">MATCHBOX SOC</div>
      <div class="subtitle">Command Center</div>
    </div>
  </div>

  <div class="status-bar">
    {#each services as svc}
      {@const health = $healthStore[svc.id]}
      <a
        class="status-item"
        href="/{svc.id}"
        title="{svc.name} - {health?.status ?? 'checking'}"
      >
        <StatusDot status={health?.status ?? 'checking'} />
        <span>{svc.name}</span>
      </a>
    {/each}
  </div>

  <div class="header-right">
    <button class="theme-toggle" onclick={toggleTheme} title={isDark ? 'Switch to light' : 'Switch to dark'}>
      {#if isDark}
        <Sun size={14} />
      {:else}
        <Moon size={14} />
      {/if}
    </button>
    <div class="clock">{clock}</div>
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    height: 48px;
    position: relative;
    z-index: 100;
    flex-shrink: 0;
    transition: background 0.2s, border-color 0.2s;
  }
  .header::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    opacity: 0.4;
  }
  .logo-section {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-svg {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
  }
  .title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--accent);
  }
  .subtitle {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 3px;
    text-transform: uppercase;
  }
  .status-bar {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .status-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: var(--text-secondary);
    padding: 3px 6px;
    border-radius: 4px;
    transition: background 0.2s;
    text-decoration: none;
  }
  .status-item:hover {
    background: var(--hover-overlay);
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .theme-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
  }
  .theme-toggle:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .clock {
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
    letter-spacing: 1px;
  }
</style>
