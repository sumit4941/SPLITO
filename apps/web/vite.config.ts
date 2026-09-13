import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/splito-mark.svg', 'icons/splito-maskable.svg'],
      manifest: {
        name: 'SPLITO — shared money in balance',
        short_name: 'SPLITO',
        description: 'Track shared expenses, understand balances, and settle together.',
        theme_color: '#6343df',
        background_color: '#f8f4ec',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait-primary',
        categories: ['finance', 'productivity'],
        icons: [
          {
            src: '/icons/splito-mark.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icons/splito-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Add expense',
            short_name: 'Add expense',
            url: '/expenses/new',
            icons: [{ src: '/icons/splito-mark.svg', sizes: 'any', type: 'image/svg+xml' }],
          },
          {
            name: 'Record settlement',
            short_name: 'Settle',
            url: '/settle',
            icons: [{ src: '/icons/splito-mark.svg', sizes: 'any', type: 'image/svg+xml' }],
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) =>
              request.destination === 'image' && !request.url.includes('/api/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'splito-public-images',
              expiration: { maxEntries: 48, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.SPLITO_API_ORIGIN ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 4173, strictPort: true },
  build: {
    // Browser source maps are public deployment artifacts. Opt in only when a
    // reviewed monitoring pipeline will collect and protect them.
    sourcemap: process.env.SPLITO_WEB_SOURCEMAPS === 'true',
    target: 'es2022',
  },
});
