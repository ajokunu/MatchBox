#!/usr/bin/env node
/**
 * TheHive MCP Server
 *
 * Provides Claude Code with tools to manage TheHive incident response:
 * - list-cases: List open/recent cases
 * - create-case: [WRITE] Create a new incident case
 * - get-case: Get case details with observables
 * - add-observable: [WRITE] Add an IOC to a case
 * - run-analyzer: [WRITE] Run Cortex analyzer on an observable
 * - get-analyzer-report: Get analyzer results
 * - search-alerts: Search alerts forwarded from Wazuh
 * - merge-alerts: [WRITE] Merge related alerts into a case
 *
 * TLS: the homelab uses a self-signed CA. Point NODE_EXTRA_CA_CERTS at the SOC
 * root-ca.pem so Node trusts it WITHOUT disabling verification globally.
 *
 * Auth: TheHive API key in Authorization header.
 * Environment: THEHIVE_URL, THEHIVE_API_KEY, NODE_EXTRA_CA_CERTS
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
import { ALERT_MERGE_BULK_PATH, alertToCasePath, buildMergeBulkBody, joinUrl } from "./queries.js";

const THEHIVE_URL = process.env.THEHIVE_URL || "https://soc.homelab.local/thehive";
const THEHIVE_API_KEY = process.env.THEHIVE_API_KEY;

if (!THEHIVE_API_KEY) {
  console.error("FATAL: THEHIVE_API_KEY environment variable is required");
  process.exit(1);
}

const SERVER_NAME = "thehive-mcp";
const READ_ONLY = { readOnlyHint: true } as const;

/** Join THEHIVE_URL with an API path, preserving any ingress sub-path prefix. */
const apiUrl = (path: string): string => joinUrl(THEHIVE_URL, path);

/** Default TLP/PAP (2 = AMBER); overridable per-call. */
const TLP = { Clear: 0, Green: 1, Amber: 2, Red: 3 } as const;
const tlpEnum = z.enum(["Clear", "Green", "Amber", "Red"]);

/**
 * Make an authenticated API call to TheHive with timeout and retry.
 * GET is auto-retried (idempotent); mutating verbs (POST/PATCH/DELETE) are NOT
 * auto-retried to avoid duplicate cases/observables on a flaky link.
 */
async function thehiveApi(method: string, path: string, body?: unknown): Promise<unknown> {
  const resp = await fetchWithRetry(apiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${THEHIVE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    // fetchWithRetry only auto-retries idempotent methods unless told otherwise.
  });

  if (!resp.ok) {
    // Log the upstream body to stderr only; surface a generic status to the model.
    const text = (await resp.text()).slice(0, 500);
    log("error", "thehive_http_error", { method, path, status: resp.status, body: text });
    throw new Error(`TheHive API ${method} ${path} returned ${resp.status}`);
  }
  return resp.json();
}

const VERSION = readVersion(new URL("../package.json", import.meta.url), "1.6.0");
const server = new McpServer({ name: SERVER_NAME, version: VERSION });

// ---------------------------------------------------------------------------
// list-cases
// ---------------------------------------------------------------------------
server.tool(
  "list-cases",
  "List TheHive incident response cases",
  {
    status: z.enum(["Open", "Resolved", "Deleted"]).optional().default("Open"),
    severity: z.number().min(1).max(4).optional().describe("1=Low, 2=Medium, 3=High, 4=Critical"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, "list-cases", async ({ status, severity, limit }) => {
    const query: Record<string, unknown>[] = [{ _name: "listCase" }];
    if (status) query.push({ _name: "filter", _field: "status", _value: status });
    if (severity) query.push({ _name: "filter", _field: "severity", _value: severity });
    query.push({ _name: "sort", _fields: [{ _field: "createdAt", _order: "desc" }] });
    query.push({ _name: "page", from: 0, to: limit });

    const result = await thehiveApi("POST", "/api/v1/query", { query });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// create-case  — [WRITE]
// ---------------------------------------------------------------------------
server.tool(
  "create-case",
  "[WRITE] Create a new TheHive incident case. This creates a persistent record.",
  {
    title: z.string().max(500).describe("Case title"),
    description: z.string().max(10000).describe("Case description (markdown supported)"),
    severity: z.number().min(1).max(4).default(2).describe("1=Low, 2=Medium, 3=High, 4=Critical"),
    tags: z.array(z.string().max(100)).max(50).optional().default([]),
    tlp: tlpEnum.optional().default("Amber").describe("Traffic Light Protocol"),
    pap: tlpEnum.optional().default("Amber").describe("Permissible Actions Protocol"),
  },
  { readOnlyHint: false, destructiveHint: false },
  toolGuard(SERVER_NAME, "create-case", async ({ title, description, severity, tags, tlp, pap }) => {
    auditWrite("create-case", { title, severity, tags, tlp, pap });
    const result = await thehiveApi("POST", "/api/v1/case", {
      title,
      description,
      severity,
      tags,
      flag: false,
      tlp: TLP[tlp],
      pap: TLP[pap],
    });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// get-case
// ---------------------------------------------------------------------------
server.tool(
  "get-case",
  "Get TheHive case details including observables and tasks",
  { case_id: safeId.describe("Case ID (e.g., '~123')") },
  READ_ONLY,
  toolGuard(SERVER_NAME, "get-case", async ({ case_id }) => {
    // case_id is validated by safeId to a URL-safe charset — no encoding needed.
    const caseData = await thehiveApi("GET", `/api/v1/case/${case_id}`);
    const observables = await thehiveApi("POST", "/api/v1/query", {
      query: [
        { _name: "getCase", idOrName: case_id },
        { _name: "observables" },
        { _name: "sort", _fields: [{ _field: "createdAt", _order: "desc" }] },
      ],
    });
    return {
      content: [{ type: "text" as const, text: formatResponse({ case: caseData, observables }) }],
    };
  })
);

// ---------------------------------------------------------------------------
// add-observable  — [WRITE]
// ---------------------------------------------------------------------------
server.tool(
  "add-observable",
  "[WRITE] Add an observable (IOC) to a TheHive case. This modifies case data.",
  {
    case_id: safeId.describe("Case ID"),
    data_type: z.enum(["ip", "domain", "url", "hash", "filename", "mail", "other"]),
    data: z.string().max(2048).describe("Observable value (e.g., IP address, domain name)"),
    tags: z.array(z.string().max(100)).max(20).optional().default([]),
    message: z.string().max(2048).optional().describe("Context about this observable"),
    ioc: z.boolean().optional().default(true).describe("Mark as an indicator of compromise"),
    tlp: tlpEnum.optional().default("Amber"),
    pap: tlpEnum.optional().default("Amber"),
  },
  { readOnlyHint: false, destructiveHint: false },
  toolGuard(SERVER_NAME, "add-observable", async ({ case_id, data_type, data, tags, message, ioc, tlp, pap }) => {
    auditWrite("add-observable", { case_id, data_type, tags, ioc, tlp, pap });
    const result = await thehiveApi("POST", `/api/v1/case/${case_id}/observable`, {
      dataType: data_type,
      data,
      tags,
      message: message || "",
      tlp: TLP[tlp],
      pap: TLP[pap],
      ioc,
    });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// run-analyzer  — [WRITE]
// ---------------------------------------------------------------------------
server.tool(
  "run-analyzer",
  "[WRITE] Run a Cortex analyzer on a TheHive observable. This triggers external analysis.",
  {
    observable_id: safeId.describe("Observable ID"),
    analyzer_id: safeId.describe("Cortex analyzer ID (e.g., 'VirusTotal_GetReport_3_1')"),
  },
  { readOnlyHint: false, destructiveHint: false },
  toolGuard(SERVER_NAME, "run-analyzer", async ({ observable_id, analyzer_id }) => {
    auditWrite("run-analyzer", { observable_id, analyzer_id });
    const result = await thehiveApi("POST", "/api/v1/connector/cortex/job", {
      observableId: observable_id,
      analyzerId: analyzer_id,
    });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// get-analyzer-report
// ---------------------------------------------------------------------------
server.tool(
  "get-analyzer-report",
  "Get the results of a Cortex analyzer job",
  { job_id: safeId.describe("Cortex job ID") },
  READ_ONLY,
  toolGuard(SERVER_NAME, "get-analyzer-report", async ({ job_id }) => {
    const result = await thehiveApi("GET", `/api/v1/connector/cortex/job/${job_id}`);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// search-alerts
// ---------------------------------------------------------------------------
server.tool(
  "search-alerts",
  "Search TheHive alerts (e.g., from Wazuh integration)",
  {
    source: z.string().max(256).optional().describe("Alert source filter (e.g., 'Wazuh')"),
    severity: z.number().min(1).max(4).optional(),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, "search-alerts", async ({ source, severity, limit }) => {
    const query: Record<string, unknown>[] = [{ _name: "listAlert" }];
    if (source) query.push({ _name: "filter", _field: "source", _value: source });
    if (severity) query.push({ _name: "filter", _field: "severity", _value: severity });
    query.push({ _name: "sort", _fields: [{ _field: "createdAt", _order: "desc" }] });
    query.push({ _name: "page", from: 0, to: limit });

    const result = await thehiveApi("POST", "/api/v1/query", { query });
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  })
);

// ---------------------------------------------------------------------------
// merge-alerts  — [WRITE]
// TheHive 5 bulk merge: POST /api/v1/alert/merge/_bulk { caseId, alertIds }.
// There is no /api/v1/alert/merge route. The _bulk endpoint REQUIRES a target
// caseId, so when case_id is omitted we first promote the first alert to a new
// case (POST /api/v1/alert/{alertId}/case) and merge the rest into it.
// ---------------------------------------------------------------------------
server.tool(
  "merge-alerts",
  "[WRITE] Merge related TheHive alerts into a single case. If no case_id is given, a new case is created from the first alert and the rest are merged into it. This permanently combines alerts.",
  {
    alert_ids: z.array(safeId).min(1).describe("Alert IDs to merge"),
    case_id: safeId.optional().describe("Existing case ID to merge into (new case created from the first alert if omitted)"),
  },
  { readOnlyHint: false, destructiveHint: true },
  toolGuard(SERVER_NAME, "merge-alerts", async ({ alert_ids, case_id }) => {
    auditWrite("merge-alerts", { alert_ids, case_id });

    let targetCaseId = case_id;
    let promotedCase: unknown = undefined;
    let toMerge = alert_ids;

    if (!targetCaseId) {
      // Promote the first alert into a fresh case, then merge the remainder.
      const [first, ...rest] = alert_ids;
      promotedCase = await thehiveApi("POST", alertToCasePath(first), {});
      targetCaseId = (promotedCase as { _id?: string; id?: string })._id ??
        (promotedCase as { _id?: string; id?: string }).id;
      toMerge = rest;
      if (!targetCaseId) throw new Error("alert-to-case promotion did not return a case id");
    }

    let merge: unknown = undefined;
    if (toMerge.length > 0) {
      merge = await thehiveApi("POST", ALERT_MERGE_BULK_PATH, buildMergeBulkBody(targetCaseId, toMerge));
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatResponse({ caseId: targetCaseId, promotedCase, merge }),
        },
      ],
    };
  })
);

// --- Start Server ---
async function main() {
  await startServer(server, SERVER_NAME, async () => {
    const resp = await fetchWithRetry(
      apiUrl("/api/v1/status"),
      { headers: { Authorization: `Bearer ${THEHIVE_API_KEY}` } },
      REQUEST_TIMEOUT_MS
    );
    if (!resp.ok) throw new Error(`status ${resp.status}`);
  });
}

main().catch((err) => {
  log("error", "fatal", { server: SERVER_NAME, detail: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
