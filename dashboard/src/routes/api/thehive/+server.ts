import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { upstreamFetch, upstreamJson, upstreamErrorResponse } from '$lib/server/upstream';

const THEHIVE_URL = env.THEHIVE_URL || 'http://localhost:9000';
const THEHIVE_API_KEY = env.THEHIVE_API_KEY || '';

async function thehiveCount(listOp: string): Promise<number> {
  const resp = await upstreamFetch(`${THEHIVE_URL}/api/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${THEHIVE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: [{ _name: listOp }, { _name: 'count' }]
    })
  });
  // TheHive /api/v1/query returns results as a JSON array even for aggregations —
  // a `count` op yields `[N]`, not a bare `N`. Unwrap defensively either way.
  const result = await upstreamJson<unknown>(resp);
  const n = Array.isArray(result) ? result[0] : result;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export const GET: RequestHandler = async () => {
  // If no API key, return basic status only.
  if (!THEHIVE_API_KEY) {
    try {
      const resp = await upstreamFetch(`${THEHIVE_URL}/api/status`, { timeoutMs: 5000 });
      const data = await upstreamJson<{ versions?: Record<string, string> }>(resp);
      return json({
        status: 'online',
        version: data.versions?.TheHive || 'unknown',
        note: 'No API key configured'
      });
    } catch (err) {
      return upstreamErrorResponse(err);
    }
  }

  try {
    // Fetch case count, alert count, and status in parallel.
    const [caseCount, alertCount, statusResp] = await Promise.all([
      thehiveCount('listCase'),
      thehiveCount('listAlert'),
      upstreamFetch(`${THEHIVE_URL}/api/status`, { timeoutMs: 5000 })
    ]);

    const status = await upstreamJson<{ versions?: Record<string, string> }>(statusResp);

    return json({
      version: status.versions?.TheHive || 'unknown',
      openCases: caseCount,
      alerts: alertCount,
      status: 'online'
    });
  } catch (err) {
    return upstreamErrorResponse(err);
  }
};
