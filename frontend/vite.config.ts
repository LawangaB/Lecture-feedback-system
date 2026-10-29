/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Same-origin in development: cookies, CSRF and the WebSocket Origin check all behave as in production.
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/socket.io': { target: API, ws: true, changeOrigin: false },
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], globals: true, css: false, exclude: ['e2e/**', 'node_modules/**'] },
});
