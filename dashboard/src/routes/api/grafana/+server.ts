import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { upstreamFetch, upstreamJson, upstreamErrorResponse } from '$lib/server/upstream';

const GRAFANA_URL = env.GRAFANA_URL || 'http://localhost:3000';

export const GET: RequestHandler = async () => {
  try {
    const [healthResp, dashResp] = await Promise.all([
      upstreamFetch(`${GRAFANA_URL}/api/health`, { timeoutMs: 5000 }),
      // Search may 401 without auth; tolerate it (dashboard count is best-effort).
      upstreamFetch(`${GRAFANA_URL}/api/search?type=dash-db`, { timeoutMs: 5000 }).catch(() => null)
    ]);

    const health = await upstreamJson<{ version?: string; database?: string }>(healthResp);

    let dashboardCount = 0;
    if (dashResp) {
      try {
        const dashboards = await upstreamJson<unknown[]>(dashResp);
        if (Array.isArray(dashboards)) dashboardCount = dashboards.length;
      } catch { /* best-effort count */ }
    }

    return json({
      version: health.version ?? 'unknown',
      database: health.database ?? 'unknown',
      dashboards: dashboardCount,
      status: 'online'
    });
  } catch (err) {
    return upstreamErrorResponse(err);
  }
};
