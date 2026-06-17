/**
 * Pure request-shape builders for the TheHive MCP server.
 *
 * Side-effect free so Vitest contract tests can assert the TheHive 5 merge
 * endpoint + payload without a live instance.
 */

/** TheHive 5 bulk-merge endpoint (there is no /api/v1/alert/merge route). */
export const ALERT_MERGE_BULK_PATH = "/api/v1/alert/merge/_bulk";

/** Promote an alert to a new case: POST /api/v1/alert/{alertId}/case. */
export function alertToCasePath(alertId: string): string {
  return `/api/v1/alert/${alertId}/case`;
}

/** Bulk-merge payload: { caseId, alertIds }. caseId is REQUIRED by the endpoint. */
export function buildMergeBulkBody(caseId: string, alertIds: string[]): {
  caseId: string;
  alertIds: string[];
} {
  return { caseId, alertIds };
}

/**
 * Join the base URL with an API path WITHOUT dropping a base path prefix.
 * `new URL("/api/v1/...", "https://host/thehive")` discards "/thehive" because
 * the leading slash is root-absolute. Under an ingress sub-path that breaks
 * every call, so we concatenate explicitly.
 */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
