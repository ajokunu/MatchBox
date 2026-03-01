import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type ServiceStatus = 'checking' | 'online' | 'offline';

export interface HealthState {
  status: ServiceStatus;
  latency?: number;
}

export interface MetricsState {
  [key: string]: string | number | undefined;
}

export const healthStore = writable<Record<string, HealthState>>({});
export const metricsStore = writable<Record<string, MetricsState>>({});

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
    if (browser) {
      localStorage.setItem('matchbox-theme', next);
      document.documentElement.setAttribute('data-theme', next);
      // Clear the inline style so CSS var(--bg-primary) takes over
      document.body.style.background = '';
    }
    return next;
  });
}
