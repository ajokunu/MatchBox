import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { upstreamFetch, upstreamJson, upstreamErrorResponse } from '$lib/server/upstream';

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
    pinSocCa: true
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
      pinSocCa: true
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
        pinSocCa: true
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
      wazuhFetch('/agents?select=id,name,status,os.name,os.version,ip,version,dateAdd,lastKeepAlive'),
      wazuhFetch('/manager/info'),
      wazuhFetch('/rules?limit=1'),
      wazuhFetch('/sca/000').catch(() => null)
    ]);

    const stats = statsResp as {
      data?: { affected_items?: Array<{ alerts?: Array<{ sigid: number; level: number; times: number }> }> };
    };
    const agents = agentsResp as {
      data?: {
        total_affected_items?: number;
        affected_items?: Array<{
          id: string; name: string; status: string;
          os?: { name?: string; version?: string };
          ip?: string; version?: string;
          dateAdd?: string; lastKeepAlive?: string;
        }>;
      };
    };
    const info = infoResp as {
      data?: { affected_items?: Array<{ version: string }> };
    };
    const rules = rulesResp as {
      data?: { total_affected_items?: number };
    };
    const sca = scaResp as {
      data?: {
        affected_items?: Array<{
          name: string; score: number; pass: number; fail: number;
          invalid: number; not_applicable: number; total_checks: number; policy_id: string;
        }>;
      };
    } | null;

    // Sum all alert counts from stats (guarded against partial/missing shapes).
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
      registered: a.dateAdd ?? 'unknown'
    }));

    const totalAgents = agents.data?.total_affected_items ?? agentList.length;
    const activeAgents = agentList.filter((a) => a.status === 'active').length;

    // SCA compliance
    const scaPolicies = sca?.data?.affected_items?.map((p) => ({
      name: p.name,
      score: p.score,
      pass: p.pass,
      fail: p.fail,
      invalid: p.invalid ?? 0,
      notApplicable: p.not_applicable ?? 0,
      total: p.total_checks,
      policyId: p.policy_id
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
      status: 'online'
    });
  } catch (err) {
    // Generic body only — see upstreamErrorResponse (no internal topology leaked).
    return upstreamErrorResponse(err);
  }
};
