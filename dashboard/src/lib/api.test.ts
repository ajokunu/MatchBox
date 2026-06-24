import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// $app/environment is pulled in transitively by stores.ts (browser flag).
vi.mock('$app/environment', () => ({ browser: false }));

import { fetchMetrics } from './api';
import { metricsStatusStore, metricsStore } from './stores';

describe('fetchMetrics → shared stores (single-poller model, findings 47/48)', () => {
  beforeEach(() => {
    metricsStore.set({});
    metricsStatusStore.set({});
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('populates metricsStore and marks status "ok" on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ openCases: 0, status: 'online' }), { status: 200 }),
        ),
    );
    const ok = await fetchMetrics('thehive');
    expect(ok).toBe(true);
    // Detail pages read THIS store instead of running their own poller.
    expect(get(metricsStore).thehive).toEqual({ openCases: 0, status: 'online' });
    expect(get(metricsStatusStore).thehive).toBe('ok');
  });

  it('marks status "error" (and returns false) on a non-2xx so the page can show the error state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 502 })));
    const ok = await fetchMetrics('wazuh');
    expect(ok).toBe(false);
    expect(get(metricsStatusStore).wazuh).toBe('error');
    // Store data is left untouched (no partial overwrite).
    expect(get(metricsStore).wazuh).toBeUndefined();
  });

  it('marks status "error" on a thrown network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const ok = await fetchMetrics('opencti');
    expect(ok).toBe(false);
    expect(get(metricsStatusStore).opencti).toBe('error');
  });
});
