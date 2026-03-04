import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const THEHIVE_URL = env.THEHIVE_URL || 'http://localhost:9000';
const THEHIVE_API_KEY = env.THEHIVE_API_KEY || '';

async function thehiveCount(listOp: string): Promise<number> {
  const resp = await fetch(`${THEHIVE_URL}/api/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${THEHIVE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: [
        { _name: listOp },
        { _name: 'count' }
      ]
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!resp.ok) throw new Error(`TheHive ${resp.status}`);
  return resp.json() as Promise<number>;
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
    // Fetch case count, alert count, and status in parallel
    const [caseCount, alertCount, statusResp] = await Promise.all([
      thehiveCount('listCase'),
      thehiveCount('listAlert'),
      fetch(`${THEHIVE_URL}/api/status`, {
        signal: AbortSignal.timeout(5000)
      })
    ]);

    if (!statusResp.ok) throw new Error(`TheHive status ${statusResp.status}`);
    const status = (await statusResp.json()) as { versions?: Record<string, string> };

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
