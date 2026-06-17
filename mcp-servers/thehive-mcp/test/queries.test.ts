import { describe, it, expect } from "vitest";
import { ALERT_MERGE_BULK_PATH, alertToCasePath, buildMergeBulkBody, joinUrl } from "../src/queries.js";

describe("thehive merge-alerts endpoint + payload (TheHive 5, Contract §3 fix)", () => {
  it("uses the bulk merge route, NOT /api/v1/alert/merge", () => {
    expect(ALERT_MERGE_BULK_PATH).toBe("/api/v1/alert/merge/_bulk");
    expect(ALERT_MERGE_BULK_PATH).not.toBe("/api/v1/alert/merge");
  });

  it("payload is { caseId, alertIds }", () => {
    expect(buildMergeBulkBody("~42", ["~1", "~2"])).toEqual({
      caseId: "~42",
      alertIds: ["~1", "~2"],
    });
  });

  it("promotes an alert to a case via /api/v1/alert/{id}/case", () => {
    expect(alertToCasePath("~7")).toBe("/api/v1/alert/~7/case");
  });
});

describe("thehive joinUrl preserves an ingress sub-path", () => {
  it("does NOT drop the /thehive prefix (new URL() bug)", () => {
    expect(joinUrl("https://soc.homelab.local/thehive", "/api/v1/status")).toBe(
      "https://soc.homelab.local/thehive/api/v1/status"
    );
  });
  it("works without a sub-path", () => {
    expect(joinUrl("https://localhost:9000", "/api/v1/case")).toBe("https://localhost:9000/api/v1/case");
  });
  it("normalizes duplicate slashes", () => {
    expect(joinUrl("https://h/thehive/", "/api/v1/x")).toBe("https://h/thehive/api/v1/x");
  });
});
