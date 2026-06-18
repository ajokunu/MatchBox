/**
 * Pure FilterGroup builders for the OpenCTI MCP server.
 *
 * Side-effect free so Vitest contract tests can assert the exact GraphQL
 * variable shapes (e.g. the killChainPhases tactic filter) without a live
 * OpenCTI instance.
 */

export type FilterGroup = {
  mode: string;
  filters: { key: string; values: string[]; operator: string; mode: string }[];
  filterGroups: FilterGroup[];
};

/** Observable entity_type filter (search-observables). */
export function buildObservableFilters(type?: string): FilterGroup | null {
  if (!type) return null;
  return {
    mode: 'and',
    filters: [{ key: 'entity_type', values: [type], operator: 'eq', mode: 'or' }],
    filterGroups: [],
  };
}

/**
 * Tactic filter for get-attack-patterns — a real FilterGroup on
 * killChainPhases.phase_name (NOT folded into the free-text search).
 */
export function buildTacticFilter(tactic?: string): FilterGroup | null {
  if (!tactic) return null;
  return {
    mode: 'and',
    filters: [{ key: 'killChainPhases.phase_name', values: [tactic], operator: 'eq', mode: 'or' }],
    filterGroups: [],
  };
}

/**
 * Request-level pagination cursor charset (finding 36).
 *
 * OpenCTI connections are Relay-style: a previous page's `pageInfo.endCursor`
 * is an opaque, base64-ish token fed back as the `after` argument. We constrain
 * it to a transport-safe charset (base64 + base64url alphabet) so an LLM-
 * supplied cursor can't smuggle anything unexpected into the GraphQL variable,
 * while still round-tripping a genuine OpenCTI cursor. Exported pure so the
 * contract tests can assert it without a live OpenCTI instance.
 */
export const PAGINATION_CURSOR_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

/** True when an `after` cursor is structurally a valid OpenCTI pagination cursor. */
export function isValidCursor(cursor: string): boolean {
  return cursor.length <= 1024 && PAGINATION_CURSOR_PATTERN.test(cursor);
}

/**
 * Normalize a `first`/`after` pair into the GraphQL variables OpenCTI expects.
 * An absent/empty cursor must be sent as `null` (not undefined or "") so the
 * connection starts at the beginning rather than erroring on a bad cursor.
 */
export function buildPageVariables(
  first: number,
  after?: string,
): { first: number; after: string | null } {
  return { first, after: after || null };
}
