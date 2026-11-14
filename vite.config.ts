import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      // recharts alone is ~400 kB. Splitting it out keeps the shell small and
      // lets the browser cache the chart code separately from app code.
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ['recharts'],
          },
        },
      },
    },
    server: {
      // Allow any Host header: this server runs behind preview/proxy domains
      // (and as Vite middleware inside Express). Vite otherwise rejects unknown
      // hosts with HTTP 403 and the preview never loads.
      host: "0.0.0.0",
      allowedHosts: true as const,
      // HMR is off in constrained sandboxes (DISABLE_HMR=1) and on in a normal
      // dev environment; file watching follows the same switch to save CPU.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
