<script lang="ts">
  // Styled error boundary so unhandled load/render errors and 404s render INSIDE the
  // MatchBox shell (was falling back to SvelteKit's default unstyled error page).
  import { page } from '$app/stores';
  import { TriangleAlert, LayoutDashboard } from 'lucide-svelte';

  let status = $derived($page.status);
  // Avoid leaking internal error detail; show a generic message for 5xx.
  let message = $derived(
    status === 404 ? 'Page not found' : 'Something went wrong'
  );
</script>

<div class="error-shell">
  <div class="error-card" role="alert">
    <TriangleAlert size={32} aria-hidden="true" />
    <div class="error-status">{status}</div>
    <div class="error-message">{message}</div>
    <a class="error-link" href="/">
      <LayoutDashboard size={14} aria-hidden="true" />
      <span>Back to Overview</span>
    </a>
  </div>
</div>

<style>
  .error-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    background: var(--bg-primary);
  }
  .error-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 32px 40px;
    color: var(--accent);
    text-align: center;
  }
  .error-status {
    font-size: 32px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: 1px;
  }
  .error-message {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .error-link {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 6px 14px;
    font-size: 11px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
    text-decoration: none;
    transition: all 0.2s;
  }
  .error-link:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .error-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
