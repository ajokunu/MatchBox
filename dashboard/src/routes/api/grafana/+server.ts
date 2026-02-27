import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const GRAFANA_URL = env.GRAFANA_URL || 'http://localhost:3000';

export const GET: RequestHandler = async () => {
  try {
    const [healthResp, dashResp] = await Promise.all([
      fetch(`${GRAFANA_URL}/api/health`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${GRAFANA_URL}/api/search?type=dash-db`, { signal: AbortSignal.timeout(5000) })
    ]);

    const health = (await healthResp.json()) as { version: string; database: string };
    let dashboardCount = 0;
    try {
      const dashboards = (await dashResp.json()) as unknown[];
      dashboardCount = dashboards.length;
    } catch { /* silent */ }

    return json({
      version: health.version,
      database: health.database,
      dashboards: dashboardCount,
      status: 'online'
    });
  } catch (err) {
    return json(
      { error: (err as Error).message, status: 'error' },
      { status: 502 }
    );
  }
};
