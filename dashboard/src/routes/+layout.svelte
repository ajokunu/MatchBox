<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import Header from '$lib/components/Header.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import { startPolling } from '$lib/api';
  import { themeStore } from '$lib/stores';

  let { children } = $props();

  // Single owner of document-level theme application: keep <html data-theme> in sync
  // with the store. CSS vars (app.css) drive the background, so no body-style dance.
  $effect(() => {
    document.documentElement.setAttribute('data-theme', $themeStore);
  });

  onMount(() => {
    // Clear the inline body background set by the app.html anti-FOUC script so the CSS
    // var(--bg-primary) takes over once the app has hydrated.
    document.body.style.background = '';
    const stop = startPolling();
    return stop;
  });
</script>

<div class="scanline"></div>

<div class="app-shell">
  <Header />
  <div class="app-body">
    <Sidebar />
    <main class="content">
      {@render children()}
    </main>
  </div>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-primary);
    transition: background 0.2s;
  }
  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    background: var(--bg-primary);
    transition: background 0.2s;
  }
  .content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-primary);
    transition: background 0.2s;
  }
</style>
