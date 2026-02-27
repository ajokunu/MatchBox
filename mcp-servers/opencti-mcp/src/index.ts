#!/usr/bin/env node
/**
 * OpenCTI MCP Server
 *
 * Provides Claude Code with tools to query OpenCTI threat intelligence:
 * - search-indicators: Search threat indicators (IOCs)
 * - get-indicator: Get indicator details and relationships
 * - search-reports: Search threat intelligence reports
 * - get-attack-patterns: List MITRE ATT&CK techniques
 * - enrich-observable: Request enrichment for an observable
 * - get-relationships: Get entity relationships
 *
 * Auth: OpenCTI API token in Authorization header.
 * Environment: OPENCTI_URL, OPENCTI_TOKEN
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OPENCTI_URL = process.env.OPENCTI_URL || "https://localhost:4000";
const OPENCTI_TOKEN = process.env.OPENCTI_TOKEN;

if (!OPENCTI_TOKEN) {
  console.error("FATAL: OPENCTI_TOKEN environment variable is required");
  process.exit(1);
}

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || "10000", 10);
/** Validate ID parameters to prevent path traversal (+ requires at least 1 char) */
const safeId = z.string().regex(/^[a-zA-Z0-9_-]+$/, "Invalid ID format");

/** Retry-eligible HTTP status codes */
const RETRYABLE_CODES = new Set([429, 503]);

/** Fetch with single retry on transient failures (429/503/timeout) */
async function fetchWithRetry(url: string, opts: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      if (attempt === 0 && RETRYABLE_CODES.has(resp.status)) {
        console.error(`Retrying ${url} after ${resp.status}...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return resp;
    } catch (err: unknown) {
      if (attempt === 0 && err instanceof Error && err.name === "AbortError") {
        console.error(`Retrying ${url} after timeout...`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Request to ${url} failed after retries`);
}

/** Execute a GraphQL query against OpenCTI with timeout and retry */
async function graphql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const resp = await fetchWithRetry(`${OPENCTI_URL}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENCTI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 200);
    throw new Error(`OpenCTI API error: ${resp.status} ${text}`);
  }

  const result = await resp.json() as { data: unknown; errors?: unknown[] };
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors).slice(0, 500)}`);
  }
  return result.data;
}

/** Maximum response size in characters to prevent excessive output to LLM */
const MAX_RESPONSE_CHARS = parseInt(process.env.MAX_RESPONSE_CHARS || "50000", 10);

/** Serialize data to JSON and truncate if it exceeds the size limit */
function formatResponse(data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  if (json.length <= MAX_RESPONSE_CHARS) return json;
  return json.slice(0, MAX_RESPONSE_CHARS) + `\n... [truncated: ${json.length} chars total, showing first ${MAX_RESPONSE_CHARS}]`;
}

const server = new McpServer({
  name: "opencti-mcp",
  version: "1.0.0",
});

// search-indicators
server.tool(
  "search-indicators",
  "Search OpenCTI threat indicators (IOCs) by value or type",
  {
    value: z.string().optional().describe("Search by indicator value (IP, domain, hash, etc.)"),
    type: z.string().optional().describe("Filter by type (IPv4-Addr, Domain-Name, StixFile, Url, etc.)"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ value, type, limit }) => {
    const filters = [];
    if (type) {
      filters.push({ key: "entity_type", values: [type] });
    }

    const result = await graphql(
      `query SearchIndicators($search: String, $first: Int, $filters: FilterGroup) {
        stixCyberObservables(search: $search, first: $first, filters: $filters) {
          edges {
            node {
              id
              entity_type
              observable_value
              created_at
              updated_at
              objectLabel { value color }
              createdBy { name }
              objectMarking { definition }
            }
          }
          pageInfo { globalCount }
        }
      }`,
      {
        search: value || null,
        first: limit,
        filters: filters.length > 0
          ? { mode: "and", filters, filterGroups: [] }
          : null,
      }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-indicator
server.tool(
  "get-indicator",
  "Get full details of an OpenCTI indicator including relationships",
  { indicator_id: safeId.describe("OpenCTI entity ID") },
  async ({ indicator_id }) => {
    const result = await graphql(
      `query GetIndicator($id: String!) {
        stixCyberObservable(id: $id) {
          id
          entity_type
          observable_value
          created_at
          updated_at
          objectLabel { value color }
          createdBy { name }
          objectMarking { definition }
          stixCoreRelationships {
            edges {
              node {
                id
                relationship_type
                from { ... on StixDomainObject { id name entity_type } }
                to { ... on StixDomainObject { id name entity_type } }
              }
            }
          }
          indicators {
            edges {
              node {
                id
                name
                pattern
                valid_from
                valid_until
              }
            }
          }
        }
      }`,
      { id: indicator_id }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// search-reports
server.tool(
  "search-reports",
  "Search OpenCTI threat intelligence reports",
  {
    search: z.string().max(256).optional().describe("Search text in report names/descriptions"),
    limit: z.number().min(1).max(100).optional().default(10),
  },
  async ({ search, limit }) => {
    const result = await graphql(
      `query SearchReports($search: String, $first: Int) {
        reports(search: $search, first: $first, orderBy: created_at, orderMode: desc) {
          edges {
            node {
              id
              name
              description
              published
              created_at
              report_types
              objectLabel { value }
              createdBy { name }
              objectMarking { definition }
            }
          }
          pageInfo { globalCount }
        }
      }`,
      { search: search || null, first: limit }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-attack-patterns
server.tool(
  "get-attack-patterns",
  "List MITRE ATT&CK techniques, optionally filtered by tactic",
  {
    search: z.string().max(256).optional().describe("Search text (e.g., 'phishing', 'lateral movement')"),
    tactic: z.string().max(256).optional().describe("Filter by kill chain phase (e.g., 'initial-access', 'lateral-movement')"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ search, tactic, limit }) => {
    const result = await graphql(
      `query GetAttackPatterns($search: String, $first: Int) {
        attackPatterns(search: $search, first: $first, orderBy: name, orderMode: asc) {
          edges {
            node {
              id
              name
              description
              x_mitre_id
              x_mitre_platforms
              killChainPhases { kill_chain_name phase_name }
              subAttackPatterns {
                edges { node { id name x_mitre_id } }
              }
            }
          }
          pageInfo { globalCount }
        }
      }`,
      { search: search || tactic || null, first: limit }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// enrich-observable
server.tool(
  "enrich-observable",
  "[WRITE] Request enrichment for an observable in OpenCTI. This triggers external connector queries.",
  {
    observable_id: safeId.describe("Observable entity ID to enrich"),
    connector_id: safeId.optional().describe("Specific connector ID to use"),
  },
  async ({ observable_id, connector_id }) => {
    const result = await graphql(
      `mutation EnrichObservable($id: ID!, $connectorId: ID) {
        stixCyberObservableEdit(id: $id) {
          askEnrichment(connectorId: $connectorId) {
            id
            connector { name }
            status
          }
        }
      }`,
      { id: observable_id, connectorId: connector_id || null }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-relationships
server.tool(
  "get-relationships",
  "Get relationships for an OpenCTI entity",
  {
    entity_id: safeId.describe("Entity ID to get relationships for"),
    relationship_type: z.string().max(100).optional().describe("Filter by type (e.g., 'uses', 'targets', 'indicates')"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ entity_id, relationship_type, limit }) => {
    const result = await graphql(
      `query GetRelationships($id: String!, $relationship_type: [String], $first: Int) {
        stixCoreRelationships(
          fromOrToId: $id,
          relationship_type: $relationship_type,
          first: $first,
          orderBy: created_at,
          orderMode: desc
        ) {
          edges {
            node {
              id
              relationship_type
              description
              confidence
              start_time
              stop_time
              from {
                ... on StixDomainObject { id name entity_type }
                ... on StixCyberObservable { id observable_value entity_type }
              }
              to {
                ... on StixDomainObject { id name entity_type }
                ... on StixCyberObservable { id observable_value entity_type }
              }
            }
          }
          pageInfo { globalCount }
        }
      }`,
      {
        id: entity_id,
        relationship_type: relationship_type ? [relationship_type] : null,
        first: limit,
      }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// --- Start Server ---
async function main() {
  // Connectivity test
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const resp = await fetch(`${OPENCTI_URL}/health`, {
      headers: { Authorization: `Bearer ${OPENCTI_TOKEN}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    console.error(`OpenCTI connectivity: ${resp.ok ? "OK" : resp.status} (${OPENCTI_URL})`);
  } catch (e) {
    console.error(`WARNING: OpenCTI unreachable at ${OPENCTI_URL} — tools will fail until it's available`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenCTI MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
