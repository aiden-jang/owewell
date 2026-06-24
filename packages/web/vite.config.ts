import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy API calls (namespaced under /api) to the server in dev so the browser
    // treats them as same-origin and the session cookie flows without CORS. The /api
    // prefix keeps API paths from colliding with client routes like /groups/:id.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // WebSocket endpoint for realtime group updates.
      '/ws': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
