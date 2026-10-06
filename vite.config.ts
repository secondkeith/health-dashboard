import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/health-dashboard/',
  build: {
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!/\/node_modules\//.test(id)) return;

          // Match runtime modules explicitly so Recharts cannot pull React into its chunk.
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'react-vendor';
          }

          // The remaining runtime dependencies belong to the Recharts dependency tree.
          return 'charts-vendor';
        },
      },
    },
  },
});
