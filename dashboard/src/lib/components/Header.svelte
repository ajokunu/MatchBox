<script lang="ts">
  import { onMount } from 'svelte';
  import { Shield, BarChart3, Radar, ShieldAlert, Brain } from 'lucide-svelte';
  import StatusDot from './StatusDot.svelte';
  import { healthStore } from '$lib/stores';
  import { services } from '$lib/config';

  const iconMap: Record<string, typeof Shield> = {
    Shield, BarChart3, Radar, ShieldAlert, Brain
  };

  let clock = $state('--:--:-- UTC');

  onMount(() => {
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
    <div class="logo">M</div>
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

  <div class="clock">{clock}</div>
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
  }
  .header::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent-red), transparent);
    opacity: 0.4;
  }
  .logo-section {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo {
    width: 30px;
    height: 30px;
    background: var(--accent-red);
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: bold;
    box-shadow: 0 2px 8px rgba(203, 45, 62, 0.25);
    color: #fdf6e3;
  }
  .title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--accent-red);
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
    background: rgba(7, 54, 66, 0.06);
  }
  .clock {
    font-size: 12px;
    color: var(--accent-red);
    font-weight: 600;
    letter-spacing: 1px;
  }
</style>
