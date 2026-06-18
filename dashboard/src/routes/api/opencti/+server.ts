import { env } from '$env/dynamic/private';
import { upstreamErrorResponse, upstreamFetch, upstreamJson } from '$lib/server/upstream';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const OPENCTI_URL = env.OPENCTI_URL || 'http://localhost:4000';
const OPENCTI_TOKEN = env.OPENCTI_TOKEN || '';

async function graphql(query: string): Promise<Record<string, unknown>> {
  const resp = await upstreamFetch(`${OPENCTI_URL}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENCTI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const result = await upstreamJson<{ data?: Record<string, unknown>; errors?: unknown[] }>(resp);
  if (result.errors) throw new Error('GraphQL error');
  return result.data ?? {};
}

// Narrow accessor: tolerate partial/missing GraphQL shapes without throwing TypeErrors.
function count(node: unknown): number {
  const c = (node as { pageInfo?: { globalCount?: number } } | undefined)?.pageInfo?.globalCount;
  return typeof c === 'number' ? c : 0;
}

export const GET: RequestHandler = async () => {
  // If no token configured, return minimal status only.
  if (!OPENCTI_TOKEN) {
    try {
      await upstreamFetch(`${OPENCTI_URL}/health`, { timeoutMs: 5000 });
      return json({ status: 'online', note: 'No API token configured' });
    } catch (err) {
      return upstreamErrorResponse(err);
    }
  }

  try {
    const data = await graphql(`{
      about { version }
      indicators(first: 0) { pageInfo { globalCount } }
      stixCyberObservables(first: 0) { pageInfo { globalCount } }
      reports(first: 0) { pageInfo { globalCount } }
      malwares(first: 0) { pageInfo { globalCount } }
      threatActorsIndividual: threatActorsIndividuals(first: 0) { pageInfo { globalCount } }
      connectors { id name active }
    }`);

    const connectors = Array.isArray(data.connectors)
      ? (data.connectors as Array<{ active?: boolean }>)
      : [];

    return json({
      version: (data.about as { version?: string } | undefined)?.version ?? 'unknown',
      indicators: count(data.indicators),
      observables: count(data.stixCyberObservables),
      reports: count(data.reports),
      malwares: count(data.malwares),
      threatActors: count(data.threatActorsIndividual),
      connectors: connectors.length,
      activeConnectors: connectors.filter((c) => c.active).length,
      status: 'online',
    });
  } catch (err) {
    return upstreamErrorResponse(err);
  }
};
