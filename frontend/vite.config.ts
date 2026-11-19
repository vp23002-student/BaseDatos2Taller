import { defineConfig } from 'vite';

// En desarrollo (`npm run dev`) se usan los mismos prefijos que nginx en producción.
export default defineConfig({
  define: { global: 'globalThis' }, // PouchDB espera `global`
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/couch': { target: 'http://localhost:5984', rewrite: (p) => p.replace(/^\/couch/, '') },
    },
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
