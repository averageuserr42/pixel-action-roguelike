import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_KINDS, kindById, kindsForLevel } from './enemyKinds';

test('видов ровно четыре', () => {
  assert.deepEqual(
    ENEMY_KINDS.map((k) => k.id),
    ['charger', 'tank', 'shooter', 'splitter'],
  );
});

test('виды открываются по уровню', () => {
  assert.deepEqual(kindsForLevel(1).map((k) => k.id), ['charger']);
  assert.deepEqual(kindsForLevel(3).map((k) => k.id), ['charger', 'tank']);
  assert.deepEqual(kindsForLevel(5).map((k) => k.id), ['charger', 'tank', 'shooter']);
  assert.equal(kindsForLevel(7).length, 4);
  assert.equal(kindsForLevel(99).length, 4, 'выше последнего гейта список не растёт');
});

test('эталонный вид не меняет нынешние числа', () => {
  const charger = kindById('charger');
  assert.equal(charger.hpMult, 1);
  assert.equal(charger.speedMult, 1);
  assert.equal(charger.usesRing, true);
  assert.equal(charger.canIntercept, true);
  assert.equal(charger.usesStateColors, true);
});

test('кольцо и перехват только у погонялы', () => {
  for (const kind of ENEMY_KINDS.filter((k) => k.id !== 'charger')) {
    assert.equal(kind.usesRing, false, `${kind.id} не должен занимать кольцо`);
    assert.equal(kind.canIntercept, false, `${kind.id} не должен быть перехватчиком`);
  }
});

test('цвета уникальны, веса и размеры положительны', () => {
  assert.equal(new Set(ENEMY_KINDS.map((k) => k.color)).size, ENEMY_KINDS.length);
  for (const kind of ENEMY_KINDS) {
    assert.ok(kind.spawnWeight > 0, `${kind.id}: вес`);
    assert.ok(kind.radius > 0, `${kind.id}: радиус`);
    assert.ok(kind.hpMult > 0, `${kind.id}: HP`);
    assert.ok(kind.speedMult > 0, `${kind.id}: скорость`);
    assert.ok(kind.minLevel >= 1, `${kind.id}: уровень появления`);
  }
});

test('порядок видов совпадает с порядком открытия', () => {
  for (let i = 1; i < ENEMY_KINDS.length; i++) {
    assert.ok(ENEMY_KINDS[i].minLevel >= ENEMY_KINDS[i - 1].minLevel);
  }
});
