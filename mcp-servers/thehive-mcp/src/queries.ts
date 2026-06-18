/**
 * Pure request-shape builders + response type contracts for the TheHive MCP
 * server.
 *
 * Side-effect free so Vitest contract tests can assert the TheHive 5 merge
 * endpoint + payload without a live instance.
 */

/**
 * Response typing for the stable TheHive 5 endpoints (finding 25).
 *
 * `thehiveApi` previously returned `Promise<unknown>`, so every caller threaded
 * an opaque blob straight to formatResponse with no field-level type safety.
 * These minimal interfaces cover the fields the MCP tools actually surface;
 * they are intentionally NON-exhaustive (TheHive returns more) and use
 * `[key: string]: unknown` index signatures so extra fields pass through
 * formatResponse untouched. They exist for documentation + future field
 * extraction, not to validate payloads at runtime.
 *
 * Only modeled for endpoints with a stable shape: case (`/api/v1/case`),
 * observable (`.../observable`), and the Cortex job (`.../cortex/job`). The
 * generic `/api/v1/query` results stay `unknown` because their shape depends on
 * the query pipeline (listCase vs listAlert vs observables).
 */

/** Common TheHive 5 document envelope fields (`_id`, `_type`, timestamps). */
export interface TheHiveDoc {
  _id?: string;
  id?: string;
  _type?: string;
  _createdAt?: number;
  _createdBy?: string;
  [key: string]: unknown;
}

/** A TheHive case (POST /api/v1/case, GET /api/v1/case/{id}). */
export interface TheHiveCase extends TheHiveDoc {
  title?: string;
  description?: string;
  severity?: number;
  tlp?: number;
  pap?: number;
  status?: string;
  tags?: string[];
}

/** A TheHive observable (POST /api/v1/case/{id}/observable). */
export interface TheHiveObservable extends TheHiveDoc {
  dataType?: string;
  data?: string;
  message?: string;
  tlp?: number;
  pap?: number;
  ioc?: boolean;
  tags?: string[];
}

/** A Cortex analyzer job routed through TheHive (.../connector/cortex/job). */
export interface TheHiveCortexJob extends TheHiveDoc {
  analyzerId?: string;
  analyzerName?: string;
  status?: string;
  observableId?: string;
  report?: unknown;
}

/** TheHive 5 bulk-merge endpoint (there is no /api/v1/alert/merge route). */
export const ALERT_MERGE_BULK_PATH = '/api/v1/alert/merge/_bulk';

/** Promote an alert to a new case: POST /api/v1/alert/{alertId}/case. */
export function alertToCasePath(alertId: string): string {
  return `/api/v1/alert/${alertId}/case`;
}

/** Bulk-merge payload: { caseId, alertIds }. caseId is REQUIRED by the endpoint. */
export function buildMergeBulkBody(
  caseId: string,
  alertIds: string[],
): {
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
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
