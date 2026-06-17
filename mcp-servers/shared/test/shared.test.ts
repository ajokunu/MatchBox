import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatResponse,
  fetchWithRetry,
  safeId,
  optionalSafeId,
  ID_PATTERN,
  basicAuth,
  indexerSearch,
} from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("safeId / ID_PATTERN", () => {
  it("accepts the reconciled charset (alnum _ . ~ -)", () => {
    for (const id of ["abc123", "a_b", "1.2.3", "~123", "uuid-with-dash", "a.b~c-d_e"]) {
      expect(ID_PATTERN.test(id)).toBe(true);
      expect(safeId.safeParse(id).success).toBe(true);
    }
  });
  it("rejects injection / path characters", () => {
    for (const id of ["../etc", "a/b", "a b", "a;b", "a'b", ""]) {
      expect(safeId.safeParse(id).success).toBe(false);
    }
  });
  it("optionalSafeId allows undefined but not empty string", () => {
    expect(optionalSafeId.safeParse(undefined).success).toBe(true);
    expect(optionalSafeId.safeParse("").success).toBe(false);
  });
});

describe("basicAuth", () => {
  it("base64-encodes user:password", () => {
    expect(basicAuth("admin", "secret")).toBe("Basic " + Buffer.from("admin:secret").toString("base64"));
  });
});

describe("formatResponse", () => {
  it("returns valid JSON unchanged when under the limit", () => {
    const data = { a: 1, b: [1, 2, 3] };
    const out = formatResponse(data, 50000);
    expect(JSON.parse(out)).toEqual(data);
  });

  it("truncates a top-level array but stays valid JSON", () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({ i, pad: "x".repeat(50) }));
    const out = formatResponse(data, 2000);
    const parsed = JSON.parse(out); // must not throw
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(1000);
    expect(parsed.shown).toBeLessThan(1000);
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBe(parsed.shown);
  });

  it("truncates a GraphQL-style edges array in place and stays valid JSON", () => {
    const edges = Array.from({ length: 500 }, (_, i) => ({ node: { id: String(i), pad: "y".repeat(40) } }));
    const data = { stixCyberObservables: { edges, pageInfo: { globalCount: 500 } } };
    const out = formatResponse(data, 2500);
    const parsed = JSON.parse(out);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(500);
    expect(parsed.data.stixCyberObservables.edges.length).toBe(parsed.shown);
    // unrelated fields are preserved
    expect(parsed.data.stixCyberObservables.pageInfo.globalCount).toBe(500);
  });

  it("flags non-trimmable oversized payloads as NOT valid JSON", () => {
    const data = { blob: "z".repeat(5000) };
    const out = formatResponse(data, 1000);
    expect(out).toContain("NOT VALID JSON");
  });
});

describe("fetchWithRetry", () => {
  it("retries a 503 once then returns the 200 (idempotent GET)", async () => {
    const responses = [new Response("a", { status: 503 }), new Response("b", { status: 200 })];
    const f = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", f);
    const r = await fetchWithRetry("https://x/", { method: "GET" }, 1000, 5000);
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("returns the second 503 (does NOT throw 'failed after retries')", async () => {
    const f = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", f);
    const r = await fetchWithRetry("https://x/", { method: "GET" }, 1000, 5000);
    expect(r.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("returns a non-retryable 404 immediately without retrying", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", f);
    const r = await fetchWithRetry("https://x/", { method: "GET" }, 1000, 5000);
    expect(r.status).toBe(404);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does NOT auto-retry a non-idempotent POST on 503 unless opted in", async () => {
    const f = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", f);
    const r = await fetchWithRetry("https://x/", { method: "POST" }, 1000, 5000);
    expect(r.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(1); // no retry
  });

  it("DOES retry a POST when retryable:true is set (e.g. _search / auth)", async () => {
    const responses = [new Response("busy", { status: 503 }), new Response("ok", { status: 200 })];
    const f = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", f);
    const r = await fetchWithRetry("https://x/", { method: "POST", retryable: true }, 1000, 5000);
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("indexerSearch", () => {
  it("POSTs to {base}/{index}/_search with Basic auth and JSON body", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit = {};
    const f = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);

    const auth = basicAuth("admin", "pw");
    await indexerSearch("https://idx:9200/", "wazuh-alerts-*", { size: 5 }, auth);

    expect(capturedUrl).toBe("https://idx:9200/wazuh-alerts-*/_search");
    expect(capturedInit.method).toBe("POST");
    const headers = capturedInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe(auth);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(capturedInit.body as string)).toEqual({ size: 5 });
  });
});
