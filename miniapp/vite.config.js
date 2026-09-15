import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // Для разработки без ngrok: запрос к /api уходит на локальный бэкенд (npm run dev в src)
    proxy: {
      '/api': 'http://localhost:3001',
      '/assets/restaurant': 'http://localhost:3001',
    },
  },
});
