import type { Vec2 } from '../../src/core/math';

/**
 * Политика бота-замера: чистая функция «состояние поля -> намерение ввода».
 *
 * Она знает ровно то, что знал бы игрок: где враги, где предметы, готов ли рывок.
 * Ни Phaser, ни времени, ни случайности внутри — поэтому прогон воспроизводим по
 * сиду, а сама политика проверяется тестами без браузера. Это «палец», а не
 * игрок: стенд меряет числа баланса, а не мастерство.
 *
 * Ввод отдаётся тем же объектом, что пишут клавиатура и стик (InputState.move),
 * — бот не получает себе отдельной двери в симуляцию.
 */
export interface BotThreat {
  pos: Vec2;
  /** Состояние врага из его машины: seek | windup | charge | recover. */
  state: string;
}

export interface BotPickup {
  pos: Vec2;
  kind: 'battery' | 'drop';
  /** Сколько предмету осталось лежать: осколок протухает за секунды. */
  ttlLeftMs: number;
}

export interface BotView {
  player: Vec2;
  enemies: readonly BotThreat[];
  pickups: readonly BotPickup[];
  bounds: { w: number; h: number };
  dashReady: boolean;
}

export interface BotIntent {
  move: Vec2;
  dash: boolean;
}

export interface PolicyConfig {
  /** Ближе этого врага бот бросает подбор и уходит. */
  panicRange: number;
  /** Ближе этого бот жмёт рывок: замах и выпад ногами не переиграть. */
  dashRange: number;
  /** Отступ от края: в углу бота зажимает кольцом. */
  edgeMargin: number;
  /** Насколько осколок притягательнее батареи — окно у него короче. */
  dropBias: number;
  /** Дальше этого бот едет рывком, если поле чисто. */
  travelDashRange: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  panicRange: 70,
  // Кольцо стоит на 0.22–0.26 меньшей стороны (107–126 единиц при 486), замах
  // читается за 420–520 мс, а выпад идёт 160–330. Рывок надо жать ДО того, как
  // выпад пошёл, а не вплотную: замер стенда с dashRange 48 давал смерть на 2.3 с
  // и ноль батарей — бот просто не успевал ни убежать, ни подобрать.
  dashRange: 92,
  edgeMargin: 26,
  dropBias: 1.35,
  travelDashRange: 150,
};

/**
 * Намерение на один шаг: идти к ближайшей награде, уходить от ближайшей угрозы,
 * рвать рывком тогда, когда ноги не спасут. Порядок приоритетов намеренный —
 * внутри panicRange страх важнее жадности, иначе бот собирает батареи в упор к
 * врагу и умирает там, где игрок бы ушёл.
 */
export function kiteCollect(view: BotView, cfg: PolicyConfig = DEFAULT_POLICY): BotIntent {
  const threat = nearestThreat(view);
  const committed = committingThreat(view);
  const target = bestPickup(view, cfg);
  const toTarget = target ? direction(view.player, target.pos, 1) : null;

  // Рывок уходит боком и только под уже объявленный удар: тратить его на
  // «просто побыстрее» нельзя — на выпад его тогда не останется.
  if (committed && view.dashReady && committed.dist < cfg.dashRange) {
    return { move: dodgeSide(view, committed.pos), dash: true };
  }

  let x = 0;
  let y = 0;
  const away = threat ? direction(view.player, threat.pos, -1) : null;
  if (away && threat && threat.dist < cfg.panicRange) {
    x += away.x;
    y += away.y;
    // Даже убегая, бот не забывает награду: иначе пул пустеет и фигуры молчат.
    if (toTarget) {
      x += toTarget.x * 0.35;
      y += toTarget.y * 0.35;
    }
  } else if (toTarget) {
    x += toTarget.x;
    y += toTarget.y;
  }

  // Край поля не должен становиться ловушкой: от стены отходим, а не трёмся в неё.
  const edge = edgePressure(view.player, view.bounds, cfg.edgeMargin);
  x += edge.x;
  y += edge.y;

  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }

  // Ехать рывком можно только когда впереди никто не целится и цель далеко.
  const travel =
    !committed &&
    !threat &&
    view.dashReady &&
    target !== null &&
    target.dist > cfg.travelDashRange &&
    toTarget !== null;
  if (travel && toTarget) return { move: toTarget, dash: true };

  return { move: { x, y }, dash: false };
}

/**
 * Враг, который уже объявил удар: замах или сам выпад. Именно под него и
 * тратится рывок — остальное бот переигрывает ногами.
 */
export function committingThreat(view: BotView): Nearest | null {
  let best: Nearest | null = null;
  for (const enemy of view.enemies) {
    if (enemy.state !== 'windup' && enemy.state !== 'charge') continue;
    const dist = Math.hypot(enemy.pos.x - view.player.x, enemy.pos.y - view.player.y);
    if (!best || dist < best.dist) best = { ...enemy, dist };
  }
  return best;
}

interface Nearest extends BotThreat {
  dist: number;
}

/** Ближайший враг: по нему решается, уходить ли и жать ли рывок. */
export function nearestThreat(view: BotView): Nearest | null {
  let best: Nearest | null = null;
  for (const enemy of view.enemies) {
    const dist = Math.hypot(enemy.pos.x - view.player.x, enemy.pos.y - view.player.y);
    if (!best || dist < best.dist) best = { ...enemy, dist };
  }
  return best;
}

interface PickTarget extends BotPickup {
  dist: number;
  score: number;
}

/**
 * Что бот считает своей наградой. Осколок ценнее батареи не содержимым, а окном:
 * он лежит секунды, и «потом» для него не бывает.
 */
export function bestPickup(view: BotView, cfg: PolicyConfig = DEFAULT_POLICY): PickTarget | null {
  let best: PickTarget | null = null;
  for (const item of view.pickups) {
    const dist = Math.hypot(item.pos.x - view.player.x, item.pos.y - view.player.y);
    const urgency = item.kind === 'drop' ? cfg.dropBias : 1;
    // Осколок считается вдвое ближе, чем лежит: он не дождётся, батарея дождётся.
    const score = dist / urgency;
    if (!best || score < best.score) best = { ...item, dist, score };
  }
  return best;
}

/** Единичный вектор из from в to; sign = -1 разворачивает (уход от точки). */
function direction(from: Vec2, to: Vec2, sign: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (dx / len) * sign, y: (dy / len) * sign };
}

/** Насколько игрок прижат к краю: отходить от стены важнее, чем идти вдоль неё. */
function edgePressure(player: Vec2, bounds: { w: number; h: number }, margin: number): Vec2 {
  let x = 0;
  let y = 0;
  if (player.x < margin) x += (margin - player.x) / margin;
  if (player.x > bounds.w - margin) x -= (player.x - (bounds.w - margin)) / margin;
  if (player.y < margin) y += (margin - player.y) / margin;
  if (player.y > bounds.h - margin) y -= (player.y - (bounds.h - margin)) / margin;
  return { x, y };
}

/**
 * Куда рвать боком. Из двух перпендикуляров берём тот, где свободнее: замер на
 * живом лупе показал, что уклонение «в центр поля» уводило прямиком на второго
 * врага, и бот умирал на 2.3-й секунде. Считаем запас по всем, кроме самого
 * угрожающего, и запас до стены — уклонение в стену не уклонение.
 */
function dodgeSide(view: BotView, threatAt: Vec2): Vec2 {
  const player = view.player;
  const ax = player.x - threatAt.x;
  const ay = player.y - threatAt.y;
  const len = Math.hypot(ax, ay) || 1;
  const nx = ax / len;
  const ny = ay / len;
  const first = { x: -ny, y: nx };
  const second = { x: ny, y: -nx };
  const clearance = (dir: Vec2): number => {
    const at = { x: player.x + dir.x * 28, y: player.y + dir.y * 28 };
    let nearest = Infinity;
    for (const enemy of view.enemies) {
      if (enemy.pos.x === threatAt.x && enemy.pos.y === threatAt.y) continue;
      nearest = Math.min(nearest, Math.hypot(enemy.pos.x - at.x, enemy.pos.y - at.y));
    }
    const wall = Math.min(
      at.x,
      at.y,
      view.bounds.w - at.x,
      view.bounds.h - at.y,
    );
    return Math.min(nearest, wall * 2);
  };
  return clearance(first) >= clearance(second) ? first : second;
}
