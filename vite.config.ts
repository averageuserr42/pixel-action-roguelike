import { defineConfig } from 'vite';

export default defineConfig({
  // Относительные пути — сборка работает и с GitHub Pages, и из подпапки.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    target: 'es2022',
    // Гигиена: карты исходников НЕ уезжают в прод.
    sourcemap: false,
    // Ассеты не инлайним — так их видно и легко заменять.
    assetsInlineLimit: 0,
  },
});
