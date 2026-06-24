import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy API calls to the server in dev so the browser treats them as same-origin
    // and the session cookie flows without CORS.
    proxy: {
      '/auth': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
