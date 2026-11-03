import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The API is same-origin in production (the server serves the built web
    // assets), so the dev proxy keeps one set of fetch paths in the code.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { outDir: 'dist' },
});
