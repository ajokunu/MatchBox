import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
// defineConfig from vitest/config (not vite) so the `test` block is typed.
import { defineConfig } from 'vitest/config';

// Single version source: read package.json so the UI can never drift from the real
// package version (the Sidebar previously hardcoded a stale "v1.5.0").
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

// NOTE: TLS verification is intentionally NOT disabled here.
// The previous `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` was a process-wide
// kill switch that disabled certificate validation for EVERY outbound fetch (MITM risk).
// Self-signed SOC certs are now trusted by scope only:
//   - dev/prod:  set NODE_EXTRA_CA_CERTS=<path to root-ca.pem> to trust the SOC CA, or
//   - per-fetch: the Wazuh proxy (src/routes/api/wazuh/+server.ts) pins a CA-scoped
//     undici dispatcher on its credential-bearing calls only.
export default defineConfig({
  plugins: [sveltekit()],
  server: { port: 5173 },
  // Expose the real package version to the client (see Sidebar footer).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}'],
  },
  // Under vitest the sveltekit() plugin otherwise resolves Svelte to its SSR build,
  // so component mount() throws "not available on the server". Force the browser
  // condition for component tests; production/SSR resolution is unaffected.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
});
