/**
 * @matchbox/mcp-shared — Shared utilities for MatchBox MCP servers
 *
 * Provides common fetch/retry logic and response formatting used by
 * wazuh-mcp, thehive-mcp, and opencti-mcp servers.
 */

/** Default request timeout in milliseconds */
export const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || "10000", 10);

/** Maximum response size in characters to prevent excessive output to LLM */
export const MAX_RESPONSE_CHARS = parseInt(process.env.MAX_RESPONSE_CHARS || "50000", 10);

/** HTTP status codes eligible for automatic retry */
export const RETRYABLE_CODES = new Set([429, 503]);

/** Fetch with single retry on transient failures (429/503/timeout) */
export async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
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

/** Serialize data to JSON and truncate if it exceeds the size limit */
export function formatResponse(data: unknown, maxChars = MAX_RESPONSE_CHARS): string {
  const json = JSON.stringify(data, null, 2);
  if (json.length <= maxChars) return json;
  return json.slice(0, maxChars) + `\n... [truncated: ${json.length} chars total, showing first ${maxChars}]`;
}
