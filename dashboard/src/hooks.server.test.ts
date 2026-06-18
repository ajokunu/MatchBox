import { describe, expect, it, vi } from 'vitest';

// Token is configured → auth is enforced. dev=false so missing token also fails closed.
vi.mock('$env/dynamic/private', () => ({ env: { SOC_API_TOKEN: 'sekret-token' } }));
vi.mock('$app/environment', () => ({ dev: false }));

import { handle } from './hooks.server';

const ORIGIN = 'http://localhost:5173';

function makeEvent(path: string, headers: Record<string, string> = {}, method = 'GET') {
  const url = new URL(ORIGIN + path);
  const request = new Request(url, { method, headers });
  return { url, request, route: { id: path } } as never;
}

// resolve() stub that signals "handler ran" by returning a 200.
const resolve = vi.fn(async () => new Response('ok', { status: 200 }));

describe('hooks /api/* auth', () => {
  it('passes through non-/api routes without auth', async () => {
    const resp = await handle({ event: makeEvent('/'), resolve });
    expect(resp.status).toBe(200);
  });

  it('rejects /api/* with no bearer token (401)', async () => {
    const resp = await handle({ event: makeEvent('/api/wazuh'), resolve });
    expect(resp.status).toBe(401);
  });

  it('rejects /api/* with the wrong token (401)', async () => {
    const resp = await handle({
      event: makeEvent('/api/wazuh', { authorization: 'Bearer nope' }),
      resolve,
    });
    expect(resp.status).toBe(401);
  });

  it('allows /api/* with the correct bearer token', async () => {
    const resp = await handle({
      event: makeEvent('/api/wazuh', { authorization: 'Bearer sekret-token' }),
      resolve,
    });
    expect(resp.status).toBe(200);
  });

  it('rejects a cross-origin request to /api/* (403) before checking the token', async () => {
    const resp = await handle({
      event: makeEvent('/api/wazuh', {
        origin: 'http://evil.example',
        authorization: 'Bearer sekret-token',
      }),
      resolve,
    });
    expect(resp.status).toBe(403);
  });

  it('accepts the token via the soc_api cookie', async () => {
    const resp = await handle({
      event: makeEvent('/api/wazuh', { cookie: 'soc_api=sekret-token' }),
      resolve,
    });
    expect(resp.status).toBe(200);
  });
});
