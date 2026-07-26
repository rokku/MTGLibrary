import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The service worker precaches the app shell only. Collection data (cards +
// images) lives in IndexedDB and is entirely user-managed, so it is never
// touched by Workbox. The catalogue .json.gz bundles in public/data are large
// and fetched on demand, so they are excluded from precache.
export default defineConfig({
  // Allow the app to be reached over a tunnel (cloudflared/ngrok) or LAN when
  // testing on a phone. Vite blocks unknown Host headers by default.
  preview: {
    host: true,
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io', '.loca.lt'],
  },
  server: {
    host: true,
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io', '.loca.lt'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Never precache the catalogue bundles — they are fetched on demand and
        // would blow past Workbox's size limits.
        globIgnores: ['**/data/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/data\//],
      },
      manifest: {
        name: 'MTG Collection',
        short_name: 'Collection',
        description: 'Offline browser for your CardMarket MTG collection',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
