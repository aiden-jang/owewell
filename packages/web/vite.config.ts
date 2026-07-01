import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 30001,
    // Proxy API calls to the server in dev so the browser treats them as same-origin
    // and the session cookie flows without CORS. The server serves the API under /api
    // (so it never collides with client routes like /groups/:id), so no path rewrite.
    proxy: {
      '/api': { target: 'http://localhost:30000', changeOrigin: true },
      // WebSocket endpoint for realtime group updates.
      '/ws': { target: 'http://localhost:30000', ws: true },
    },
  },
});
