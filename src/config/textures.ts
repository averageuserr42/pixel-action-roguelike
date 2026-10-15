import batteryUrl from '../assets/battery.png';
import chargerUrl from '../assets/charger.png';
import droneUrl from '../assets/drone.png';
import dropUrl from '../assets/drop.png';
import moteUrl from '../assets/mote.png';
import playerUrl from '../assets/player.png';
import shooterUrl from '../assets/shooter.png';
import spiritUrl from '../assets/spirit.png';
import splitterUrl from '../assets/splitter.png';
import tankUrl from '../assets/tank.png';
import turretUrl from '../assets/turret.png';

/**
 * Откуда браузер берёт спрайты.
 *
 * Текстуры — ES-импорты, а не файлы рядом с index.html: Vite встраивает их в
 * сборку как data: URI, и игра запускается ДВОЙНЫМ КЛИКОМ прямо из файла
 * (file://). Это не украшение упаковки. Браузер не отдаёт локальный файл в
 * WebGL-текстуру — texImage2D бросает SecurityError (проверено на Chrome:
 * локальный PNG — отказ, data: URI — норма), и игра с внешними картинками из
 * file:// стартовала бы без спрайтов вовсе.
 *
 * Модуль знает только адреса. Имена файлов и размеры живут в config/art, а
 * существование каждого файла проверяет тест art.test — он читает их с диска.
 */
const TEXTURE_URLS: Record<string, string> = {
  'battery.png': batteryUrl,
  'charger.png': chargerUrl,
  'drone.png': droneUrl,
  'drop.png': dropUrl,
  'mote.png': moteUrl,
  'player.png': playerUrl,
  'shooter.png': shooterUrl,
  'spirit.png': spiritUrl,
  'splitter.png': splitterUrl,
  'tank.png': tankUrl,
  'turret.png': turretUrl,
};

/**
 * Адрес текстуры по имени файла. Неизвестное имя — честная ошибка, а не
 * «зелёный квадрат» Phaser: промах в таблице арта видно сразу и там, где он
 * случился.
 */
export function textureUrl(file: string): string {
  const url = TEXTURE_URLS[file];
  if (!url) throw new Error(`нет текстуры для файла: ${file}`);
  return url;
}
