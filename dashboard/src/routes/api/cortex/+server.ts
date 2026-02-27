import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const CORTEX_URL = env.CORTEX_URL || 'http://localhost:9001';
const CORTEX_API_KEY = env.CORTEX_API_KEY || '';

export const GET: RequestHandler = async () => {
  try {
    // Always fetch status first (no auth required)
    const statusResp = await fetch(`${CORTEX_URL}/api/status`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!statusResp.ok) throw new Error(`Cortex status ${statusResp.status}`);
    const status = (await statusResp.json()) as { versions?: Record<string, string> };

    // Try to get analyzers (may fail if no org/user configured yet)
    let analyzerCount = 0;
    if (CORTEX_API_KEY) {
      try {
        const analyzerResp = await fetch(`${CORTEX_URL}/api/analyzer`, {
          headers: { Authorization: `Bearer ${CORTEX_API_KEY}` },
          signal: AbortSignal.timeout(5000)
        });
        if (analyzerResp.ok) {
          const analyzers = (await analyzerResp.json()) as unknown[];
          if (Array.isArray(analyzers)) analyzerCount = analyzers.length;
        }
      } catch { /* Cortex not yet configured — safe to ignore */ }
    }

    return json({
      version: status.versions?.Cortex || 'unknown',
      analyzers: analyzerCount,
      status: 'online'
    });
  } catch (err) {
    return json(
      { error: (err as Error).message, status: 'error' },
      { status: 502 }
    );
  }
};
