import { healthStore, metricsStore } from './stores';
import type { HealthState, MetricsState } from './stores';

export async function fetchHealth(): Promise<void> {
  try {
    const resp = await fetch('/api/health');
    if (!resp.ok) return;
    const data: Record<string, HealthState> = await resp.json();
    healthStore.set(data);
  } catch {
    // silent — health check failed
  }
}

export async function fetchMetrics(serviceId: string): Promise<void> {
  try {
    const resp = await fetch(`/api/${serviceId}`);
    if (!resp.ok) return;
    const data: MetricsState = await resp.json();
    metricsStore.update((m) => ({ ...m, [serviceId]: data }));
  } catch {
    // silent — metrics fetch failed
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
