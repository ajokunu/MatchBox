import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { upstreamFetch, upstreamJson, upstreamErrorResponse } from '$lib/server/upstream';

const CORTEX_URL = env.CORTEX_URL || 'http://localhost:9001';
const CORTEX_API_KEY = env.CORTEX_API_KEY || '';

export const GET: RequestHandler = async () => {
  try {
    // Always fetch status first (no auth required).
    const statusResp = await upstreamFetch(`${CORTEX_URL}/api/status`, { timeoutMs: 5000 });
    const status = await upstreamJson<{ versions?: Record<string, string> }>(statusResp);

    // Try to get analyzers (may fail if no org/user configured yet).
    let analyzerCount = 0;
    let configured = false;
    if (CORTEX_API_KEY && CORTEX_API_KEY !== 'CHANGE_ME') {
      try {
        const analyzerResp = await upstreamFetch(`${CORTEX_URL}/api/analyzer`, {
          headers: { Authorization: `Bearer ${CORTEX_API_KEY}` },
          timeoutMs: 5000
        });
        const analyzers = await upstreamJson<unknown[]>(analyzerResp);
        if (Array.isArray(analyzers)) {
          analyzerCount = analyzers.length;
          configured = true;
        }
      } catch { /* Cortex not yet configured — safe to ignore */ }
    }

    return json({
      version: status.versions?.Cortex || 'unknown',
      analyzers: analyzerCount,
      configured,
      status: 'online'
    });
  } catch (err) {
    return upstreamErrorResponse(err);
  }
};
