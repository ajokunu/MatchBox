/**
 * @matchbox/mcp-shared — Shared utilities for MatchBox MCP servers
 *
 * Provides common fetch/retry logic, response formatting, ID validation,
 * structured logging, error sanitization, and stdio server startup used by
 * wazuh-mcp, thehive-mcp, and opencti-mcp servers.
 */

import { readFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/** Default request timeout in milliseconds (per attempt) */
export const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10);

/** Overall deadline (across all retry attempts) in milliseconds */
export const REQUEST_DEADLINE_MS = Number.parseInt(
  process.env.REQUEST_DEADLINE_MS || String(REQUEST_TIMEOUT_MS * 2 + 1000),
  10,
);

/** Maximum response size in characters to prevent excessive output to LLM */
export const MAX_RESPONSE_CHARS = Number.parseInt(process.env.MAX_RESPONSE_CHARS || '50000', 10);

/** Max retry attempts (total tries = 1 + retries on the first attempt) */
export const MAX_RETRIES = Number.parseInt(process.env.MAX_RETRIES || '1', 10);

/** HTTP status codes eligible for automatic retry */
export const RETRYABLE_CODES = new Set([429, 503]);

/**
 * Canonical ID validator shared by all three servers. Permits the union of
 * characters any backend ID can contain:
 *   - alphanumerics + `_` `-` : generic IDs (OpenCTI UUIDs/STIX ids, Cortex job ids)
 *   - `.`                     : Wazuh rule/decoder dotted ids
 *   - `~`                     : TheHive document ids (e.g. "~123")
 * All of these are URL-safe, so callers do NOT need encodeURIComponent.
 * Reconciles the three previously-divergent regexes (wazuh allowed `.~`,
 * thehive allowed `~.`, opencti allowed neither) into one definition.
 */
export const ID_PATTERN = /^[a-zA-Z0-9_.~-]+$/;

/** Required (non-empty) ID schema. */
export const safeId = z.string().regex(ID_PATTERN, 'Invalid ID format');

/** Optional ID schema (same charset; omitted rather than empty when absent). */
export const optionalSafeId = z.string().regex(ID_PATTERN, 'Invalid ID format').optional();

/** Structured JSON log line to stderr (stdout is reserved for the MCP transport). */
export function log(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown> = {},
): void {
  // Never emit to stdout — that channel carries the JSON-RPC protocol.
  console.error(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
}

/**
 * Audit log for [WRITE] mutations. Records tool name + a secret-scrubbed
 * argument summary so there is a trace of who/what mutated SOC state.
 */
export function auditWrite(tool: string, args: Record<string, unknown>): void {
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    // Drop anything that looks like a secret; summarize long strings.
    if (/token|password|secret|key|authorization/i.test(k)) continue;
    if (typeof v === 'string' && v.length > 120) {
      scrubbed[k] = `${v.slice(0, 120)}… (${v.length} chars)`;
    } else {
      scrubbed[k] = v;
    }
  }
  log('info', 'write', { tool, args: scrubbed });
}

/**
 * Wrap a tool handler so internal upstream detail (status codes, URLs, response
 * bodies) is logged to stderr but NOT leaked back to the LLM. The model only
 * sees a generic, server-scoped message.
 */
export function toolGuard<A>(
  serverName: string,
  toolName: string,
  handler: (args: A) => Promise<{ content: { type: 'text'; text: string }[] }>,
): (args: A) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (err) {
      // Full detail to stderr only.
      log('error', 'tool_error', {
        server: serverName,
        tool: toolName,
        detail: err instanceof Error ? err.message : String(err),
      });
      // Generic, non-leaking message to the model.
      return {
        content: [
          {
            type: 'text' as const,
            text: `${toolName} failed: the ${serverName} backend returned an error. See server logs for details.`,
          },
        ],
        isError: true,
      };
    }
  };
}

/** Is this HTTP method safe to auto-retry (idempotent)? */
function isIdempotent(method: string | undefined): boolean {
  const m = (method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/**
 * Fetch with bounded retries on transient failures (429/503/timeout).
 *
 * Hardening over the original:
 *  - Enforces an OVERALL deadline (`REQUEST_DEADLINE_MS`) across attempts, not
 *    just a per-attempt timeout, so a slow upstream can't stack 2×timeout+sleep.
 *  - Only auto-retries idempotent methods by default. A POST (e.g. the Wazuh
 *    auth call, an OpenCTI GraphQL query) is retried ONLY when the caller
 *    opts in via `opts.retryable: true` — avoiding silent duplicate mutations.
 *  - Per-attempt timeout is the smaller of REQUEST_TIMEOUT_MS and the remaining
 *    deadline budget.
 */
export async function fetchWithRetry(
  url: string,
  opts: RequestInit & { retryable?: boolean } = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  deadlineMs = REQUEST_DEADLINE_MS,
): Promise<Response> {
  const { retryable, ...fetchOpts } = opts;
  // Idempotent methods are always safe to retry; non-idempotent only when opted in.
  const mayRetry = retryable ?? isIdempotent(fetchOpts.method);
  const start = Date.now();
  const maxAttempts = 1 + Math.max(0, MAX_RETRIES);

  let lastResp: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = deadlineMs - (Date.now() - start);
    if (remaining <= 0) break; // out of overall budget
    const attemptTimeout = Math.min(timeoutMs, remaining);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeout);
    try {
      const resp = await fetch(url, { ...fetchOpts, signal: controller.signal });
      const canRetryMore = attempt < maxAttempts - 1 && mayRetry;
      if (canRetryMore && RETRYABLE_CODES.has(resp.status)) {
        lastResp = resp;
        log('warn', 'retry', { reason: resp.status, attempt });
        const backoff = Math.min(
          1000 * (attempt + 1),
          Math.max(0, deadlineMs - (Date.now() - start)),
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      return resp;
    } catch (err: unknown) {
      const canRetryMore = attempt < maxAttempts - 1 && mayRetry;
      if (canRetryMore && err instanceof Error && err.name === 'AbortError') {
        log('warn', 'retry', { reason: 'timeout', attempt });
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  // If we exhausted retries on a retryable status, return that last response so
  // the caller surfaces the real upstream status rather than a synthetic error.
  if (lastResp) return lastResp;
  // TS control-flow fallback — unreachable in practice (every attempt either
  // returns, throws, or sets lastResp before the loop ends).
  throw new Error('Request failed: retry budget exhausted');
}

/**
 * Serialize data to JSON, truncating the RECORD SET (not the raw string) so the
 * output is always valid, parseable JSON.
 *
 * Strategy: if the value (or a single `*.edges` / `data` array nested one level
 * down) is too large once serialized, drop trailing records until it fits and
 * wrap the result in a `{ truncated, shown, total, data }` envelope. If we can't
 * find an array to trim, fall back to a string slice but clearly flag it as
 * non-JSON so the model doesn't try to parse it.
 */
export function formatResponse(data: unknown, maxChars = MAX_RESPONSE_CHARS): string {
  const full = JSON.stringify(data, null, 2);
  if (full.length <= maxChars) return full;

  // Try to find the dominant array to trim (top-level array, or a common
  // GraphQL/REST shape: { ...: { edges: [...] } } / { data: [...] }).
  const arrInfo = findTrimmableArray(data);
  if (arrInfo) {
    const { arr, rebuild } = arrInfo;
    const total = arr.length;
    // Binary-search the largest prefix that fits under the limit.
    let lo = 0;
    let hi = total;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = JSON.stringify(
        { truncated: true, shown: mid, total, data: rebuild(arr.slice(0, mid)) },
        null,
        2,
      );
      if (candidate.length <= maxChars) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return JSON.stringify(
      { truncated: true, shown: best, total, data: rebuild(arr.slice(0, best)) },
      null,
      2,
    );
  }

  // No trimmable array — emit a clearly-flagged non-JSON preview.
  return `[TRUNCATED — NOT VALID JSON] response was ${full.length} chars, showing first ${maxChars}:\n${full.slice(0, maxChars)}`;
}

/** Locate the largest array we can safely truncate, with a rebuild fn to splice it back. */
function findTrimmableArray(
  data: unknown,
): { arr: unknown[]; rebuild: (a: unknown[]) => unknown } | null {
  if (Array.isArray(data)) {
    return { arr: data, rebuild: (a) => a };
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    // { data: [...] }
    if (Array.isArray(obj.data)) {
      return { arr: obj.data, rebuild: (a) => ({ ...obj, data: a }) };
    }
    // GraphQL / OpenSearch shapes one level down: { <root>: { edges: [...] } }
    // or { hits: { hits: [...] } }
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') {
        const inner = v as Record<string, unknown>;
        if (Array.isArray(inner.edges)) {
          return {
            arr: inner.edges,
            rebuild: (a) => ({ ...obj, [k]: { ...inner, edges: a } }),
          };
        }
        if (Array.isArray(inner.hits)) {
          return {
            arr: inner.hits,
            rebuild: (a) => ({ ...obj, [k]: { ...inner, hits: a } }),
          };
        }
      }
    }
  }
  return null;
}

/** Build an HTTP Basic auth header value from user/password. */
export function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/**
 * Minimal client for an OpenSearch/Wazuh-Indexer `_search` endpoint.
 * Uses Basic auth and the shared retry/timeout logic. `_search` is a read-only
 * POST so it is explicitly marked retryable.
 */
export async function indexerSearch(
  baseUrl: string,
  index: string,
  body: unknown,
  authHeader: string,
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/+$/, '')}/${index}/_search`;
  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    retryable: true, // _search is read-only/idempotent
  });
  if (!resp.ok) {
    // Detail logged by caller's toolGuard; throw with status only (no body).
    throw new Error(`indexer _search ${index} returned ${resp.status}`);
  }
  return resp.json();
}

/** Read a package's version from its package.json (avoids hardcoded "1.0.0" drift). */
export function readVersion(packageJsonUrl: string | URL, fallback = '0.0.0'): string {
  try {
    const raw = readFileSync(packageJsonUrl, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Connect an McpServer over stdio with an optional best-effort health check.
 * Factors out the connectivity-probe + StdioServerTransport boilerplate that
 * was copy-pasted across all three servers.
 */
export async function startServer(
  server: McpServer,
  name: string,
  healthCheck?: () => Promise<void>,
): Promise<void> {
  if (healthCheck) {
    try {
      await healthCheck();
      log('info', 'health_ok', { server: name });
    } catch (err) {
      log('warn', 'health_unreachable', {
        server: name,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'started', { server: name });
}
