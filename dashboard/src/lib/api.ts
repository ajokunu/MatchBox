import { healthStore, metricsStore } from './stores';
import type { HealthState, MetricsState } from './stores';

export async function fetchHealth(): Promise<void> {
  try {
    const resp = await fetch('/api/health');
    if (!resp.ok) {
      console.warn('[MatchBox] health fetch failed:', resp.status);
      return;
    }
    const data: Record<string, HealthState> = await resp.json();
    healthStore.set(data);
  } catch (err) {
    console.warn('[MatchBox] health fetch error:', err);
  }
}

export async function fetchMetrics(serviceId: string): Promise<void> {
  try {
    const resp = await fetch(`/api/${serviceId}`);
    if (!resp.ok) {
      console.warn(`[MatchBox] ${serviceId} metrics fetch failed:`, resp.status);
      return;
    }
    const data: MetricsState = await resp.json();
    metricsStore.update((m) => ({ ...m, [serviceId]: data }));
  } catch (err) {
    console.warn(`[MatchBox] ${serviceId} metrics error:`, err);
  }
}

export async function fetchAllMetrics(): Promise<void> {
  await Promise.allSettled([
    fetchMetrics('wazuh'),
    fetchMetrics('grafana'),
    fetchMetrics('opencti'),
    fetchMetrics('thehive'),
    fetchMetrics('cortex')
  ]);
}

export function startPolling(): () => void {
  fetchHealth();
  fetchAllMetrics();

  const healthInterval = setInterval(fetchHealth, 30_000);
  const metricsInterval = setInterval(fetchAllMetrics, 60_000);

  return () => {
    clearInterval(healthInterval);
    clearInterval(metricsInterval);
  };
}
