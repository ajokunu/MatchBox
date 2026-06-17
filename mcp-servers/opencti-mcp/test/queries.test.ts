import { describe, it, expect } from "vitest";
import { buildObservableFilters, buildTacticFilter } from "../src/queries.js";

describe("opencti get-attack-patterns tactic filter (Contract §3)", () => {
  it("returns null when no tactic given", () => {
    expect(buildTacticFilter(undefined)).toBeNull();
  });

  it("builds a killChainPhases.phase_name FilterGroup", () => {
    expect(buildTacticFilter("lateral-movement")).toEqual({
      mode: "and",
      filters: [
        { key: "killChainPhases.phase_name", values: ["lateral-movement"], operator: "eq", mode: "or" },
      ],
      filterGroups: [],
    });
  });
});

describe("opencti search-observables entity_type filter", () => {
  it("returns null when no type given", () => {
    expect(buildObservableFilters(undefined)).toBeNull();
  });

  it("builds an entity_type FilterGroup", () => {
    expect(buildObservableFilters("IPv4-Addr")).toEqual({
      mode: "and",
      filters: [{ key: "entity_type", values: ["IPv4-Addr"], operator: "eq", mode: "or" }],
      filterGroups: [],
    });
  });
});
