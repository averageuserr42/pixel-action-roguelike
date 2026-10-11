import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestPickup, kiteCollect, nearestThreat, type BotView } from './policy';

/**
 * Политика стенда — чистая функция, поэтому её правила проверяются без браузера.
 * Проверяются ровно те решения, из-за которых замер может врать: с какой
 * дистанции бот убегает, когда жмёт рывок, к какому предмету идёт.
 */
function view(over: Partial<BotView> = {}): BotView {
  return {
    player: { x: 100, y: 100 },
    enemies: [],
    pickups: [],
    bounds: { w: 400, h: 200 },
    dashReady: true,
    ...over,
  };
}

const unit = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

test('пустое поле — идёт к предмету и не рвёт рывком', () => {
  const intent = kiteCollect(
    view({ pickups: [{ pos: { x: 180, y: 100 }, kind: 'battery', ttlLeftMs: 5000 }] }),
  );
  assert.ok(intent.move.x > 0.9, `шёл бы вправо, а вектор ${intent.move.x}`);
  assert.ok(Math.abs(intent.move.y) < 0.1);
  assert.equal(intent.dash, false);
});

test('враг вплотную — рывок, и именно боком, а не в лоб', () => {
  const enemy = { pos: { x: 120, y: 100 }, state: 'windup' };
  const intent = kiteCollect(view({ enemies: [enemy] }));
  assert.equal(intent.dash, true, 'в упор ноги не спасают — рывок обязан случиться');
  assert.ok(Math.abs(unit(intent.move) - 1) < 1e-6, 'рывок идёт единичным вектором');
  // Направление врага — (1, 0). Перпендикуляр не должен иметь продольной части.
  assert.ok(Math.abs(intent.move.x) < 1e-6, `рывок вдоль выпада — это смерть: ${intent.move.x}`);
});

test('рывок на перезарядке — уходит ногами, а не стоит', () => {
  const intent = kiteCollect(
    view({ enemies: [{ pos: { x: 140, y: 100 }, state: 'seek' }], dashReady: false }),
  );
  assert.equal(intent.dash, false);
  assert.ok(intent.move.x < -0.5, `должен уходить от врага влево, а вектор ${intent.move.x}`);
});

test('осколок перевешивает батарею, если лежит не сильно дальше', () => {
  const target = bestPickup(
    view({
      pickups: [
        { pos: { x: 150, y: 100 }, kind: 'battery', ttlLeftMs: 9000 },
        { pos: { x: 160, y: 100 }, kind: 'drop', ttlLeftMs: 1200 },
      ],
    }),
  );
  assert.equal(target?.kind, 'drop', 'у осколка окно короче — он и цель');
});

test('у края поля бот отходит от стены, а не трётся в неё', () => {
  const intent = kiteCollect(view({ player: { x: 2, y: 100 } }));
  assert.ok(intent.move.x > 0.5, `от стены надо уходить вправо, а вектор ${intent.move.x}`);
});

test('ввод никогда не длиннее единицы: страх, жадность и край вместе', () => {
  const intent = kiteCollect(
    view({
      player: { x: 4, y: 4 },
      enemies: [{ pos: { x: 30, y: 30 }, state: 'charge' }],
      pickups: [{ pos: { x: 380, y: 190 }, kind: 'battery', ttlLeftMs: 9000 }],
      dashReady: false,
    }),
  );
  assert.ok(unit(intent.move) <= 1 + 1e-9, `длина вектора ${unit(intent.move)}`);
});

test('ближайший враг считается по расстоянию, а не по порядку в списке', () => {
  const near = nearestThreat(
    view({
      enemies: [
        { pos: { x: 300, y: 100 }, state: 'seek' },
        { pos: { x: 120, y: 100 }, state: 'seek' },
      ],
    }),
  );
  assert.equal(near?.pos.x, 120);
  assert.equal(near?.dist, 20);
});
