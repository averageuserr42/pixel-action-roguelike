/**
 * Смоук-тест упакованной сборки: dist/index.html запускается ИЗ ФАЙЛА (file://),
 * ровно так, как его запускает игрок двойным кликом по «Играть.bat».
 *
 * Что проверяется и почему именно так:
 *  - игра стартует без сервера (иначе смысла в упаковке нет);
 *  - текстуры доходят до WebGL: локальные файлы браузер в текстуры не отдаёт
 *    (SecurityError на texImage2D), поэтому спрайты обязаны быть data: URI —
 *    если кто-то вернёт внешние ассеты, тест это увидит как ошибки в консоли;
 *  - выбор таланта работает: тест сам жмёт «1», как игрок, и мир оживает;
 *  - мир действительно рисуется: пиксели канваса читаются прямо из страницы
 *    (data: URI не красят холст, поэтому getImageData доступен).
 *
 * Запуск: node tools/qa/file-launch-smoke.mjs [путь-к-index.html]
 * Код возврата 0 — всё хорошо, 1 — есть ошибки (подробности в stdout).
 *
 * Зависимостей нет: только headless Chrome/Edge и CDP по WebSocket (встроен
 * в Node 22+). Скриншот сохраняется во временный каталог — путь печатается.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const indexHtml = resolve(process.argv[2] ?? join(root, 'dist', 'index.html'));
if (!existsSync(indexHtml)) {
  console.error(`нет собранной игры: ${indexHtml} (сначала npm run build)`);
  process.exit(1);
}

/** Chrome или Edge: оба Chromium, тесту всё равно какой. */
function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('не найден Chrome или Edge (укажи CHROME_PATH)');
  return found;
}

const browser = spawn(
  findBrowser(),
  [
    '--headless=new',
    '--no-first-run',
    `--user-data-dir=${join(tmpdir(), 'qa-file-launch-profile')}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

// Chrome печатает адрес отладки в stderr: "DevTools listening on ws://...".
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  const timer = setTimeout(() => rej(new Error('Chrome не открыл отладочный порт')), 15000);
  browser.stderr.on('data', (chunk) => {
    buf += chunk;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) {
      clearTimeout(timer);
      res(m[1]);
    }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('не удалось соединиться с CDP'));
});

let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  // Наблюдаемое: исключения страницы и сообщения консоли — только плохие.
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};

function send(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', {
  targetId: page.targetId,
  flatten: true,
});
const s = (method, params) => send(method, params, sessionId);
await s('Runtime.enable');
await s('Page.enable');

await s('Page.navigate', { url: pathToFileURL(indexHtml).href });
await new Promise((r) => setTimeout(r, 3000)); // загрузка + первые кадры

// «1» — как игрок: забег начинается с выбора таланта. Нажимаем несколько раз с
// паузами: холодный старт Phaser бывает дольше одной секунды, и нажатие,
// пришедшее до регистрации клавиш, молча терялось (так и ловилось первый раз).
for (let i = 0; i < 6; i++) {
  await s('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
  await s('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
  await new Promise((r) => setTimeout(r, 700));
}
await new Promise((r) => setTimeout(r, 1200)); // мир шагает без панели выбора

const shot = await s('Page.captureScreenshot', { format: 'png' });
const shotPath = join(tmpdir(), 'qa-file-launch.png');
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

// Пиксели мира читаются по СКРИНШОТУ, а не по канвасу: WebGL-буфер очищается
// после композиции, и чтение канваса вне кадра всегда даёт чёрное (не баг игры).
// data: URI не «затравливает» холст, поэтому анализ идёт прямо со страницы.
const probe = await s('Runtime.evaluate', {
  returnByValue: true,
  awaitPromise: true,
  expression: `(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${shot.data}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r + g + b > 120) lit++;
      if ((i / 4) % 37 === 0) colors.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
    }
    return { w: img.width, h: img.height, litPixels: lit, colorBuckets: colors.size };
  })()`,
});

const state = probe.result.value;

// Два кадра с паузой: мир ОБЯЗАН двигаться. Это же ловит и зависшую панель
// выбора — она стоит намертво, а с клавиатурой 1/2 однажды молча не работали
// (общий off('down') снимал чужие слушатели): стоп-кадр означает, что нажатие
// не дошло до игры.
await new Promise((r) => setTimeout(r, 600));
const shot2 = await s('Page.captureScreenshot', { format: 'png' });
const moving = shot2.data !== shot.data;

// Мир после выбора таланта: многоцветный (спрайты, тинты, HUD), не пустой и живой.
const alive = state.litPixels > 3000 && state.colorBuckets > 8 && moving;
console.log('file-launch smoke:');
console.log('  страница:', indexHtml);
console.log('  кадр:', `${state.w}×${state.h}, светлых пикселей ${state.litPixels}, цветов ${state.colorBuckets}`);
console.log('  мир движется:', moving ? 'да' : 'НЕТ (панель висит или игра замерла)');
console.log('  ошибок в консоли:', errors.length, errors.length ? errors : '');
console.log('  скриншот:', shotPath);

ws.close();
browser.kill();
process.exit(alive && errors.length === 0 ? 0 : 1);
