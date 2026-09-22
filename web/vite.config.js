import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * The site builds into `dist/` at the repository root. `public/` holds what the site and the API
 * both read, and is copied in alongside it.
 *
 * Nothing here reaches the MCP server. That has no dependencies and no build step, because an
 * Alexa+ skill is a thing somebody else has to run, and "install this toolchain first" is a worse
 * answer than it sounds.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8792' } },
});
