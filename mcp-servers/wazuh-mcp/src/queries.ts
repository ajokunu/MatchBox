/**
 * Pure request-shape builders for the Wazuh MCP server.
 *
 * Kept side-effect free (no env reads, no process.exit) so Vitest contract tests
 * can assert the exact indexer _search bodies without a live cluster or
 * triggering the server's fail-closed env checks.
 */

export interface AlertFilters {
  limit: number;
  level_min?: number;
  agent_id?: string;
  rule_id?: string;
}

/** Build the OpenSearch _search body for list-alerts. */
export function buildListAlertsBody(f: AlertFilters): Record<string, unknown> {
  const must: unknown[] = [];
  if (f.level_min !== undefined) must.push({ range: { 'rule.level': { gte: f.level_min } } });
  if (f.agent_id !== undefined) must.push({ term: { 'agent.id': f.agent_id } });
  if (f.rule_id !== undefined) must.push({ term: { 'rule.id': f.rule_id } });
  return {
    size: f.limit,
    sort: [{ '@timestamp': { order: 'desc' } }],
    query: must.length ? { bool: { must } } : { match_all: {} },
  };
}

/** Build the OpenSearch _search body for get-alert (by document _id). */
export function buildGetAlertBody(alertId: string): Record<string, unknown> {
  return { size: 1, query: { term: { _id: alertId } } };
}

/**
 * Wazuh Server-API free-text injection guard (finding 6).
 *
 * The `search`/`group`/`name` params feed Wazuh's `q`/`search` query grammar,
 * whose structural meaning is carried by a small operator set:
 *   `;` clause separator, `,` value list, `(` `)` grouping,
 *   `=` `<` `>` comparison, `~` like-match, `!` negation.
 * We model the threat directly: a grammar-aware DENYLIST of exactly those
 * operators (plus backslash and control chars), rather than an arbitrary
 * character whitelist that also rejects legitimate text (colons, commas-in-
 * prose, brackets in rule descriptions). Anything without an operator cannot
 * introduce a new clause/comparison/grouping, so it is injection-safe while
 * remaining expressive. Exported pure so the contract tests can assert it
 * without a live Server API.
 */
export const WAZUH_QUERY_OPERATORS = /[;,()=<>~!\\\x00-\x1f]/;

/** True when a free-text search/group/name value contains no Wazuh query operators. */
export function isSafeWazuhSearch(value: string): boolean {
  return value.length <= 256 && !WAZUH_QUERY_OPERATORS.test(value);
}

export interface VulnFilters {
  agent_id: string;
  severity?: string;
  limit: number;
}

/** Build the OpenSearch _search body for get-vulnerabilities. */
export function buildVulnBody(f: VulnFilters): Record<string, unknown> {
  const must: unknown[] = [{ term: { 'agent.id': f.agent_id } }];
  if (f.severity !== undefined) must.push({ term: { 'vulnerability.severity': f.severity } });
  return {
    size: f.limit,
    sort: [{ 'vulnerability.severity': { order: 'desc' } }],
    query: { bool: { must } },
  };
}
