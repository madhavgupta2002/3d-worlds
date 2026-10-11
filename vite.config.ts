import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

// Every worlds/<id>/index.html is its own page; the shell (index.html) hosts them.
const worlds = Object.fromEntries(
  readdirSync(resolve(__dirname, 'worlds'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(__dirname, 'worlds', d.name, 'index.html')))
    .map((d) => [d.name, resolve(__dirname, 'worlds', d.name, 'index.html')]),
);

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { shell: resolve(__dirname, 'index.html'), ...worlds } },
  },
});
