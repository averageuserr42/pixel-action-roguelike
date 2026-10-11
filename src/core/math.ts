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
