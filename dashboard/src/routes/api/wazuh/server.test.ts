import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route reads creds from $env/dynamic/private; supply a password so auth runs once.
vi.mock('$env/dynamic/private', () => ({
  env: { WAZUH_API_URL: 'https://wazuh.test:55000', WAZUH_API_USER: 'u', WAZUH_API_PASSWORD: 'p' },
}));

// Stub the upstream helper so we control exactly what each Wazuh endpoint "returns" without
// a live cluster. upstreamFetch returns the path (a tag), upstreamJson maps tag → payload.
const responses = new Map<string, unknown>();
vi.mock('$lib/server/upstream', () => ({
  upstreamFetch: vi.fn(async (url: string) => url),
  upstreamJson: vi.fn(async (tag: string) => {
    for (const [path, payload] of responses) {
      if (typeof tag === 'string' && tag.includes(path)) return payload;
    }
    return {};
  }),
  upstreamErrorResponse: vi.fn(
    () => new Response(JSON.stringify({ status: 'error' }), { status: 502 }),
  ),
}));

import { GET } from './+server';

function setResponses(map: Record<string, unknown>) {
  responses.clear();
  for (const [k, v] of Object.entries(map)) responses.set(k, v);
}

const authOk = { data: { token: 'jwt-token' } };

describe('GET /api/wazuh zod validation (finding 22/42)', () => {
  beforeEach(() => {
    responses.clear();
  });

  it('parses a well-formed response into the expected numeric metrics', async () => {
    setResponses({
      '/security/user/authenticate': authOk,
      '/manager/stats': {
        data: {
          affected_items: [
            {
              alerts: [
                { level: 12, times: 3 },
                { level: 5, times: 7 },
              ],
            },
          ],
        },
      },
      '/agents': {
        data: {
          total_affected_items: 1,
          affected_items: [{ id: '001', name: 'node', status: 'active', os: { name: 'Linux' } }],
        },
      },
      '/manager/info': { data: { affected_items: [{ version: 'v4.14.3' }] } },
      '/rules': { data: { total_affected_items: 1200 } },
      '/sca/000': { data: { affected_items: [] } },
    });

    const resp = await GET({} as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.totalAlerts).toBe(10); // 3 + 7
    expect(body.criticalAlerts).toBe(3); // only level >= 10
    expect(body.activeAgents).toBe(1);
    expect(body.totalAgents).toBe(1);
    expect(body.totalRules).toBe(1200);
    expect(body.version).toBe('v4.14.3');
    expect(body.status).toBe('online');
  });

  it('degrades gracefully (200 + safe defaults) when an upstream returns an unexpected shape', async () => {
    // stats is a 200-with-garbage body (e.g. an error object) — the old `as` cast would let
    // `stats.data.affected_items` slip through and a later access could throw a TypeError that
    // masked into a 502. With safeParse it falls back to empty → totalAlerts 0, not a 502.
    setResponses({
      '/security/user/authenticate': authOk,
      '/manager/stats': { error: true, message: 'temporarily unavailable' },
      '/agents': { data: { affected_items: 'not-an-array' } }, // wrong type → falls back to []
      '/manager/info': {},
      '/rules': {},
      '/sca/000': null,
    });

    const resp = await GET({} as never);
    // The whole route still succeeds rather than 502-ing on the malformed section.
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.totalAlerts).toBe(0);
    expect(body.criticalAlerts).toBe(0);
    expect(body.activeAgents).toBe(0);
    expect(body.totalAgents).toBe(0);
    expect(body.totalRules).toBe(0);
    expect(body.version).toBe('unknown');
    expect(body.agents).toEqual([]);
    expect(body.sca).toEqual([]);
  });
});
