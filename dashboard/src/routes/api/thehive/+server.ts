import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const THEHIVE_URL = env.THEHIVE_URL || 'http://localhost:9000';
const THEHIVE_API_KEY = env.THEHIVE_API_KEY || '';

async function thehiveQuery(query: unknown[]): Promise<unknown> {
  const resp = await fetch(`${THEHIVE_URL}/api/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${THEHIVE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!resp.ok) throw new Error(`TheHive ${resp.status}`);
  return resp.json();
}

export const GET: RequestHandler = async () => {
  // If no API key, return basic status
  if (!THEHIVE_API_KEY) {
    try {
      const resp = await fetch(`${THEHIVE_URL}/api/status`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = (await resp.json()) as { versions?: Record<string, string> };
        return json({
          status: 'online',
          version: data.versions?.TheHive || 'unknown',
          note: 'No API key configured'
        });
      }
    } catch { /* fall through */ }
    return json({ status: 'offline' }, { status: 502 });
  }

  try {
    // Fetch cases, alerts, and status in parallel
    const [cases, alerts, statusResp] = await Promise.all([
      thehiveQuery([
        { _name: 'listCase' },
        { _name: 'page', from: 0, to: 0, extraData: ['total'] }
      ]) as Promise<unknown[]>,
      thehiveQuery([
        { _name: 'listAlert' },
        { _name: 'page', from: 0, to: 0, extraData: ['total'] }
      ]) as Promise<unknown[]>,
      fetch(`${THEHIVE_URL}/api/status`, {
        signal: AbortSignal.timeout(5000)
      })
    ]);

    const status = (await statusResp.json()) as { versions?: Record<string, string> };

    // TheHive v1 query with page extraData returns empty array when count is 0
    // The total is available in the _extra field if items exist
    // For a fresh install, array will be empty = count 0
    const caseCount = Array.isArray(cases) ? cases.length : 0;
    const alertCount = Array.isArray(alerts) ? alerts.length : 0;

    return json({
      version: status.versions?.TheHive || 'unknown',
      openCases: caseCount,
      alerts: alertCount,
      status: 'online'
    });
  } catch (err) {
    return json(
      { error: (err as Error).message, status: 'error' },
      { status: 502 }
    );
  }
};
