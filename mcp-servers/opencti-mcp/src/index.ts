#!/usr/bin/env node
/**
 * OpenCTI MCP Server
 *
 * Provides Claude Code with tools to query OpenCTI threat intelligence:
 * - search-observables: Search STIX cyber observables (IOC values)
 * - get-observable: Get observable details and relationships
 * - search-reports: Search threat intelligence reports
 * - get-attack-patterns: List MITRE ATT&CK techniques, filterable by tactic
 * - enrich-observable: [WRITE] Request enrichment for an observable
 * - get-relationships: Get entity relationships
 *
 * NOTE on observables vs indicators: in OpenCTI an *observable*
 * (stixCyberObservable) is a raw IOC value (IPv4-Addr, Domain-Name, StixFile,
 * Url, …) while an *indicator* is a distinct STIX pattern object. These tools
 * query observables; they are named/described accordingly so callers aren't
 * misled into thinking they searched Indicator entities.
 *
 * TLS: the homelab uses a self-signed CA. Point NODE_EXTRA_CA_CERTS at the SOC
 * root-ca.pem so Node trusts it WITHOUT disabling verification globally.
 *
 * Auth: OpenCTI API token in Authorization header.
 * Environment: OPENCTI_URL, OPENCTI_TOKEN, NODE_EXTRA_CA_CERTS
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchWithRetry,
  formatResponse,
  safeId,
  log,
  auditWrite,
  toolGuard,
  startServer,
  readVersion,
  REQUEST_TIMEOUT_MS,
} from "@matchbox/mcp-shared";
import { buildObservableFilters, buildTacticFilter } from "./queries.js";

const OPENCTI_URL = process.env.OPENCTI_URL || "https://soc.homelab.local/opencti";
const OPENCTI_TOKEN = process.env.OPENCTI_TOKEN;

if (!OPENCTI_TOKEN) {
  console.error("FATAL: OPENCTI_TOKEN environment variable is required");
  process.exit(1);
}

const SERVER_NAME = "opencti-mcp";
/** OpenCTI/STIX entity IDs are GraphQL variables (not URL path segments). */
const READ_ONLY = { readOnlyHint: true } as const;

/**
 * Execute a GraphQL operation against OpenCTI with timeout and retry.
 * `retryable` defaults to true for read-only queries; mutations pass false so a
 * transient error doesn't trigger a duplicate enrichment request.
 */
async function graphql(
  query: string,
  variables: Record<string, unknown> = {},
  retryable = true
): Promise<unknown> {
  const resp = await fetchWithRetry(`${OPENCTI_URL}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENCTI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    retryable,
  });

  if (!resp.ok) {
    // Log the body to stderr only; do NOT thread it back to the model.
    const text = (await resp.text()).slice(0, 500);
    log("error", "opencti_http_error", { status: resp.status, body: text });
    throw new Error(`OpenCTI API returned ${resp.status}`);
  }

  const result = (await resp.json()) as { data: unknown; errors?: unknown[] };
  if (result.errors) {
    // GraphQL errors can leak schema internals — log fully, surface generically.
    log("error", "opencti_graphql_error", { errors: result.errors });
    throw new Error("OpenCTI GraphQL query returned errors");
  }
  return result.data;
}

const VERSION = readVersion(new URL("../package.json", import.meta.url), "1.6.0");
const server = new McpServer({ name: SERVER_NAME, version: VERSION });

// ---------------------------------------------------------------------------
// search-observables
// ---------------------------------------------------------------------------
server.tool(
  "search-observables",
  "Search OpenCTI STIX cyber observables (raw IOC values: IPs, domains, hashes, URLs). NOTE: observables are distinct from STIX Indicator pattern objects.",
  {
    value: z.string().max(512).optional().describe("Search by observable value (IP, domain, hash, etc.)"),
    type: z
      .enum([
        "IPv4-Addr",
        "IPv6-Addr",
        "Domain-Name",
        "Hostname",
        "Url",
        "StixFile",
        "Email-Addr",
        "Mac-Addr",
        "Autonomous-System",
      ])
      .optional()
      .describe("Filter by observable entity_type"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, "search-observables", async ({ value, type, limit }) => {
    const result = await graphql(
      `query SearchObservables($search: String, $first: Int, $filters: FilterGroup) {
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
        filters: buildObservableFilters(type),
      }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// get-observable
// ---------------------------------------------------------------------------
server.tool(
  "get-observable",
  "Get full details of an OpenCTI observable including its relationships and any indicators based on it",
  { observable_id: safeId.describe("OpenCTI observable entity ID") },
  READ_ONLY,
  toolGuard(SERVER_NAME, "get-observable", async ({ observable_id }) => {
    const result = await graphql(
      `query GetObservable($id: String!) {
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
      { id: observable_id }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// search-reports
// ---------------------------------------------------------------------------
server.tool(
  "search-reports",
  "Search OpenCTI threat intelligence reports",
  {
    search: z.string().max(256).optional().describe("Search text in report names/descriptions"),
    limit: z.number().min(1).max(100).optional().default(10),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, "search-reports", async ({ search, limit }) => {
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
  })
);

// ---------------------------------------------------------------------------
// get-attack-patterns  — real tactic filter via killChainPhases FilterGroup
// ---------------------------------------------------------------------------
server.tool(
  "get-attack-patterns",
  "List MITRE ATT&CK techniques, optionally filtered by tactic (kill-chain phase)",
  {
    search: z.string().max(256).optional().describe("Free-text search (e.g., 'phishing')"),
    tactic: z
      .string()
      .max(256)
      .optional()
      .describe("Filter by kill chain phase name (e.g., 'initial-access', 'lateral-movement')"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, "get-attack-patterns", async ({ search, tactic, limit }) => {
    // tactic is a real FilterGroup on killChainPhases.phase_name — NOT folded
    // into the free-text search. search and tactic are independent arguments.
    const filters = buildTacticFilter(tactic);

    const result = await graphql(
      `query GetAttackPatterns($search: String, $first: Int, $filters: FilterGroup) {
        attackPatterns(search: $search, first: $first, filters: $filters, orderBy: name, orderMode: asc) {
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
      { search: search || null, first: limit, filters }
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// enrich-observable  — [WRITE]
// ---------------------------------------------------------------------------
server.tool(
  "enrich-observable",
  "[WRITE] Request enrichment for an observable in OpenCTI. This triggers external connector queries.",
  {
    observable_id: safeId.describe("Observable entity ID to enrich"),
    connector_id: safeId.optional().describe("Specific connector ID to use"),
  },
  { readOnlyHint: false, destructiveHint: false },
  toolGuard(SERVER_NAME, "enrich-observable", async ({ observable_id, connector_id }) => {
    auditWrite("enrich-observable", { observable_id, connector_id });
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
      { id: observable_id, connectorId: connector_id || null },
      false // mutation — do NOT auto-retry
    );
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// get-relationships
// ---------------------------------------------------------------------------
server.tool(
  "get-relationships",
  "Get relationships for an OpenCTI entity",
  {
    entity_id: safeId.describe("Entity ID to get relationships for"),
    relationship_type: z.string().max(100).optional().describe("Filter by type (e.g., 'uses', 'targets', 'indicates')"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, "get-relationships", async ({ entity_id, relationship_type, limit }) => {
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
  })
);

// --- Start Server ---
async function main() {
  await startServer(server, SERVER_NAME, async () => {
    const resp = await fetchWithRetry(
      `${OPENCTI_URL}/health`,
      { headers: { Authorization: `Bearer ${OPENCTI_TOKEN}` } },
      REQUEST_TIMEOUT_MS
    );
    if (!resp.ok) throw new Error(`health status ${resp.status}`);
  });
}

main().catch((err) => {
  log("error", "fatal", { server: SERVER_NAME, detail: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
