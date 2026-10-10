/**
 * Игра ландшафтная: поле вписывается в экран, но его аспект зажат в диапазон
 * 16:9 … 21:9. Обычный телефон в горизонтали (19.5:9) попадает внутрь диапазона
 * и заполняет экран целиком; ультраширокий монитор получает поле не шире 21:9
 * и узкие полосы по краям — это дешевле, чем растягивать арену в кишку.
 *
 * Телефон в вертикали играть не может: мир слишком мелкий, поэтому сцена встаёт
 * и показывается заглушка «поверни телефон» (needsRotate).
 *
 * Размер вьюпорта — глобальное состояние мира, а не константа: он зависит от
 * устройства. Меняется он только здесь.
 */
export interface Viewport {
  /** Логический размер поля (в игровых единицах). */
  w: number;
  h: number;
  /** Целочисленный масштаб: сколько CSS-пикселей приходится на один игровой. */
  zoom: number;
  /** Меньшая сторона поля: от неё считаются дистанции, влияющие на честность. */
  minSide: number;
  /** Экран выше, чем шире, и у устройства есть палец: нужна заглушка поворота. */
  needsRotate: boolean;
}

/** Ниже этого аспекта экран считается вертикальным. */
const MIN_ASPECT = 16 / 9;
/** Шире этого поле не растёт: арена-«кишка» неинтересна. */
const MAX_ASPECT = 21 / 9;
/** Порог, ниже которого логический размер поля считается неиграбельно мелким. */
const MIN_LOGICAL_H = 300;
const MIN_LOGICAL_W = 180;
const MAX_ZOOM = 6;

export const VIEW: Viewport = { w: 480, h: 270, zoom: 1, minSide: 270, needsRotate: false };

/** Пересчитывает поле под текущий размер окна. Вызывать до создания игры и при ресайзе. */
export function refreshViewport(cssW = window.innerWidth, cssH = window.innerHeight): Viewport {
  const aspect = cssW / Math.max(1, cssH);
  const target = Math.min(Math.max(aspect, MIN_ASPECT), MAX_ASPECT);

  // Поле вписываем по ширине, и только если при этом не влезаем по высоте
  // (сверхширокий экран) — по высоте.
  const fieldW = Math.min(cssW, cssH * target);
  const fieldH = fieldW / target;

  let zoom = 1;
  for (let z = MAX_ZOOM; z >= 1; z--) {
    if (fieldH / z >= MIN_LOGICAL_H && fieldW / z >= MIN_LOGICAL_W) {
      zoom = z;
      break;
    }
  }

  VIEW.zoom = zoom;
  VIEW.w = Math.max(1, Math.floor(fieldW / zoom));
  VIEW.h = Math.max(1, Math.floor(fieldH / zoom));
  VIEW.minSide = Math.min(VIEW.w, VIEW.h);
  // Заглушку показываем только устройствам с пальцем: узкое окно на мониторе —
  // это просто узкое окно, там играть можно.
  VIEW.needsRotate = isTouchDevice() && aspect < 1;
  return VIEW;
}

/**
 * Переводит размеры интерфейса из CSS-пикселей в игровые.
 * Размеры органов управления задаются в CSS-пикселях, потому что палец живёт
 * в физическом мире: кнопка должна быть одинаково удобной и на телефоне,
 * и на большом мониторе с другим масштабом.
 */
export function cssToLogical(cssPixels: number): number {
  return cssPixels / VIEW.zoom;
}

/** Есть ли у устройства сенсорный ввод — нужно, чтобы не показывать подсказки про клавиатуру. */
export function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0;
}
