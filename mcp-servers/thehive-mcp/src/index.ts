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

const THEHIVE_URL = process.env.THEHIVE_URL || "http://localhost:9000";
const THEHIVE_API_KEY = process.env.THEHIVE_API_KEY || "";
const REQUEST_TIMEOUT_MS = 10_000;

/** Make authenticated API call to TheHive with timeout */
async function thehiveApi(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(`${THEHIVE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${THEHIVE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`TheHive API error: ${resp.status} ${text}`);
    }
    return resp.json();
  } finally {
    clearTimeout(timer);
  }
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
    limit: z.number().optional().default(20),
  },
  async ({ status, severity, limit }) => {
    const query: Record<string, unknown>[] = [];
    if (status) query.push({ _name: "filter", _field: "status", _value: status });
    if (severity) query.push({ _name: "filter", _field: "severity", _value: severity });
    query.push({ _name: "sort", _fields: [{ _field: "createdAt", _order: "desc" }] });
    query.push({ _name: "page", from: 0, to: limit });

    const result = await thehiveApi("POST", "/api/v1/query", { query });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// create-case
server.tool(
  "create-case",
  "Create a new TheHive incident case",
  {
    title: z.string().describe("Case title"),
    description: z.string().describe("Case description (markdown supported)"),
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
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// get-case
server.tool(
  "get-case",
  "Get TheHive case details including observables and tasks",
  { case_id: z.string().describe("Case ID (e.g., '~123')") },
  async ({ case_id }) => {
    const caseData = await thehiveApi("GET", `/api/v1/case/${case_id}`);
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
        text: JSON.stringify({ case: caseData, observables }, null, 2),
      }],
    };
  }
);

// add-observable
server.tool(
  "add-observable",
  "Add an observable (IOC) to a TheHive case",
  {
    case_id: z.string().describe("Case ID"),
    data_type: z.enum(["ip", "domain", "url", "hash", "filename", "mail", "other"]),
    data: z.string().describe("Observable value (e.g., IP address, domain name)"),
    tags: z.array(z.string()).optional().default([]),
    message: z.string().optional().describe("Context about this observable"),
  },
  async ({ case_id, data_type, data, tags, message }) => {
    const result = await thehiveApi("POST", `/api/v1/case/${case_id}/observable`, {
      dataType: data_type,
      data,
      tags,
      message: message || "",
      tlp: 2,
      pap: 2,
      ioc: true,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// run-analyzer
server.tool(
  "run-analyzer",
  "Run a Cortex analyzer on a TheHive observable",
  {
    observable_id: z.string().describe("Observable ID"),
    analyzer_id: z.string().describe("Cortex analyzer ID (e.g., 'VirusTotal_GetReport_3_1')"),
  },
  async ({ observable_id, analyzer_id }) => {
    const result = await thehiveApi("POST", "/api/v1/connector/cortex/job", {
      observableId: observable_id,
      analyzerId: analyzer_id,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// get-analyzer-report
server.tool(
  "get-analyzer-report",
  "Get the results of a Cortex analyzer job",
  { job_id: z.string().describe("Cortex job ID") },
  async ({ job_id }) => {
    const result = await thehiveApi("GET", `/api/v1/connector/cortex/job/${job_id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// search-alerts
server.tool(
  "search-alerts",
  "Search TheHive alerts (e.g., from Wazuh integration)",
  {
    source: z.string().optional().describe("Alert source filter (e.g., 'Wazuh')"),
    severity: z.number().min(1).max(4).optional(),
    limit: z.number().optional().default(20),
  },
  async ({ source, severity, limit }) => {
    const query: Record<string, unknown>[] = [];
    if (source) query.push({ _name: "filter", _field: "source", _value: source });
    if (severity) query.push({ _name: "filter", _field: "severity", _value: severity });
    query.push({ _name: "sort", _fields: [{ _field: "createdAt", _order: "desc" }] });
    query.push({ _name: "page", from: 0, to: limit });

    const result = await thehiveApi("POST", "/api/v1/query", { query });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// merge-alerts
server.tool(
  "merge-alerts",
  "Merge related TheHive alerts into a single case",
  {
    alert_ids: z.array(z.string()).describe("Alert IDs to merge"),
    case_id: z.string().optional().describe("Existing case ID to merge into (creates new if omitted)"),
  },
  async ({ alert_ids, case_id }) => {
    const result = await thehiveApi("POST", "/api/v1/alert/merge", {
      alertIds: alert_ids,
      caseId: case_id,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
