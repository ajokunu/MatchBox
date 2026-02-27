#!/usr/bin/env node
/**
 * Wazuh MCP Server
 *
 * Provides Claude Code with tools to query the Wazuh SIEM/XDR platform:
 * - list-alerts: List recent alerts with filtering
 * - get-alert: Get full alert details
 * - search-agents: Search registered Wazuh agents
 * - get-agent-info: Get agent details and status
 * - get-vulnerabilities: List detected CVEs per agent
 * - get-rules: Search active detection rules
 * - get-decoders: Search active log decoders
 *
 * Auth: Wazuh REST API uses user/password -> JWT token flow.
 * Environment: WAZUH_API_URL, WAZUH_API_USER, WAZUH_API_PASSWORD
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const WAZUH_URL = process.env.WAZUH_API_URL || "https://localhost:55000";
const WAZUH_USER = process.env.WAZUH_API_USER;
const WAZUH_PASS = process.env.WAZUH_API_PASSWORD;

if (!WAZUH_USER || !WAZUH_PASS) {
  console.error("FATAL: WAZUH_API_USER and WAZUH_API_PASSWORD environment variables are required");
  process.exit(1);
}

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || "10000", 10);
const TOKEN_TTL_MS = parseInt(process.env.TOKEN_TTL_MS || "850000", 10);
/** Validate ID parameters to prevent path traversal (+ requires at least 1 char) */
const safeId = z.string().regex(/^[a-zA-Z0-9_.~-]+$/, "Invalid ID format");
let jwtToken: string | null = null;
let tokenExpiry = 0;

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

/** Authenticate and get JWT token */
async function getToken(): Promise<string> {
  if (jwtToken && Date.now() < tokenExpiry) return jwtToken;

  const credentials = Buffer.from(`${WAZUH_USER}:${WAZUH_PASS}`).toString("base64");
  const resp = await fetchWithRetry(`${WAZUH_URL}/security/user/authenticate`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!resp.ok) throw new Error(`Auth failed: ${resp.status} ${resp.statusText}`);
  const data = await resp.json() as { data: { token: string } };
  jwtToken = data.data.token;
  tokenExpiry = Date.now() + TOKEN_TTL_MS;
  return jwtToken;
}

/** Make authenticated API call with timeout and retry */
async function wazuhApi(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const token = await getToken();
  const url = new URL(path, WAZUH_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const resp = await fetchWithRetry(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) throw new Error(`Wazuh API error: ${resp.status} ${resp.statusText}`);
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

// --- MCP Server Setup ---
const server = new McpServer({
  name: "wazuh-mcp",
  version: "1.0.0",
});

// list-alerts
server.tool(
  "list-alerts",
  "List recent Wazuh SIEM alerts with optional filtering",
  {
    limit: z.number().min(1).max(100).optional().default(20).describe("Max alerts to return"),
    level_min: z.number().min(1).max(15).optional().describe("Minimum alert level (1-15)"),
    agent_id: z.string().regex(/^[a-zA-Z0-9_.~-]*$/).optional().describe("Filter by agent ID"),
    rule_id: z.string().regex(/^[a-zA-Z0-9_.~-]*$/).optional().describe("Filter by rule ID"),
  },
  async ({ limit, level_min, agent_id, rule_id }) => {
    const params: Record<string, string> = {
      limit: String(limit),
      sort: "-timestamp",
    };
    if (level_min) params["search"] = `rule.level>=${level_min}`;
    if (agent_id) params["agent.id"] = agent_id;
    if (rule_id) params["rule.id"] = rule_id;

    const result = await wazuhApi("/alerts", params);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-alert
server.tool(
  "get-alert",
  "Get full details of a specific Wazuh alert",
  { alert_id: safeId.describe("Alert ID to retrieve") },
  async ({ alert_id }) => {
    const result = await wazuhApi(`/alerts/${encodeURIComponent(alert_id)}`);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// search-agents
server.tool(
  "search-agents",
  "Search registered Wazuh agents by name, IP, status, or OS",
  {
    name: z.string().max(256).optional().describe("Agent name filter"),
    ip: z.string().max(45).optional().describe("Agent IP filter"),
    status: z.enum(["active", "disconnected", "pending", "never_connected"]).optional(),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ name, ip, status, limit }) => {
    const params: Record<string, string> = { limit: String(limit) };
    if (name) params["name"] = name;
    if (ip) params["ip"] = ip;
    if (status) params["status"] = status;

    const result = await wazuhApi("/agents", params);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-agent-info
server.tool(
  "get-agent-info",
  "Get detailed info about a specific Wazuh agent",
  { agent_id: safeId.describe("Agent ID") },
  async ({ agent_id }) => {
    const result = await wazuhApi(`/agents/${encodeURIComponent(agent_id)}`);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-vulnerabilities
server.tool(
  "get-vulnerabilities",
  "List vulnerabilities detected on an agent",
  {
    agent_id: safeId.describe("Agent ID"),
    severity: z.enum(["Critical", "High", "Medium", "Low"]).optional(),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ agent_id, severity, limit }) => {
    const params: Record<string, string> = { limit: String(limit) };
    if (severity) params["severity"] = severity;

    const result = await wazuhApi(`/vulnerability/${encodeURIComponent(agent_id)}`, params);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-rules
server.tool(
  "get-rules",
  "Search active Wazuh detection rules",
  {
    search: z.string().max(256).optional().describe("Search text in rule descriptions"),
    level: z.number().min(1).max(15).optional().describe("Filter by exact rule level"),
    group: z.string().max(256).optional().describe("Filter by rule group"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ search, level, group, limit }) => {
    const params: Record<string, string> = { limit: String(limit) };
    if (search) params["search"] = search;
    if (level) params["level"] = String(level);
    if (group) params["group"] = group;

    const result = await wazuhApi("/rules", params);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// get-decoders
server.tool(
  "get-decoders",
  "Search active Wazuh log decoders",
  {
    search: z.string().max(256).optional().describe("Search text in decoder names"),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  async ({ search, limit }) => {
    const params: Record<string, string> = { limit: String(limit) };
    if (search) params["search"] = search;

    const result = await wazuhApi("/decoders", params);
    return { content: [{ type: "text" as const, text: formatResponse(result) }] };
  }
);

// --- Start Server ---
async function main() {
  // Connectivity test — warn if Wazuh API is unreachable
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const resp = await fetch(`${WAZUH_URL}/`, { signal: controller.signal }).finally(() => clearTimeout(timer));
    console.error(`Wazuh API connectivity: ${resp.ok ? "OK" : resp.status} (${WAZUH_URL})`);
  } catch (e) {
    console.error(`WARNING: Wazuh API unreachable at ${WAZUH_URL} — tools will fail until it's available`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Wazuh MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
