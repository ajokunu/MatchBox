import { env } from '$env/dynamic/private';
import { socCaDispatcher } from '$lib/server/upstream';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Per-service health probes. We probe a real health endpoint per service rather than a
 * UI root (a login page returning 200/302 does not mean the backend is healthy).
 * `expectRedirect: true` accepts the documented auth-redirect codes for services whose
 * health endpoint legitimately 30x's to a login page.
 */
interface Probe {
  url: string;
  expectRedirect?: boolean;
}

const endpoints: Record<string, Probe> = {
  // Wazuh: probe the Server API base (not the Dashboard UI root). It answers without a
  // JWT (401/relevant code) when up, vs. a connection error when down.
  wazuh: { url: env.WAZUH_API_URL || 'https://localhost:55000' },
  grafana: { url: `${env.GRAFANA_URL || 'http://localhost:3000'}/api/health` },
  opencti: { url: `${env.OPENCTI_URL || 'http://localhost:4000'}/health` },
  thehive: { url: `${env.THEHIVE_URL || 'http://localhost:9000'}/api/status` },
  cortex: { url: `${env.CORTEX_URL || 'http://localhost:9001'}/api/status` },
};

// Codes that mean "service is up and responding", even if not 2xx (e.g. an unauthenticated
// API base that answers 401, or a documented auth redirect). Anything else → degraded.
const HEALTHY_NON_OK = new Set([401, 403]);
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function classify(status: number, expectRedirect: boolean): string {
  if (status >= 200 && status < 300) return 'online';
  if (HEALTHY_NON_OK.has(status)) return 'online';
  if (expectRedirect && REDIRECT_CODES.has(status)) return 'online';
  return 'degraded';
}

export const GET: RequestHandler = async () => {
  const results: Record<string, { status: string; latency?: number }> = {};

  await Promise.allSettled(
    Object.entries(endpoints).map(async ([id, probe]) => {
      const start = Date.now();
      try {
        // HTTPS probes (Wazuh) trust the scoped SOC CA dispatcher rather than the old
        // process-wide TLS-off switch; plain http:// probes ignore it (undefined).
        const dispatcher = probe.url.startsWith('https:') ? await socCaDispatcher() : undefined;
        const resp = await fetch(probe.url, {
          // `manual` keeps the real status code meaningful instead of following 30x's.
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit);
        results[id] = {
          status: classify(resp.status, probe.expectRedirect ?? false),
          latency: Date.now() - start,
        };
      } catch {
        results[id] = { status: 'offline' };
      }
    }),
  );

  return json(results);
};
