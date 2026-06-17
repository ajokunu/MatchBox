/**
 * Shared server-side upstream-fetch helper.
 *
 * Centralizes the patterns every /api/* proxy route used to re-implement by hand:
 *   - request timeout (AbortSignal)
 *   - `resp.ok` guard
 *   - JSON parse
 *   - CA-pinned TLS for the one self-signed HTTPS upstream (Wazuh) — replaces the
 *     removed process-wide NODE_TLS_REJECT_UNAUTHORIZED=0 kill switch
 *   - safe, generic error mapping so raw upstream/connection strings (hostnames,
 *     ports, TLS internals) are NEVER leaked verbatim to the browser
 *
 * Fixing a security concern (timeout, TLS posture, error redaction) here fixes it
 * for all five routes at once.
 */
import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { env } from '$env/dynamic/private';

const DEFAULT_TIMEOUT_MS = 10_000;

/** An upstream call failed in a way the client should see only generically. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/**
 * Lazily-built undici dispatcher that trusts ONLY the SOC self-signed CA, used for
 * credential-bearing HTTPS calls (Wazuh). We import undici dynamically so the module
 * graph stays clean and a missing CA simply falls back to default trust (with
 * NODE_EXTRA_CA_CERTS still honored by Node globally).
 */
let caDispatcherPromise: Promise<unknown> | undefined;

/**
 * Public accessor for the SOC-CA-pinned dispatcher (used by the health route's raw
 * HTTPS probes). Returns undefined when SOC_CA_CERT is unset — callers then fall back
 * to NODE_EXTRA_CA_CERTS / system trust.
 */
export async function socCaDispatcher(): Promise<unknown | undefined> {
  return getCaDispatcher();
}

async function getCaDispatcher(): Promise<unknown | undefined> {
  const caPath = env.SOC_CA_CERT;
  if (!caPath) return undefined; // rely on NODE_EXTRA_CA_CERTS / system trust
  if (!caDispatcherPromise) {
    caDispatcherPromise = (async () => {
      const { Agent } = await import('undici');
      const ca = readFileSync(caPath, 'utf8');
      // Pin trust to the SOC CA on this dispatcher only — scoped, never global.
      return new Agent({ connect: { ca } });
    })().catch((err) => {
      console.error('[upstream] failed to load SOC CA, falling back to system trust:', err);
      return undefined;
    });
  }
  return caDispatcherPromise;
}

export interface UpstreamOptions extends RequestInit {
  timeoutMs?: number;
  /** Pin the SOC CA dispatcher (only for credentialed self-signed HTTPS, i.e. Wazuh). */
  pinSocCa?: boolean;
}

/**
 * fetch() with a timeout + optional CA pinning. Throws UpstreamError on non-2xx so
 * callers get a consistent, redactable failure. The thrown message is intentionally
 * coarse (status only) — never the raw connection/TLS error text.
 */
export async function upstreamFetch(url: string, opts: UpstreamOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, pinSocCa = false, ...init } = opts;
  const dispatcher = pinSocCa ? await getCaDispatcher() : undefined;
  let resp: Response;
  try {
    resp = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      // `dispatcher` is an undici extension to RequestInit; harmless when undefined.
      ...(dispatcher ? { dispatcher } : {})
    } as RequestInit);
  } catch (err) {
    // Log the detailed cause server-side; surface nothing internal to the client.
    console.error(`[upstream] fetch ${url} failed:`, err);
    throw new UpstreamError('upstream unreachable');
  }
  if (!resp.ok) {
    // Keep the status code (useful, non-sensitive); drop the body/URL details.
    throw new UpstreamError(`upstream responded ${resp.status}`);
  }
  return resp;
}

/** Parse JSON defensively; a malformed body becomes a generic UpstreamError, not a TypeError. */
export async function upstreamJson<T = unknown>(resp: Response): Promise<T> {
  try {
    return (await resp.json()) as T;
  } catch (err) {
    console.error('[upstream] JSON parse failed:', err);
    throw new UpstreamError('upstream returned invalid response');
  }
}

/**
 * Uniform error response for the GET handlers. Logs the real error server-side and
 * returns a generic body so internal SOC topology is never disclosed to callers.
 */
export function upstreamErrorResponse(err: unknown, status = 502): Response {
  console.error('[upstream] route error:', err);
  return json({ status: 'error', error: 'upstream unavailable' }, { status });
}
