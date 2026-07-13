// vite.config.ts
import { defineConfig } from "file:///Users/ajang/projects/personal/apps/owewell/node_modules/.pnpm/vite@5.4.21_lightningcss@1.32.0/node_modules/vite/dist/node/index.js";
import react from "file:///Users/ajang/projects/personal/apps/owewell/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_lightningcss@1.32.0_/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///Users/ajang/projects/personal/apps/owewell/node_modules/.pnpm/@tailwindcss+vite@4.3.2_vite@5.4.21_lightningcss@1.32.0_/node_modules/@tailwindcss/vite/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 30001,
    // Proxy this app's API to the owewell Worker (wrangler dev) so the browser treats it as
    // same-origin and the session cookie flows without CORS. Everything (including the
    // per-group realtime WebSocket at /owewell/groups/:id/ws) lives under the /owewell prefix.
    // Sign-in/out are full-page redirects to the shared auth service, so no /auth proxy.
    proxy: {
      "/owewell": { target: "http://localhost:34200", changeOrigin: true, ws: true }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvYWphbmcvcHJvamVjdHMvcGVyc29uYWwvYXBwcy9vd2V3ZWxsL3BhY2thZ2VzL3dlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL2FqYW5nL3Byb2plY3RzL3BlcnNvbmFsL2FwcHMvb3dld2VsbC9wYWNrYWdlcy93ZWIvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL2FqYW5nL3Byb2plY3RzL3BlcnNvbmFsL2FwcHMvb3dld2VsbC9wYWNrYWdlcy93ZWIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgdGFpbHdpbmRjc3MgZnJvbSAnQHRhaWx3aW5kY3NzL3ZpdGUnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKSwgdGFpbHdpbmRjc3MoKV0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDMwMDAxLFxuICAgIC8vIFByb3h5IHRoaXMgYXBwJ3MgQVBJIHRvIHRoZSBvd2V3ZWxsIFdvcmtlciAod3JhbmdsZXIgZGV2KSBzbyB0aGUgYnJvd3NlciB0cmVhdHMgaXQgYXNcbiAgICAvLyBzYW1lLW9yaWdpbiBhbmQgdGhlIHNlc3Npb24gY29va2llIGZsb3dzIHdpdGhvdXQgQ09SUy4gRXZlcnl0aGluZyAoaW5jbHVkaW5nIHRoZVxuICAgIC8vIHBlci1ncm91cCByZWFsdGltZSBXZWJTb2NrZXQgYXQgL293ZXdlbGwvZ3JvdXBzLzppZC93cykgbGl2ZXMgdW5kZXIgdGhlIC9vd2V3ZWxsIHByZWZpeC5cbiAgICAvLyBTaWduLWluL291dCBhcmUgZnVsbC1wYWdlIHJlZGlyZWN0cyB0byB0aGUgc2hhcmVkIGF1dGggc2VydmljZSwgc28gbm8gL2F1dGggcHJveHkuXG4gICAgcHJveHk6IHtcbiAgICAgICcvb3dld2VsbCc6IHsgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDozNDIwMCcsIGNoYW5nZU9yaWdpbjogdHJ1ZSwgd3M6IHRydWUgfSxcbiAgICB9LFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTBWLFNBQVMsb0JBQW9CO0FBQ3ZYLE9BQU8sV0FBVztBQUNsQixPQUFPLGlCQUFpQjtBQUV4QixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxHQUFHLFlBQVksQ0FBQztBQUFBLEVBQ2hDLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBS04sT0FBTztBQUFBLE1BQ0wsWUFBWSxFQUFFLFFBQVEsMEJBQTBCLGNBQWMsTUFBTSxJQUFJLEtBQUs7QUFBQSxJQUMvRTtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
