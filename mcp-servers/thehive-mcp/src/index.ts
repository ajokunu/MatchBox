#!/usr/bin/env node
/**
 * TheHive MCP Server
 *
 * Provides Claude Code with tools to manage TheHive incident response:
 * - list-cases: List open/recent cases
 * - create-case: Create a new incident case
 * - get-case: Get case details with observables
 * - add-observable: Add an IOC to a case
 * - run-analyzer: Run Cortex analyzer on an observable
 * - get-analyzer-report: Get analyzer results
 * - search-alerts: Search alerts forwarded from Wazuh
 * - merge-alerts: Merge related alerts into a case
 *
 * Auth: TheHive API key in Authorization header.
 * Environment: THEHIVE_URL, THEHIVE_API_KEY
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const THEHIVE_URL = process.env.THEHIVE_URL || "https://localhost:9000";
const THEHIVE_API_KEY = process.env.THEHIVE_API_KEY;

if (!THEHIVE_API_KEY) {
  console.error("FATAL: THEHIVE_API_KEY environment variable is required");
  process.exit(1);
}

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || "10000", 10);
/** Validate ID parameters to prevent path traversal (+ requires at least 1 char) */
const safeId = z.string().regex(/^[~a-zA-Z0-9_.-]+$/, "Invalid ID format");

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

/** Make authenticated API call to TheHive with timeout and retry */
async function thehiveApi(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = new URL(path, THEHIVE_URL);
  const resp = await fetchWithRetry(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${THEHIVE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 200);
    throw new Error(`TheHive API error: ${resp.status} ${text}`);
  }
  return resp.json();
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
  name: "thehive-mcp",
  version: "1.0.0",
});

// list-cases
server.tool(
  "list-cases",
  "List TheHive incident response cases",
  {
    status: z.enum(["Open", "Resolved", "Deleted"]).optional().default("Open"),
    severity: z.number().min(1).max(4).optional().describe("1=Low, 2=Medium, 3=High, 4=Critical"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ status, severity, limit }) => {
    const query: Record<string, unknown>[] = [];
    if (status) query.push({ _name: "filter", _field: "status", _value: status });
    if (severity) query.push({ _name: "filter", _field: "severity", _value: severity });
    query.push({ _name: "sort", _fields: [{ _field: "createdAt", _order: "desc" }] });
    query.push({ _name: "page", from: 0, to: limit });

    const result = await thehiveApi("POST", "/api/v1/query", { query });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// create-case
server.tool(
  "create-case",
  "[WRITE] Create a new TheHive incident case. This creates a persistent record.",
  {
    title: z.string().max(500).describe("Case title"),
    description: z.string().max(10000).describe("Case description (markdown supported)"),
    severity: z.number().min(1).max(4).default(2).describe("1=Low, 2=Medium, 3=High, 4=Critical"),
    tags: z.array(z.string()).optional().default([]),
  },
  async ({ title, description, severity, tags }) => {
    const result = await thehiveApi("POST", "/api/v1/case", {
      title,
      description,
      severity,
      tags,
      flag: false,
      tlp: 2,  // TLP:AMBER
      pap: 2,  // PAP:AMBER
    });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-case
server.tool(
  "get-case",
  "Get TheHive case details including observables and tasks",
  { case_id: safeId.describe("Case ID (e.g., '~123')") },
  async ({ case_id }) => {
    const caseData = await thehiveApi("GET", `/api/v1/case/${encodeURIComponent(case_id)}`);
    // Also fetch observables for this case
    const observables = await thehiveApi("POST", "/api/v1/query", {
      query: [
        { _name: "getCase", idOrName: case_id },
        { _name: "observables" },
        { _name: "sort", _fields: [{ _field: "createdAt", _order: "desc" }] },
      ],
    });
    return {
      content: [{
        type: "text" as const,
        text: formatResponse({ case: caseData, observables }),
      }],
    };
  }
);

// add-observable
server.tool(
  "add-observable",
  "[WRITE] Add an observable (IOC) to a TheHive case. This modifies case data.",
  {
    case_id: safeId.describe("Case ID"),
    data_type: z.enum(["ip", "domain", "url", "hash", "filename", "mail", "other"]),
    data: z.string().max(2048).describe("Observable value (e.g., IP address, domain name)"),
    tags: z.array(z.string().max(100)).max(20).optional().default([]),
    message: z.string().max(2048).optional().describe("Context about this observable"),
  },
  async ({ case_id, data_type, data, tags, message }) => {
    const result = await thehiveApi("POST", `/api/v1/case/${encodeURIComponent(case_id)}/observable`, {
      dataType: data_type,
      data,
      tags,
      message: message || "",
      tlp: 2,
      pap: 2,
      ioc: true,
    });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// run-analyzer
server.tool(
  "run-analyzer",
  "[WRITE] Run a Cortex analyzer on a TheHive observable. This triggers external analysis.",
  {
    observable_id: safeId.describe("Observable ID"),
    analyzer_id: safeId.describe("Cortex analyzer ID (e.g., 'VirusTotal_GetReport_3_1')"),
  },
  async ({ observable_id, analyzer_id }) => {
    const result = await thehiveApi("POST", "/api/v1/connector/cortex/job", {
      observableId: observable_id,
      analyzerId: analyzer_id,
    });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-analyzer-report
server.tool(
  "get-analyzer-report",
  "Get the results of a Cortex analyzer job",
  { job_id: safeId.describe("Cortex job ID") },
  async ({ job_id }) => {
    const result = await thehiveApi("GET", `/api/v1/connector/cortex/job/${encodeURIComponent(job_id)}`);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// search-alerts
server.tool(
  "search-alerts",
  "Search TheHive alerts (e.g., from Wazuh integration)",
  {
    source: z.string().max(256).optional().describe("Alert source filter (e.g., 'Wazuh')"),
    severity: z.number().min(1).max(4).optional(),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ source, severity, limit }) => {
    const query: Record<string, unknown>[] = [];
    if (source) query.push({ _name: "filter", _field: "source", _value: source });
    if (severity) query.push({ _name: "filter", _field: "severity", _value: severity });
    query.push({ _name: "sort", _fields: [{ _field: "createdAt", _order: "desc" }] });
    query.push({ _name: "page", from: 0, to: limit });

    const result = await thehiveApi("POST", "/api/v1/query", { query });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// merge-alerts
server.tool(
  "merge-alerts",
  "[WRITE] Merge related TheHive alerts into a single case. This permanently combines alerts.",
  {
    alert_ids: z.array(safeId).describe("Alert IDs to merge"),
    case_id: safeId.optional().describe("Existing case ID to merge into (creates new if omitted)"),
  },
  async ({ alert_ids, case_id }) => {
    const result = await thehiveApi("POST", "/api/v1/alert/merge", {
      alertIds: alert_ids,
      caseId: case_id,
    });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// --- Start Server ---
async function main() {
  // Connectivity test
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const resp = await fetch(`${THEHIVE_URL}/api/v1/status`, {
      headers: { Authorization: `Bearer ${THEHIVE_API_KEY}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    console.error(`TheHive connectivity: ${resp.ok ? "OK" : resp.status} (${THEHIVE_URL})`);
  } catch (e) {
    console.error(`WARNING: TheHive unreachable at ${THEHIVE_URL} — tools will fail until it's available`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TheHive MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
