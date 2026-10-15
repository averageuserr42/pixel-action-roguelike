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
    // Спрайты встраиваются в сборку как data: URI: игра обязана запускаться
    // двойным кликом из файла (file://), а локальные картинки браузер в
    // WebGL-текстуры не отдаёт (SecurityError на texImage2D). Все спрайты
    // мельче лимита; выросший ассет не сломает запуск молча — сборку остановит
    // tools/build/packSingleFile.mjs с понятной ошибкой.
    assetsInlineLimit: 4096,
  },
});
