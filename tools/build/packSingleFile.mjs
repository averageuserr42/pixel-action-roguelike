/**
 * Упаковка сборки в ОДИН файл: dist/index.html — вся игра целиком.
 *
 * Зачем. Игра должна запускаться ДВОЙНЫМ КЛИКОМ — как приложение, без сервера,
 * установки и интернета. Два препятствия и снимаются здесь:
 *
 *  1. `<script type="module" src="./assets/...">` браузер не грузит из file://
 *     (CORS для origin «null»). Поэтому скрипт вшивается прямо в HTML.
 *  2. Спрайты уже встроены в скрипт как data: URI (см. vite.config.ts и
 *     config/textures) — локальные картинки браузер в WebGL-текстуры не отдаёт.
 *
 * Проверка на внешние ссылки — не педантизм, а страховка от тихой поломки:
 * выросший спрайт сверх лимита инлайна превратился бы в отдельный файл, и игра
 * снова открылась бы из файла без картинок. Лучше упасть на сборке с понятной
 * ошибкой, чем дать игроку квадраты вместо спрайтов.
 *
 * Запускается последним шагом `npm run build`. Ничего в исходниках не меняет.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');
const htmlPath = join(dist, 'index.html');

let html = readFileSync(htmlPath, 'utf8');

// 1. Внешний модульный скрипт -> инлайн. Функция-замена, потому что в бандле
//    полно `$` и `\`, которые шаблонная подмена интерпретировала бы как образец.
const scriptTag = /<script type="module"[^>]*\bsrc="\.\/assets\/([^"]+\.js)"[^>]*><\/script>/;
const match = scriptTag.exec(html);
if (!match) {
  throw new Error('packSingleFile: в dist/index.html не найден модульный скрипт сборки');
}
const js = readFileSync(join(dist, 'assets', match[1]), 'utf8');
// `</script` внутри JS оборачивается в `<\/script`: иначе браузер закроет
// инлайновый скрипт на первом же таком совпадении в строке или регулярке.
const safeJs = js.replace(/<\/script/gi, '<\\/script');
html = html.replace(scriptTag, () => `<script type="module">\n${safeJs}\n</script>`);

// 2. Ни одной внешней ссылки остаться не должно: ни в HTML, ни в скрипте.
const externalInHtml = html.match(/(?:src|href)="\.\/assets\//g);
if (externalInHtml) {
  throw new Error('packSingleFile: в HTML остались внешние ассеты (src/href на ./assets/)');
}
if (/["']\.\/assets\//.test(js)) {
  throw new Error(
    'packSingleFile: скрипт ссылается на файлы в ./assets/ — какой-то ассет вырос ' +
      'за assetsInlineLimit (vite.config.ts). Увеличь лимит: игра из файла ' +
      'запускается только целиком.',
  );
}

// 3. Вшитый скрипт из dist/assets больше не нужен: папка отдаётся как есть.
rmSync(join(dist, 'assets', match[1]));
writeFileSync(htmlPath, html);

const kb = Math.round(html.length / 1024);
console.log(`packSingleFile: dist/index.html — ${kb} КБ, вся игра в одном файле`);
