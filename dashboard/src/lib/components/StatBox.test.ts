import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import StatBox from './StatBox.svelte';

describe('StatBox empty vs genuine-zero state (finding 22/59)', () => {
  it('renders a genuine zero as the actual value, not a placeholder', () => {
    const { getByText, queryByText } = render(StatBox, {
      props: { label: 'Open Cases', value: 0 },
    });
    // A real measured 0 must show as "0" (reached service with no cases) ...
    expect(getByText('0')).toBeTruthy();
    // ... and must NOT collapse into the no-data em-dash.
    expect(queryByText('—')).toBeNull();
  });

  it('renders the muted em-dash placeholder when empty (no data yet)', () => {
    const { getByText, queryByText } = render(StatBox, {
      props: { label: 'Open Cases', value: 0, empty: true },
    });
    // "No data yet" is visually distinct from a genuine 0 — never shows the 0.
    expect(getByText('—')).toBeTruthy();
    expect(queryByText('0')).toBeNull();
  });

  it('exposes the empty hint as an accessible label so it is not color-only', () => {
    const { getByText } = render(StatBox, {
      props: { label: 'Indicators', value: 0, empty: true, emptyHint: 'awaiting token' },
    });
    const placeholder = getByText('—');
    expect(placeholder.getAttribute('aria-label')).toBe('Indicators: awaiting token');
  });
});
