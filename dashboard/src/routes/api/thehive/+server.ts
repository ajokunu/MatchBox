import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const THEHIVE_URL = env.THEHIVE_URL || 'http://localhost:9000';
const THEHIVE_API_KEY = env.THEHIVE_API_KEY || '';

async function thehiveApi(method: string, path: string, body?: unknown): Promise<unknown> {
  const resp = await fetch(`${THEHIVE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${THEHIVE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
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
    // Query open cases
    const cases = (await thehiveApi('POST', '/api/v1/query', {
      query: [
        { _name: 'listCase' },
        { _name: 'filter', _gte: { _field: 'stage', _value: 'InProgress' } },
        { _name: 'page', from: 0, to: 0, extraData: ['total'] }
      ]
    })) as unknown[];

    // Get status info
    const statusResp = await fetch(`${THEHIVE_URL}/api/status`, {
      signal: AbortSignal.timeout(5000)
    });
    const status = (await statusResp.json()) as { versions?: Record<string, string> };

    return json({
      version: status.versions?.TheHive || 'unknown',
      openCases: Array.isArray(cases) ? cases.length : 0,
      status: 'online'
    });
  } catch (err) {
    return json(
      { error: (err as Error).message, status: 'error' },
      { status: 502 }
    );
  }
};
