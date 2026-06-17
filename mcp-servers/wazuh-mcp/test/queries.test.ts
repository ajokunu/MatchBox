import { describe, it, expect } from "vitest";
import { buildListAlertsBody, buildGetAlertBody, buildVulnBody } from "../src/queries.js";

describe("wazuh list-alerts indexer _search body (Contract §3)", () => {
  it("defaults to match_all sorted by @timestamp desc", () => {
    const body = buildListAlertsBody({ limit: 20 });
    expect(body).toEqual({
      size: 20,
      sort: [{ "@timestamp": { order: "desc" } }],
      query: { match_all: {} },
    });
  });

  it("level_min -> range rule.level >= n", () => {
    const body = buildListAlertsBody({ limit: 5, level_min: 7 });
    expect(body.query).toEqual({ bool: { must: [{ range: { "rule.level": { gte: 7 } } }] } });
  });

  it("agent_id -> term agent.id, rule_id -> term rule.id", () => {
    const body = buildListAlertsBody({ limit: 5, agent_id: "001", rule_id: "5710" });
    expect(body.query).toEqual({
      bool: { must: [{ term: { "agent.id": "001" } }, { term: { "rule.id": "5710" } }] },
    });
  });

  it("keeps a level_min of 0 (no truthiness drop)", () => {
    const body = buildListAlertsBody({ limit: 5, level_min: 0 });
    expect(body.query).toEqual({ bool: { must: [{ range: { "rule.level": { gte: 0 } } }] } });
  });
});

describe("wazuh get-alert indexer _search body", () => {
  it("matches the document _id", () => {
    expect(buildGetAlertBody("abc-123")).toEqual({ size: 1, query: { term: { _id: "abc-123" } } });
  });
});

describe("wazuh get-vulnerabilities indexer _search body (Contract §3)", () => {
  it("filters by agent.id and sorts by severity desc", () => {
    const body = buildVulnBody({ agent_id: "001", limit: 10 });
    expect(body).toEqual({
      size: 10,
      sort: [{ "vulnerability.severity": { order: "desc" } }],
      query: { bool: { must: [{ term: { "agent.id": "001" } }] } },
    });
  });

  it("adds the optional severity term", () => {
    const body = buildVulnBody({ agent_id: "001", severity: "Critical", limit: 10 });
    expect((body.query as any).bool.must).toContainEqual({
      term: { "vulnerability.severity": "Critical" },
    });
  });
});
