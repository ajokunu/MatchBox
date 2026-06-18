import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type ServiceStatus = 'checking' | 'online' | 'degraded' | 'offline';

export interface HealthState {
  status: ServiceStatus;
  latency?: number;
}

export interface MetricsState {
  [key: string]: string | number | undefined;
}

/**
 * Per-service fetch outcome for the LAST metrics poll. The service detail pages read this
 * (instead of running their own poller) so they can show connecting/error states while the
 * single global poller in api.ts owns the actual fetching, tab-hidden pause and backoff.
 *   - 'loading' : no successful fetch yet (initial / mid-flight)
 *   - 'ok'      : last poll succeeded → metricsStore[id] is populated
 *   - 'error'   : last poll failed (service unreachable)
 */
export type FetchStatus = 'loading' | 'ok' | 'error';

export const healthStore = writable<Record<string, HealthState>>({});
export const metricsStore = writable<Record<string, MetricsState>>({});
export const metricsStatusStore = writable<Record<string, FetchStatus>>({});

/* ── Theme ── */
export type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (browser) {
    return (localStorage.getItem('matchbox-theme') as Theme) || 'light';
  }
  return 'light';
}

export const themeStore = writable<Theme>(getInitialTheme());

export function toggleTheme() {
  themeStore.update((current) => {
    const next: Theme = current === 'light' ? 'dark' : 'light';
    // Persist only. The document `data-theme` attribute is applied in exactly one place
    // (+layout.svelte's $effect) so theme application isn't scattered across components.
    if (browser) localStorage.setItem('matchbox-theme', next);
    return next;
  });
}
