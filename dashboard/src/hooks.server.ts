import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
/**
 * Server hooks — enforce auth + same-origin on the /api/* SOC proxy.
 *
 * Without this, anyone able to reach the dashboard's Node port could call /api/wazuh
 * and pull full SOC internals (every agent id/name/OS/IP, alert + case + indicator
 * counts) — reconnaissance-grade data for a LAN attacker. We gate /api/* behind:
 *   1. a shared bearer token (SOC_API_TOKEN), and
 *   2. a same-origin check for browser (cookie-bearing) requests, as defense-in-depth
 *      against CSRF once any state-changing route is added.
 *
 * The token may be supplied as `Authorization: Bearer <token>` or, for the dashboard's
 * own same-origin fetches, via the `soc_api` cookie (set out-of-band / by the ingress).
 *
 * If SOC_API_TOKEN is unset we FAIL CLOSED in production and allow only same-origin
 * requests in dev, so a misconfigured deploy never silently exposes the proxy.
 */
import type { Handle } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

function timingSafeEqual(a: string, b: string): boolean {
  // Constant-time-ish compare to avoid leaking token length/prefix via timing.
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function presentedToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  const cookie = request.headers.get('cookie');
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)soc_api=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  // No Origin header (e.g. same-origin GET, server-to-server): fall back to Referer,
  // and treat its absence as same-origin only for safe GET requests.
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === url.origin;
    } catch {
      return false;
    }
  }
  return request.method === 'GET';
}

export const handle: Handle = async ({ event, resolve }) => {
  const { url, request } = event;

  if (url.pathname.startsWith('/api/')) {
    // 1. Same-origin / CSRF guard (cheap, applies to all callers).
    if (!isSameOrigin(request, url)) {
      return json({ status: 'error', error: 'forbidden' }, { status: 403 });
    }

    // 2. Bearer-token auth.
    const expected = env.SOC_API_TOKEN;
    if (expected) {
      const presented = presentedToken(request);
      if (!presented || !timingSafeEqual(presented, expected)) {
        return json({ status: 'error', error: 'unauthorized' }, { status: 401 });
      }
    } else if (!dev) {
      // No token configured in production = fail closed. Log once-ish, deny always.
      console.error('[hooks] SOC_API_TOKEN is unset in production — denying /api/* access');
      return json({ status: 'error', error: 'unauthorized' }, { status: 401 });
    }
    // dev + no token: same-origin requests already passed the guard above; allow.
  }

  return resolve(event);
};
