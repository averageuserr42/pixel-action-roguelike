import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../core/rng';
import {
  addPickup,
  collect,
  countKind,
  createPickupField,
  createTally,
  spawnPoint,
  stepAge,
  takeSpawn,
} from './pickups';

const INTERVAL = 2400;
const BATTERY_TTL = 16000;
const DROP_TTL = 2800;

function battery(f: ReturnType<typeof createPickupField>, x: number, y: number): void {
  addPickup(f, { x, y }, { kind: 'battery', value: 6, ttlMs: BATTERY_TTL, radius: 4 });
}

function drop(f: ReturnType<typeof createPickupField>, x: number, y: number): void {
  addPickup(f, { x, y }, { kind: 'drop', value: 2, ttlMs: DROP_TTL, radius: 3 });
}

test('спавн идёт по таймеру и уважает предел поля', () => {
  const f = createPickupField();
  // Первый шаг: таймера ещё нет — батарея выкладывается сразу.
  assert.equal(takeSpawn(f, 0.1, INTERVAL, 2), true);
  battery(f, 0, 0);

  assert.equal(takeSpawn(f, 1, INTERVAL, 2), false, 'через секунду пауза ещё не вышла');
  assert.equal(takeSpawn(f, 2, INTERVAL, 2), true, 'накопленных 2.4 с хватает');
  battery(f, 1, 0);

  assert.equal(takeSpawn(f, 10, INTERVAL, 2), false, 'на пределе поля новых батарей нет');
  assert.equal(
    f.spawnTimerMs,
    INTERVAL,
    'пока места нет, время замирает: ни копится пачкой, ни сгорает',
  );
  assert.equal(f.items.length, 2);
});

test('освободившееся место не выстреливает батареей: темп задаёт пауза, а не подбор', () => {
  const f = createPickupField();
  const tally = createTally();
  assert.equal(takeSpawn(f, 0.01, INTERVAL, 2), true);
  battery(f, 0, 0);
  assert.equal(takeSpawn(f, INTERVAL / 1000, INTERVAL, 2), true);
  battery(f, 200, 0);

  // Игрок забрал одну — место освободилось, но пауза ещё не вышла. Прежняя
  // версия обнуляла таймер на полном поле и выдавала батарею в тот же шаг,
  // поэтому быстрый игрок получал батарей вдвое больше номинала.
  collect(f, { x: 0, y: 0 }, 10, tally);
  assert.equal(tally.batteries, 1);
  assert.equal(takeSpawn(f, 0.008, INTERVAL, 2), false, 'батарея не выпадает мгновенно');
  assert.equal(takeSpawn(f, INTERVAL / 1000, INTERVAL, 2), true, 'а по паузе — выпадает');
});

test('осколки не занимают места батарей: урожай с убитых не отбирает плановую энергию', () => {
  const f = createPickupField();
  for (let i = 0; i < 6; i++) drop(f, i, 0);
  assert.equal(countKind(f, 'drop'), 6);
  assert.equal(takeSpawn(f, 5, INTERVAL, 2), true, 'поле батарей пусто — батарея обязана появиться');
});

test('у каждого предмета свой срок жизни: осколок исчезает, батарея лежит', () => {
  const f = createPickupField();
  battery(f, 0, 0);
  drop(f, 10, 0);
  stepAge(f, DROP_TTL / 1000 + 0.1);
  assert.equal(f.items.length, 1, 'осколок обязан истечь');
  assert.equal(f.items[0].kind, 'battery');
  stepAge(f, BATTERY_TTL / 1000);
  assert.equal(f.items.length, 0, 'просроченная батарея тоже исчезает');
});

test('подбор забирает только то, что рядом, и считает по видам', () => {
  const f = createPickupField();
  battery(f, 100, 100);
  drop(f, 104, 100);
  battery(f, 300, 300);
  const tally = createTally();

  collect(f, { x: 100, y: 100 }, 10, tally);
  assert.equal(tally.batteries, 1);
  assert.equal(tally.batteryTok, 6);
  assert.equal(tally.drops, 1);
  assert.equal(tally.dropTok, 2, 'Ток осколка считается отдельно от батарейного');
  assert.equal(f.items.length, 1, 'далёкая батарея обязана остаться лежать');

  // Счётчик обнуляется на каждом подборе: он переиспользуется в шаге.
  collect(f, { x: 100, y: 100 }, 10, tally);
  assert.equal(tally.batteryTok + tally.dropTok, 0);
  collect(f, { x: 300, y: 300 }, 10, tally);
  assert.equal(tally.batteryTok, 6);
  assert.equal(tally.drops, 0);
  assert.equal(f.items.length, 0);
});

test('точка появления не ближе отступа к игроку и внутри поля', () => {
  const rng = mulberry32(7);
  const player = { x: 320, y: 180 };
  const margin = 20;
  const away = 100;
  for (let i = 0; i < 50; i++) {
    const p = spawnPoint(rng, 640, 360, margin, player, away);
    assert.ok(p.x >= margin && p.x <= 640 - margin, `x вне поля: ${p.x}`);
    assert.ok(p.y >= margin && p.y <= 360 - margin, `y вне поля: ${p.y}`);
    assert.ok(
      Math.hypot(p.x - player.x, p.y - player.y) >= away - 1e-9,
      `батарея легла под ногами: ${Math.hypot(p.x - player.x, p.y - player.y)}`,
    );
  }
});

test('точка появления находится даже на тесном поле', () => {
  const rng = mulberry32(3);
  const player = { x: 50, y: 50 };
  const p = spawnPoint(rng, 100, 100, 10, player, 200);
  assert.ok(p.x >= 10 && p.x <= 90 && p.y >= 10 && p.y <= 90);
});
