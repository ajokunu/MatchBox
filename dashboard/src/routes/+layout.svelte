<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import Header from '$lib/components/Header.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import { startPolling } from '$lib/api';

  let { children } = $props();

  onMount(() => {
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
  }
  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
</style>
