import { describe, expect, it } from 'vitest';
import {
  buildObservableFilters,
  buildPageVariables,
  buildTacticFilter,
  isValidCursor,
} from '../src/queries.js';

describe('opencti get-attack-patterns tactic filter (Contract §3)', () => {
  it('returns null when no tactic given', () => {
    expect(buildTacticFilter(undefined)).toBeNull();
  });

  it('builds a killChainPhases.phase_name FilterGroup', () => {
    expect(buildTacticFilter('lateral-movement')).toEqual({
      mode: 'and',
      filters: [
        {
          key: 'killChainPhases.phase_name',
          values: ['lateral-movement'],
          operator: 'eq',
          mode: 'or',
        },
      ],
      filterGroups: [],
    });
  });
});

describe('opencti search-observables entity_type filter', () => {
  it('returns null when no type given', () => {
    expect(buildObservableFilters(undefined)).toBeNull();
  });

  it('builds an entity_type FilterGroup', () => {
    expect(buildObservableFilters('IPv4-Addr')).toEqual({
      mode: 'and',
      filters: [{ key: 'entity_type', values: ['IPv4-Addr'], operator: 'eq', mode: 'or' }],
      filterGroups: [],
    });
  });
});

describe('opencti request-level pagination (finding 36)', () => {
  it('sends a null cursor when none is given (start of connection)', () => {
    expect(buildPageVariables(20)).toEqual({ first: 20, after: null });
    expect(buildPageVariables(20, '')).toEqual({ first: 20, after: null });
  });

  it('threads a real endCursor through as the after variable', () => {
    expect(buildPageVariables(50, 'WyJhYmMiXQ==')).toEqual({
      first: 50,
      after: 'WyJhYmMiXQ==',
    });
  });

  it('accepts genuine base64 / base64url OpenCTI cursors', () => {
    for (const ok of ['WyJhYmMiXQ==', 'eyJpZCI6MX0', 'abc-DEF_123', 'AAAA']) {
      expect(isValidCursor(ok)).toBe(true);
    }
  });

  it('rejects cursors carrying GraphQL-injection / structural characters', () => {
    for (const bad of ['" ) { __schema', 'a b', 'drop(){', '<x>', 'a\nb', 'café']) {
      expect(isValidCursor(bad)).toBe(false);
    }
  });

  it('caps cursor length at 1024', () => {
    expect(isValidCursor('A'.repeat(1024))).toBe(true);
    expect(isValidCursor('A'.repeat(1025))).toBe(false);
  });
});
