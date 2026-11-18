import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { ProxyOptions } from 'vite'
import { defineConfig } from 'vitest/config'

const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'http://127.0.0.1:4173',
    changeOrigin: true,
    configure: (proxy) =>
      proxy.on('proxyReq', (request, incoming) => {
        // Only rewrite our own dev/preview origin; foreign origins stay blocked.
        if (
          [
            'http://127.0.0.1:5173',
            'http://localhost:5173',
            'http://127.0.0.1:4174',
            'http://localhost:4174',
          ].includes(incoming.headers.origin || '')
        ) {
          request.setHeader('origin', 'http://127.0.0.1:4173')
        }
      }),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'validation', test: /node_modules[\\/]zod[\\/]/ }],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 4174,
    strictPort: true,
    proxy: apiProxy,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
  },
})
