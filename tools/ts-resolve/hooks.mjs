import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Хук разрешения модулей для тестов.
 *
 * В проекте относительные импорты пишутся без расширения ('./math'), как принято
 * в сборщиках. Node такой импорт не понимает: в ESM расширение обязательно.
 * Собственного сборщика тестов в проекте нет и не нужно — этот хук дописывает
 * '.ts' к относительным импортам без расширения, и встроенный `node --test`
 * запускает те же самые файлы, что видит Vite.
 *
 * Это не «магия ради тестов»: без хука тестируемые модули пришлось бы писать в
 * другом стиле импортов, чем остальной код, и стиль разъехался бы.
 */
export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[a-z]+$/i.test(specifier);
  if (relative && !hasExtension && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
}
