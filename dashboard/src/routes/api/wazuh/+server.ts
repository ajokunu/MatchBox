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
    const [statsResp, agentsResp, infoResp] = await Promise.all([
      wazuhFetch('/manager/stats'),
      wazuhFetch('/agents/summary/status'),
      wazuhFetch('/manager/info')
    ]);

    const stats = statsResp as {
      data: { affected_items: Array<{ alerts: Array<{ times: number }> }> };
    };
    const agents = agentsResp as {
      data: { connection: { active: number; total: number } };
    };
    const info = infoResp as {
      data: { affected_items: Array<{ version: string }> };
    };

    // Sum all alert counts from stats
    let totalAlerts = 0;
    for (const hour of stats.data.affected_items) {
      for (const alert of hour.alerts ?? []) {
        totalAlerts += alert.times;
      }
    }

    return json({
      totalAlerts,
      activeAgents: agents.data.connection.active,
      totalAgents: agents.data.connection.total,
      version: info.data.affected_items?.[0]?.version ?? 'unknown',
      status: 'online'
    });
  } catch (err) {
    return json(
      { error: (err as Error).message, status: 'error' },
      { status: 502 }
    );
  }
};
