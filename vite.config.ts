import { defineConfig } from 'vite';

// Dev: vite on 5173 (LAN-exposed) proxies /ws to the game server on 3117.
// Prod: express serves dist/ and /ws on 3117 directly.
export default defineConfig({
  appType: 'mpa',
  server: {
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:3117', ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        host: 'index.html',
        join: 'join.html',
      },
    },
  },
});
