import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const endpoints: Record<string, string> = {
  wazuh: (env.WAZUH_DASHBOARD_URL || 'https://localhost:5601'),
  grafana: (env.GRAFANA_URL || 'http://localhost:3000') + '/api/health',
  opencti: (env.OPENCTI_URL || 'http://localhost:4000') + '/health',
  thehive: (env.THEHIVE_URL || 'http://localhost:9000') + '/api/status',
  cortex: (env.CORTEX_URL || 'http://localhost:9001') + '/api/status'
};

export const GET: RequestHandler = async () => {
  const results: Record<string, { status: string; latency?: number }> = {};

  await Promise.allSettled(
    Object.entries(endpoints).map(async ([id, url]) => {
      const start = Date.now();
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        results[id] = {
          status: resp.ok || resp.status === 302 ? 'online' : 'online',
          latency: Date.now() - start
        };
      } catch {
        results[id] = { status: 'offline' };
      }
    })
  );

  return json(results);
};
