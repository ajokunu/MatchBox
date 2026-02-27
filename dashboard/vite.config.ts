import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Allow self-signed certs from local SOC services (Wazuh HTTPS)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export default defineConfig({
  plugins: [sveltekit()],
  server: { port: 5173 }
});
