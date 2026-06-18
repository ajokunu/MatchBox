import { env } from '$env/dynamic/private';
import { upstreamErrorResponse, upstreamFetch, upstreamJson } from '$lib/server/upstream';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';

/**
 * Runtime schemas for the Wazuh Server API responses we consume. These REPLACE the previous
 * `as`-cast-plus-optional-chaining defensiveness (finding 22/42): an unexpected 200-with-error
 * body (partial outage, auth edge) used to slip past the casts and throw a TypeError deep in the
 * handler, which got swallowed into a generic 502 and masked the real cause. Now each upstream
 * payload is parsed with `.safeParse`; on a shape mismatch we fall back to an empty-but-valid
 * value (logged once) so the route degrades gracefully instead of 502-ing. Unknown extra fields
 * are allowed (passthrough) — we validate only the fields actually read below.
 */
const statsSchema = z
  .object({
    data: z
      .object({
        affected_items: z
          .array(
            z
              .object({
                alerts: z
                  .array(
                    z
                      .object({
                        level: z.number(),
                        times: z.number(),
                      })
                      .passthrough(),
                  )
                  .optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const agentsSchema = z
  .object({
    data: z
      .object({
        total_affected_items: z.number().optional(),
        affected_items: z
          .array(
            z
              .object({
                id: z.string(),
                name: z.string(),
                status: z.string(),
                os: z
                  .object({ name: z.string().optional(), version: z.string().optional() })
                  .passthrough()
                  .optional(),
                ip: z.string().optional(),
                version: z.string().optional(),
                dateAdd: z.string().optional(),
                lastKeepAlive: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const infoSchema = z
  .object({
    data: z
      .object({
        affected_items: z.array(z.object({ version: z.string() }).passthrough()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const rulesSchema = z
  .object({
    data: z.object({ total_affected_items: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

const scaSchema = z
  .object({
    data: z
      .object({
        affected_items: z
          .array(
            z
              .object({
                name: z.string(),
                score: z.number(),
                pass: z.number(),
                fail: z.number(),
                invalid: z.number().optional(),
                not_applicable: z.number().optional(),
                total_checks: z.number(),
                policy_id: z.string(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * Parse `value` with `schema`; on failure log the issue server-side and return `fallback`
 * so a single malformed upstream response degrades that section instead of failing the route.
 */
function parseOr<T>(schema: z.ZodType<T>, value: unknown, fallback: T, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  console.warn(`[wazuh] unexpected ${label} response shape:`, result.error.issues);
  return fallback;
}

const WAZUH_API = env.WAZUH_API_URL || 'https://localhost:55000';
const WAZUH_USER = env.WAZUH_API_USER || 'wazuh-wui';
const WAZUH_PASS = env.WAZUH_API_PASSWORD || '';

/**
 * Single-tenant module-scoped JWT cache. This SOC dashboard authenticates with ONE
 * shared service credential, so a process-global token is correct here (it is NOT a
 * per-user cache). `inflight` coalesces concurrent cold requests so N parallel calls
 * trigger a single authenticate() instead of a thundering herd.
 */
let jwtToken: string | null = null;
let tokenExpiry = 0;
let inflight: Promise<string> | null = null;
const TOKEN_TTL_MS = 850_000;

async function authenticate(): Promise<string> {
  const credentials = Buffer.from(`${WAZUH_USER}:${WAZUH_PASS}`).toString('base64');
  // pinSocCa: Wazuh is the only credential-bearing self-signed HTTPS upstream, so we
  // pin the SOC CA here instead of disabling TLS verification process-wide.
  const resp = await upstreamFetch(`${WAZUH_API}/security/user/authenticate`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
    pinSocCa: true,
  });
  const data = await upstreamJson<{ data?: { token?: string } }>(resp);
  const token = data.data?.token;
  if (!token) throw new Error('Wazuh auth: no token in response');
  jwtToken = token;
  tokenExpiry = Date.now() + TOKEN_TTL_MS;
  return token;
}

async function getToken(): Promise<string> {
  if (jwtToken && Date.now() < tokenExpiry) return jwtToken;
  // Coalesce concurrent refreshes onto a single in-flight authenticate().
  if (!inflight) {
    inflight = authenticate().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function invalidateToken() {
  jwtToken = null;
  tokenExpiry = 0;
}

async function wazuhFetch(path: string): Promise<unknown> {
  const token = await getToken();
  try {
    const resp = await upstreamFetch(`${WAZUH_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      pinSocCa: true,
    });
    return upstreamJson(resp);
  } catch (err) {
    // A cached token may have been revoked server-side before its TTL. Reset and retry
    // once so we don't fail every call for up to ~14 minutes.
    const msg = (err as Error).message ?? '';
    if (msg.includes('401') || msg.includes('403')) {
      invalidateToken();
      const fresh = await getToken();
      const resp = await upstreamFetch(`${WAZUH_API}${path}`, {
        headers: { Authorization: `Bearer ${fresh}` },
        pinSocCa: true,
      });
      return upstreamJson(resp);
    }
    throw err;
  }
}

export const GET: RequestHandler = async () => {
  try {
    const [statsResp, agentsResp, infoResp, rulesResp, scaResp] = await Promise.all([
      wazuhFetch('/manager/stats'),
      wazuhFetch(
        '/agents?select=id,name,status,os.name,os.version,ip,version,dateAdd,lastKeepAlive',
      ),
      wazuhFetch('/manager/info'),
      wazuhFetch('/rules?limit=1'),
      wazuhFetch('/sca/000').catch(() => null),
    ]);

    // Runtime-validate each upstream payload; a bad shape degrades that section (empty/default)
    // rather than throwing a TypeError that masks into a generic 502 (finding 22/42).
    const stats = parseOr(statsSchema, statsResp, {}, 'stats');
    const agents = parseOr(agentsSchema, agentsResp, {}, 'agents');
    const info = parseOr(infoSchema, infoResp, {}, 'info');
    const rules = parseOr(rulesSchema, rulesResp, {}, 'rules');
    const sca = scaResp === null ? null : parseOr(scaSchema, scaResp, {}, 'sca');

    // Sum all alert counts from stats (schema-validated; fields are present-or-undefined).
    let totalAlerts = 0;
    let criticalAlerts = 0;
    for (const hour of stats.data?.affected_items ?? []) {
      for (const alert of hour.alerts ?? []) {
        totalAlerts += alert.times;
        if (alert.level >= 10) criticalAlerts += alert.times;
      }
    }

    // Agent details
    const agentList = (agents.data?.affected_items ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      os: a.os?.name ? `${a.os.name} ${a.os.version ?? ''}`.trim() : 'unknown',
      ip: a.ip ?? 'N/A',
      version: a.version ?? 'unknown',
      registered: a.dateAdd ?? 'unknown',
    }));

    const totalAgents = agents.data?.total_affected_items ?? agentList.length;
    const activeAgents = agentList.filter((a) => a.status === 'active').length;

    // SCA compliance
    const scaPolicies =
      sca?.data?.affected_items?.map((p) => ({
        name: p.name,
        score: p.score,
        pass: p.pass,
        fail: p.fail,
        invalid: p.invalid ?? 0,
        notApplicable: p.not_applicable ?? 0,
        total: p.total_checks,
        policyId: p.policy_id,
      })) ?? [];

    return json({
      totalAlerts,
      criticalAlerts,
      activeAgents,
      totalAgents,
      totalRules: rules.data?.total_affected_items ?? 0,
      version: info.data?.affected_items?.[0]?.version ?? 'unknown',
      agents: agentList,
      sca: scaPolicies,
      status: 'online',
    });
  } catch (err) {
    // Generic body only — see upstreamErrorResponse (no internal topology leaked).
    return upstreamErrorResponse(err);
  }
};
