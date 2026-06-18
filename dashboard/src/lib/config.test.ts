import { describe, expect, it, vi } from 'vitest';

// config.ts reads $env/dynamic/public for the PUBLIC_* base URLs.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { storeKeyForEndpoint } from './config';

describe('storeKeyForEndpoint (serviceId → metricsStore key)', () => {
  it('maps a plain /api/<id> endpoint to its service id', () => {
    expect(storeKeyForEndpoint('/api/wazuh')).toBe('wazuh');
    expect(storeKeyForEndpoint('/api/thehive')).toBe('thehive');
  });

  it('strips a trailing sub-path so nested endpoints still resolve to the base id', () => {
    expect(storeKeyForEndpoint('/api/opencti/detail')).toBe('opencti');
  });
});
