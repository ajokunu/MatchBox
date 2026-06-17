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
    mode: "and",
    filters: [{ key: "entity_type", values: [type], operator: "eq", mode: "or" }],
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
    mode: "and",
    filters: [{ key: "killChainPhases.phase_name", values: [tactic], operator: "eq", mode: "or" }],
    filterGroups: [],
  };
}
