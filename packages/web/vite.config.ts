import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 30001,
    // Proxy this app's API to the owewell Worker (wrangler dev) so the browser treats it as
    // same-origin and the session cookie flows without CORS. Everything (including the
    // per-group realtime WebSocket at /api/groups/:id/ws) lives under the API prefix.
    // Sign-in/out are full-page redirects to the shared auth service, so no /auth proxy.
    proxy: {
      '/api': { target: 'http://localhost:34200', changeOrigin: true, ws: true },
      // The old prefix, still served, so a stale cached bundle works in dev too.
      '/owewell': { target: 'http://localhost:34200', changeOrigin: true, ws: true },
    },
  },
});
