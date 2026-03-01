import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const WAZUH_API = env.WAZUH_API_URL || 'https://localhost:55000';
const WAZUH_USER = env.WAZUH_API_USER || 'wazuh-wui';
const WAZUH_PASS = env.WAZUH_API_PASSWORD || '';

let jwtToken: string | null = null;
let tokenExpiry = 0;
const TOKEN_TTL_MS = 850_000;

async function getToken(): Promise<string> {
  if (jwtToken && Date.now() < tokenExpiry) return jwtToken;

  const credentials = Buffer.from(`${WAZUH_USER}:${WAZUH_PASS}`).toString('base64');
  const resp = await fetch(`${WAZUH_API}/security/user/authenticate`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(10_000)
  });

  if (!resp.ok) throw new Error(`Wazuh auth failed: ${resp.status}`);
  const data = (await resp.json()) as { data: { token: string } };
  jwtToken = data.data.token;
  tokenExpiry = Date.now() + TOKEN_TTL_MS;
  return jwtToken;
}

async function wazuhFetch(path: string): Promise<unknown> {
  const token = await getToken();
  const resp = await fetch(`${WAZUH_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!resp.ok) throw new Error(`Wazuh API ${resp.status}`);
  return resp.json();
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
      data: { affected_items: Array<{ alerts: Array<{ sigid: number; level: number; times: number }> }> };
    };
    const agents = agentsResp as {
      data: {
        total_affected_items: number;
        affected_items: Array<{
          id: string; name: string; status: string;
          os?: { name?: string; version?: string };
          ip?: string; version?: string;
          dateAdd?: string; lastKeepAlive?: string;
        }>;
      };
    };
    const info = infoResp as {
      data: { affected_items: Array<{ version: string }> };
    };
    const rules = rulesResp as {
      data: { total_affected_items: number };
    };
    const sca = scaResp as {
      data?: {
        affected_items: Array<{
          name: string; score: number; pass: number; fail: number;
          invalid: number; not_applicable: number; total_checks: number; policy_id: string;
        }>;
      };
    } | null;

    // Sum all alert counts from stats
    let totalAlerts = 0;
    let criticalAlerts = 0;
    for (const hour of stats.data.affected_items) {
      for (const alert of hour.alerts ?? []) {
        totalAlerts += alert.times;
        if (alert.level >= 10) criticalAlerts += alert.times;
      }
    }

    // Agent details
    const agentList = agents.data.affected_items.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      os: a.os?.name ? `${a.os.name} ${a.os.version ?? ''}`.trim() : 'unknown',
      ip: a.ip ?? 'N/A',
      version: a.version ?? 'unknown',
      registered: a.dateAdd ?? 'unknown'
    }));

    const totalAgents = agents.data.total_affected_items;
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
      totalRules: rules.data.total_affected_items,
      version: info.data.affected_items?.[0]?.version ?? 'unknown',
      agents: agentList,
      sca: scaPolicies,
      status: 'online'
    });
  } catch (err) {
    return json(
      { error: (err as Error).message, status: 'error' },
      { status: 502 }
    );
  }
};
