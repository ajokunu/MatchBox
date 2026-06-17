import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import StatusDot from './StatusDot.svelte';

describe('StatusDot accessibility', () => {
  it('exposes a text alternative combining the label and status', () => {
    const { getByRole } = render(StatusDot, { props: { status: 'online', label: 'Wazuh' } });
    // role="img" + aria-label means status is not conveyed by color/animation alone.
    const dot = getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Wazuh: online');
  });

  it('falls back to a generic status label when no service label is given', () => {
    const { getByRole } = render(StatusDot, { props: { status: 'offline' } });
    expect(getByRole('img').getAttribute('aria-label')).toBe('Status: offline');
  });
});
