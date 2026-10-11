/**
 * Арт: какие текстуры загружаются и какого размера они выглядят в игре.
 *
 * Модуль существует, чтобы имя файла и его размер жили в ОДНОМ месте. Иначе
 * картинка меняется в трёх файлах сразу (загрузка, сущность, отрисовка), и одно
 * из них обязательно забывается — на этом и стояли прошлые кружки: вид был
 * зашит в каждую сущность отдельно.
 *
 * Единицы: высота — в игровых единицах, а не в пикселях экрана. Спрайты одного
 * вида попадают на экран одинаково крупными при любом масштабе поля, потому что
 * масштаб считается от ФАКТИЧЕСКОЙ высоты текстуры.
 *
 * `height` — это ЖЕЛАЕМЫЙ размер, а не точный: масштаб округляется до целого
 * делителя (см. artScale). Целое деление здесь принципиально. Игровой кадр мельче
 * исходника в три-четыре раза (существо — 10–17 игровых единиц при текстуре в
 * 35–73 пикселя), и при произвольной дроби nearest-neighbour берёт у соседних
 * столбцов разное число текселов: один съедается целиком, другой не берётся
 * вовсе. На глаз это контур, который в одном кадре ровный, в другом — лестницей,
 * и на движении он мерцает. Целый делитель берёт каждый N-й тексел всегда,
 * поэтому силуэт устойчив.
 *
 * Ассеты: CC0 (общественное достояние), наборы Kenney —
 * `moreenemiesanimations` (все существа) и `topdown-shooter`, `abstract-platformer`
 * (предметы). Атрибуция не требуется, но источник указан в `public/assets/CREDITS.md`.
 */
export interface ArtSpec {
  /** Ключ текстуры в Phaser-лоадере. */
  key: string;
  /** Имя файла в public/assets. */
  file: string;
  /** Высота на экране в игровых единицах. */
  height: number;
}

export const ART = {
  player: { key: 'player', file: 'player.png', height: 14 },
  /** Виды врагов: свои видны и различимы силуэтом, а не цветом. */
  charger: { key: 'charger', file: 'charger.png', height: 15 },
  tank: { key: 'tank', file: 'tank.png', height: 17 },
  shooter: { key: 'shooter', file: 'shooter.png', height: 16 },
  splitter: { key: 'splitter', file: 'splitter.png', height: 10 },
  /** Спутники и устройства. */
  turret: { key: 'turret', file: 'turret.png', height: 14 },
  drone: { key: 'drone', file: 'drone.png', height: 11 },
  spirit: { key: 'spirit', file: 'spirit.png', height: 12 },
  mote: { key: 'mote', file: 'mote.png', height: 9 },
  /**
   * Предметы Тока: и батарея, и осколок мельче самого мелкого врага (делитель —
   * 9,75): предмет обязан читаться как предмет, а не как угроза. Осколок мельче
   * батареи — он искра с убитого, а не запас на будущее.
   */
  battery: { key: 'battery', file: 'battery.png', height: 8 },
  drop: { key: 'drop', file: 'drop.png', height: 6 },
} as const satisfies Record<string, ArtSpec>;

export type ArtName = keyof typeof ART;

/** Все текстуры забега: сцена грузит их одним списком, и список — часть данных. */
export const ART_FILES: readonly ArtSpec[] = Object.values(ART);

/**
 * Во сколько раз сжимается текстура: целое число, ближайшее к отношению
 * «исходник / желаемый размер». Единица — минимум, иначе спрайт пришлось бы
 * увеличивать: увеличение пиксель-арта ломает его замысел сильнее, чем размер
 * на пару единиц больше желаемого.
 */
export function artDivisor(spec: ArtSpec, textureHeight: number): number {
  if (textureHeight <= 0) return 1;
  return Math.max(1, Math.round(textureHeight / spec.height));
}

/**
 * Масштаб спрайта. Фактическая высота текстуры приходит аргументом: у существ
 * спрайты разной пропорции (крылья, антенны), и подгонка «на глаз» константой
 * делала бы одних великанами, а других точками.
 */
export function artScale(spec: ArtSpec, textureHeight: number): number {
  return 1 / artDivisor(spec, textureHeight);
}

/**
 * Размер спрайта на экране по факту — с учётом округления до целого делителя.
 * Нужен там, где по спрайту раскладывают что-то другое (подпись, кольцо): иначе
 * раскладка считалась бы от желаемого размера, которого на экране нет.
 */
export function artSize(spec: ArtSpec, textureHeight: number): number {
  return textureHeight / artDivisor(spec, textureHeight);
}
