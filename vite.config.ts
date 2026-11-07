import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { worldPlugin } from './tooling/world/vite-plugin.ts';

// Режимы: `vite` — dev (данные мастера), `vite --mode public` — dev глазами игроков,
// `vite build` — сайт для игроков (dist/), `vite build --mode dm` — полная версия (dist-dm/).
export default defineConfig(({ mode }) => ({
  // Относительные пути: собранный сайт работает из любой подпапки (GitHub Pages и т. п.).
  base: './',
  plugins: [react(), worldPlugin()],
  build: {
    outDir: mode === 'dm' ? 'dist-dm' : 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
}));
