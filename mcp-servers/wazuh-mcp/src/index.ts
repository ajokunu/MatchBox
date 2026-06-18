#!/usr/bin/env node
/**
 * Wazuh MCP Server
 *
 * Provides Claude Code with tools to query the Wazuh SIEM/XDR platform:
 * - list-alerts: List recent alerts with filtering         (Indexer / _search)
 * - get-alert: Get full alert details                      (Indexer / _search)
 * - search-agents: Search registered Wazuh agents          (Server API)
 * - get-agent-info: Get agent details and status           (Server API)
 * - get-vulnerabilities: List detected CVEs per agent       (Indexer / _search)
 * - get-rules: Search active detection rules               (Server API)
 * - get-decoders: Search active log decoders               (Server API)
 *
 * Two distinct backends (per Contract §3):
 *  - Server API (WAZUH_API_URL, :55000): user/password -> JWT. Owns
 *    /agents, /agents/{id}, /rules, /decoders. It has NO /alerts or
 *    /vulnerability endpoints.
 *  - Indexer / OpenSearch (WAZUH_INDEXER_URL, :9200): Basic auth. Owns the
 *    wazuh-alerts-* and wazuh-states-vulnerabilities-* indices, queried via
 *    POST .../_search. Alerts and vulnerabilities live ONLY here.
 *
 * TLS: the homelab uses a self-signed CA. Point NODE_EXTRA_CA_CERTS at the SOC
 * root-ca.pem so Node trusts it WITHOUT disabling verification globally. Never
 * set NODE_TLS_REJECT_UNAUTHORIZED=0 (would MITM-expose the admin credential).
 *
 * Environment:
 *   WAZUH_API_URL, WAZUH_API_USER, WAZUH_API_PASSWORD           (Server API)
 *   WAZUH_INDEXER_URL, WAZUH_INDEXER_USER, WAZUH_INDEXER_PASSWORD (Indexer)
 *   NODE_EXTRA_CA_CERTS  (path to SOC root-ca.pem — required for self-signed TLS)
 *   Optional: REQUEST_TIMEOUT_MS, MAX_RESPONSE_CHARS, TOKEN_TTL_MS
 */

import {
  REQUEST_TIMEOUT_MS,
  basicAuth,
  fetchWithRetry,
  formatResponse,
  indexerSearch,
  log,
  readVersion,
  safeId,
  startServer,
  toolGuard,
} from '@matchbox/mcp-shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  WAZUH_QUERY_OPERATORS,
  buildGetAlertBody,
  buildListAlertsBody,
  buildVulnBody,
} from './queries.js';

// --- Server API config (agents / rules / decoders) ---
const WAZUH_URL = process.env.WAZUH_API_URL || 'https://soc.homelab.local:55000';
const WAZUH_USER = process.env.WAZUH_API_USER;
const WAZUH_PASS = process.env.WAZUH_API_PASSWORD;

// --- Indexer config (alerts / vulnerabilities) ---
const INDEXER_URL = process.env.WAZUH_INDEXER_URL || 'https://localhost:9200';
const INDEXER_USER = process.env.WAZUH_INDEXER_USER || 'admin';
const INDEXER_PASS = process.env.WAZUH_INDEXER_PASSWORD;

if (!WAZUH_USER || !WAZUH_PASS) {
  console.error('FATAL: WAZUH_API_USER and WAZUH_API_PASSWORD environment variables are required');
  process.exit(1);
}
if (!INDEXER_PASS) {
  // Alerts/vulnerabilities tools cannot work without indexer creds; fail closed.
  console.error(
    'FATAL: WAZUH_INDEXER_PASSWORD environment variable is required (used by list-alerts/get-alert/get-vulnerabilities)',
  );
  process.exit(1);
}

const INDEXER_AUTH = basicAuth(INDEXER_USER, INDEXER_PASS);
const ALERTS_INDEX = process.env.WAZUH_ALERTS_INDEX || 'wazuh-alerts-*';
const VULN_INDEX = process.env.WAZUH_VULN_INDEX || 'wazuh-states-vulnerabilities-*';

const TOKEN_TTL_MS = Number.parseInt(process.env.TOKEN_TTL_MS || '850000', 10);
let jwtToken: string | null = null;
let tokenExpiry = 0;

/** Decode a JWT's exp claim (seconds since epoch) without verifying the signature. */
function jwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Authenticate against the Server API and cache the JWT (expiry from the token itself). */
async function getToken(force = false): Promise<string> {
  if (!force && jwtToken && Date.now() < tokenExpiry) return jwtToken;

  // The auth endpoint is a POST; mark retryable since re-authenticating is safe.
  const resp = await fetchWithRetry(`${WAZUH_URL}/security/user/authenticate`, {
    method: 'POST',
    headers: { Authorization: basicAuth(WAZUH_USER!, WAZUH_PASS!) },
    retryable: true,
  });

  if (!resp.ok) throw new Error(`Wazuh auth failed: ${resp.status}`);
  const data = (await resp.json()) as { data: { token: string } };
  jwtToken = data.data.token;
  // Prefer the token's real exp claim; fall back to a conservative TTL with margin.
  const claimExpiry = jwtExpiryMs(jwtToken);
  tokenExpiry = claimExpiry ? claimExpiry - 30_000 : Date.now() + TOKEN_TTL_MS;
  return jwtToken;
}

/**
 * Authenticated GET against the Server API. On a 401 (e.g. token expired early
 * because an admin lowered the TTL), clears the cache and re-auths once.
 */
async function wazuhApi(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const call = async (): Promise<Response> => {
    const token = await getToken();
    const url = new URL(path, WAZUH_URL);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
    return fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  };

  let resp = await call();
  if (resp.status === 401) {
    jwtToken = null; // invalidate and force re-auth
    await getToken(true);
    resp = await call();
  }
  if (!resp.ok) throw new Error(`Wazuh Server API ${path} returned ${resp.status}`);
  return resp.json();
}

// --- MCP Server Setup ---
const VERSION = readVersion(new URL('../package.json', import.meta.url), '1.6.0');
const SERVER_NAME = 'wazuh-mcp';
const server = new McpServer({ name: SERVER_NAME, version: VERSION });

/** All Wazuh tools are read-only — establish the readOnlyHint pattern up front. */
const READ_ONLY = { readOnlyHint: true } as const;

/**
 * Free-text filter for the Wazuh Server API `search`/`group`/`name` params
 * (finding 6). The previous filter was an over-conservative `[\w .\-/]*`
 * allowlist that rejected legitimate searches (colons, commas, brackets in
 * rule descriptions). Instead of an arbitrary character whitelist we model the
 * threat directly: Wazuh's `q`/`search` query grammar is driven by a small set
 * of structural operators — `;` `,` `(` `)` `=` `<` `>` `~` `!`. We DENY only
 * those operators (plus control chars and backslash), and PERMIT everything
 * else. That keeps the params injection-safe (an LLM-supplied value can no
 * longer introduce a new clause, comparison, or grouping) while allowing the
 * far wider charset real rule/decoder text uses.
 *
 * Note: `search` is a substring match, not the `q` grammar, but we apply the
 * same denylist to all three free-text params for a single, auditable rule —
 * defense-in-depth on top of the read-only, single-privilege Server API token.
 * The operator denylist itself lives in queries.ts (single source of truth,
 * unit-tested there).
 */
const searchText = z
  .string()
  .max(256)
  .refine((s) => !WAZUH_QUERY_OPERATORS.test(s), {
    message:
      'Search text may not contain Wazuh query operators (; , ( ) = < > ~ !), backslash, or control characters',
  });

// ---------------------------------------------------------------------------
// list-alerts  — Indexer wazuh-alerts-* / _search
// ---------------------------------------------------------------------------
server.tool(
  'list-alerts',
  'List recent Wazuh SIEM alerts with optional filtering (queries the Wazuh indexer)',
  {
    limit: z.number().min(1).max(100).optional().default(20).describe('Max alerts to return'),
    level_min: z.number().min(1).max(15).optional().describe('Minimum rule level (1-15)'),
    agent_id: safeId.optional().describe('Filter by agent ID'),
    rule_id: safeId.optional().describe('Filter by rule ID'),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, 'list-alerts', async ({ limit, level_min, agent_id, rule_id }) => {
    // `!== undefined` (inside the builder) future-proofs against a min(0) relaxation.
    const body = buildListAlertsBody({ limit, level_min, agent_id, rule_id });
    const result = await indexerSearch(INDEXER_URL, ALERTS_INDEX, body, INDEXER_AUTH);
    return { content: [{ type: 'text' as const, text: formatResponse(result) }] };
  }),
);

// ---------------------------------------------------------------------------
// get-alert  — Indexer wazuh-alerts-* / _search by document _id
// ---------------------------------------------------------------------------
server.tool(
  'get-alert',
  'Get full details of a specific Wazuh alert by document ID (queries the Wazuh indexer)',
  { alert_id: safeId.describe('Alert document _id to retrieve') },
  READ_ONLY,
  toolGuard(SERVER_NAME, 'get-alert', async ({ alert_id }) => {
    const body = buildGetAlertBody(alert_id);
    const result = await indexerSearch(INDEXER_URL, ALERTS_INDEX, body, INDEXER_AUTH);
    return { content: [{ type: 'text' as const, text: formatResponse(result) }] };
  }),
);

// ---------------------------------------------------------------------------
// search-agents  — Server API /agents
// ---------------------------------------------------------------------------
server.tool(
  'search-agents',
  'Search registered Wazuh agents by name, IP, status, or OS',
  {
    name: searchText.optional().describe('Agent name filter'),
    ip: z.string().max(45).optional().describe('Agent IP filter'),
    status: z.enum(['active', 'disconnected', 'pending', 'never_connected']).optional(),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, 'search-agents', async ({ name, ip, status, limit }) => {
    const params: Record<string, string> = { limit: String(limit) };
    if (name) params.name = name;
    if (ip) params.ip = ip;
    if (status) params.status = status;

    const result = await wazuhApi('/agents', params);
    return { content: [{ type: 'text' as const, text: formatResponse(result) }] };
  }),
);

// ---------------------------------------------------------------------------
// get-agent-info  — Server API /agents/{id}
// ---------------------------------------------------------------------------
server.tool(
  'get-agent-info',
  'Get detailed info about a specific Wazuh agent',
  { agent_id: safeId.describe('Agent ID') },
  READ_ONLY,
  toolGuard(SERVER_NAME, 'get-agent-info', async ({ agent_id }) => {
    // agent_id is validated by safeId to a URL-safe charset — no encoding needed.
    const result = await wazuhApi(`/agents/${agent_id}`);
    return { content: [{ type: 'text' as const, text: formatResponse(result) }] };
  }),
);

// ---------------------------------------------------------------------------
// get-vulnerabilities  — Indexer wazuh-states-vulnerabilities-* / _search
// ---------------------------------------------------------------------------
server.tool(
  'get-vulnerabilities',
  'List vulnerabilities (CVEs) detected on an agent (queries the Wazuh indexer)',
  {
    agent_id: safeId.describe('Agent ID'),
    severity: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, 'get-vulnerabilities', async ({ agent_id, severity, limit }) => {
    const body = buildVulnBody({ agent_id, severity, limit });
    const result = await indexerSearch(INDEXER_URL, VULN_INDEX, body, INDEXER_AUTH);
    return { content: [{ type: 'text' as const, text: formatResponse(result) }] };
  }),
);

// ---------------------------------------------------------------------------
// get-rules  — Server API /rules
// ---------------------------------------------------------------------------
server.tool(
  'get-rules',
  'Search active Wazuh detection rules',
  {
    search: searchText.optional().describe('Search text in rule descriptions'),
    level: z.number().min(1).max(15).optional().describe('Filter by exact rule level'),
    group: searchText.optional().describe('Filter by rule group'),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, 'get-rules', async ({ search, level, group, limit }) => {
    const params: Record<string, string> = { limit: String(limit) };
    if (search) params.search = search;
    if (level !== undefined) params.level = String(level);
    if (group) params.group = group;

    const result = await wazuhApi('/rules', params);
    return { content: [{ type: 'text' as const, text: formatResponse(result) }] };
  }),
);

// ---------------------------------------------------------------------------
// get-decoders  — Server API /decoders
// ---------------------------------------------------------------------------
server.tool(
  'get-decoders',
  'Search active Wazuh log decoders',
  {
    search: searchText.optional().describe('Search text in decoder names'),
    limit: z.number().min(1).max(100).optional().default(20),
  },
  READ_ONLY,
  toolGuard(SERVER_NAME, 'get-decoders', async ({ search, limit }) => {
    const params: Record<string, string> = { limit: String(limit) };
    if (search) params.search = search;

    const result = await wazuhApi('/decoders', params);
    return { content: [{ type: 'text' as const, text: formatResponse(result) }] };
  }),
);

// --- Start Server ---
async function main() {
  await startServer(server, SERVER_NAME, async () => {
    // Best-effort Server API reachability probe (uses shared timeout/retry; the
    // pinned CA via NODE_EXTRA_CA_CERTS applies — no global TLS bypass).
    const resp = await fetchWithRetry(`${WAZUH_URL}/`, {}, REQUEST_TIMEOUT_MS);
    if (!resp.ok) throw new Error(`Server API status ${resp.status}`);
  });
}

main().catch((err) => {
  log('error', 'fatal', {
    server: SERVER_NAME,
    detail: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
