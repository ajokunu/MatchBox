import { healthStore, metricsStatusStore, metricsStore } from './stores';
import type { FetchStatus, HealthState, MetricsState } from './stores';

function setMetricsStatus(serviceId: string, status: FetchStatus): void {
  metricsStatusStore.update((s) => ({ ...s, [serviceId]: status }));
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const resp = await fetch('/api/health');
    if (!resp.ok) {
      console.warn('[MatchBox] health fetch failed:', resp.status);
      return false;
    }
    const data: Record<string, HealthState> = await resp.json();
    healthStore.set(data);
    return true;
  } catch (err) {
    console.warn('[MatchBox] health fetch error:', err);
    return false;
  }
}

// Returns true on success so callers (and the page-driven manual refresh) can react to the
// outcome, and writes the per-service fetch status so detail pages can render loading/error
// states while this single poller owns the actual fetching.
export async function fetchMetrics(serviceId: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/${serviceId}`);
    if (!resp.ok) {
      console.warn(`[MatchBox] ${serviceId} metrics fetch failed:`, resp.status);
      setMetricsStatus(serviceId, 'error');
      return false;
    }
    const data: MetricsState = await resp.json();
    metricsStore.update((m) => ({ ...m, [serviceId]: data }));
    setMetricsStatus(serviceId, 'ok');
    return true;
  } catch (err) {
    console.warn(`[MatchBox] ${serviceId} metrics error:`, err);
    setMetricsStatus(serviceId, 'error');
    return false;
  }
}

export async function fetchAllMetrics(): Promise<void> {
  await Promise.allSettled([
    fetchMetrics('wazuh'),
    fetchMetrics('grafana'),
    fetchMetrics('opencti'),
    fetchMetrics('thehive'),
    fetchMetrics('cortex'),
  ]);
}

/**
 * Self-scheduling poller with:
 *   - visibilitychange gating (pause when the tab is hidden — was hammering SOC APIs
 *     forever in background tabs),
 *   - exponential backoff after consecutive failures (cap), reset on success — so a
 *     down service is not retried at a constant cadence generating endless noise.
 * Uses recursive setTimeout instead of setInterval so backoff/visibility can adjust the
 * delay and overlapping in-flight requests can't pile up.
 */
function makePoller(
  task: () => Promise<boolean | undefined>,
  baseMs: number,
  maxMs: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = baseMs;
  let stopped = false;

  async function tick() {
    const ok = await task();
    // task() returns false only on a clear failure (health); metrics return void → treat as ok.
    if (ok === false) delay = Math.min(delay * 2, maxMs);
    else delay = baseMs;
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || (typeof document !== 'undefined' && document.hidden)) return;
    timer = setTimeout(tick, delay);
  }

  function onVisibility() {
    if (document.hidden) {
      clearTimeout(timer);
    } else {
      // Catch up immediately on focus, then resume the cadence.
      task().then(schedule);
    }
  }

  // Kick off immediately, then schedule.
  task().then(schedule);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

export function startPolling(): () => void {
  const stopHealth = makePoller(fetchHealth, 30_000, 4 * 60_000);
  const stopMetrics = makePoller(fetchAllMetrics, 60_000, 8 * 60_000);
  return () => {
    stopHealth();
    stopMetrics();
  };
}
