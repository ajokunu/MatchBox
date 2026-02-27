import { writable } from 'svelte/store';

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
