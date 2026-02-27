import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const OPENCTI_URL = env.OPENCTI_URL || 'http://localhost:4000';
const OPENCTI_TOKEN = env.OPENCTI_TOKEN || '';

async function graphql(query: string): Promise<unknown> {
  const resp = await fetch(`${OPENCTI_URL}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENCTI_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!resp.ok) throw new Error(`OpenCTI ${resp.status}`);
  const result = (await resp.json()) as { data: unknown; errors?: unknown[] };
  if (result.errors) throw new Error('GraphQL error');
  return result.data;
}

export const GET: RequestHandler = async () => {
  // If no token configured, return minimal status
  if (!OPENCTI_TOKEN) {
    try {
      await fetch(`${OPENCTI_URL}/health`, { signal: AbortSignal.timeout(5000) });
      return json({ status: 'online', note: 'No API token configured' });
    } catch {
      return json({ status: 'offline' }, { status: 502 });
    }
  }

  try {
    const data = (await graphql(`{
      about { version }
      stixCyberObservables(first: 0) { pageInfo { globalCount } }
      reports(first: 0) { pageInfo { globalCount } }
      connectors { id name active }
    }`)) as {
      about: { version: string };
      stixCyberObservables: { pageInfo: { globalCount: number } };
      reports: { pageInfo: { globalCount: number } };
      connectors: Array<{ id: string; name: string; active: boolean }>;
    };

    return json({
      version: data.about.version,
      indicators: data.stixCyberObservables.pageInfo.globalCount,
      reports: data.reports.pageInfo.globalCount,
      connectors: data.connectors.length,
      activeConnectors: data.connectors.filter((c) => c.active).length,
      status: 'online'
    });
  } catch (err) {
    return json(
      { error: (err as Error).message, status: 'error' },
      { status: 502 }
    );
  }
};
