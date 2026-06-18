import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock SvelteKit's env so the module under test can import `$env/dynamic/private`.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { UpstreamError, upstreamErrorResponse, upstreamFetch, upstreamJson } from './upstream';

describe('upstreamFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the response on a 2xx', async () => {
    const ok = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok));
    const resp = await upstreamFetch('https://example.test/ok');
    expect(resp.status).toBe(200);
  });

  it('throws a generic UpstreamError on a non-2xx (no body leaked)', async () => {
    const bad = new Response('internal hostname leak: db.soc.local', { status: 500 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bad));
    await expect(upstreamFetch('https://example.test/fail')).rejects.toBeInstanceOf(UpstreamError);
    // The thrown message exposes only the status code, never the body text.
    await expect(upstreamFetch('https://example.test/fail')).rejects.toThrow(/responded 500/);
    await expect(upstreamFetch('https://example.test/fail')).rejects.not.toThrow(/db\.soc\.local/);
  });

  it('maps a network error to a generic "upstream unreachable"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:55000')));
    await expect(upstreamFetch('https://example.test/down')).rejects.toThrow(
      /upstream unreachable/,
    );
    // The internal IP:port must not surface.
    await expect(upstreamFetch('https://example.test/down')).rejects.not.toThrow(/10\.0\.0\.5/);
  });
});

describe('upstreamJson', () => {
  it('parses valid JSON', async () => {
    const resp = new Response(JSON.stringify({ a: 1 }), { status: 200 });
    expect(await upstreamJson<{ a: number }>(resp)).toEqual({ a: 1 });
  });

  it('throws a generic error on malformed JSON', async () => {
    const resp = new Response('not-json', { status: 200 });
    await expect(upstreamJson(resp)).rejects.toThrow(/invalid response/);
  });
});

describe('upstreamErrorResponse', () => {
  it('returns a 502 with a generic body and never echoes the cause', async () => {
    const resp = upstreamErrorResponse(new Error('secret topology: wazuh-indexer:9200'));
    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body).toEqual({ status: 'error', error: 'upstream unavailable' });
    expect(JSON.stringify(body)).not.toContain('wazuh-indexer');
  });
});
