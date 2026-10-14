import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Ambulanzsystem backend (backend/README.md); override with PLS_BACKEND_URL.
const backendUrl = process.env.PLS_BACKEND_URL ?? 'http://127.0.0.1:5042'

const proxy = {
  '/api': { target: backendUrl, changeOrigin: true },
  '/hubs': { target: backendUrl, changeOrigin: true, ws: true },
  '/health': { target: backendUrl, changeOrigin: true },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  // `vite preview` serves the production build (service worker included) for the offline e2e.
  preview: { proxy },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['node_modules/**', 'dist/**', 'tests/**'],
  },
})
