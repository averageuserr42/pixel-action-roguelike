export interface Vec2 {
  x: number;
  y: number;
}

/** Линейно двигает значение к цели не быстрее, чем на rate. */
export function approach(current: number, target: number, rate: number): number {
  if (current < target) return Math.min(current + rate, target);
  if (current > target) return Math.max(current - rate, target);
  return target;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Удерживает круг заданного радиуса внутри прямоугольника мира. */
export function clampToBounds(p: Vec2, radius: number, w: number, h: number): void {
  p.x = Math.min(Math.max(p.x, radius), w - radius);
  p.y = Math.min(Math.max(p.y, radius), h - radius);
}

/**
 * Поворачивает текущее направление к целевому не более чем на maxRadians.
 * Нужно автострельбе: она доворачивается с ограниченной скоростью, а не
 * мгновенно, и именно поэтому промахивается по движущимся целям — то есть
 * остаётся слабее человеческой руки.
 */
export function rotateToward(current: Vec2, target: Vec2, maxRadians: number): Vec2 {
  const from = Math.atan2(current.y, current.x);
  const to = Math.atan2(target.y, target.x);

  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  const step = Math.max(-maxRadians, Math.min(maxRadians, delta));
  const angle = from + step;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
