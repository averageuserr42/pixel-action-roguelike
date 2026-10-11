import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpForKill, xpForNextLevel } from './progression';
import { TUNING } from '../config/tuning';
import { kindById } from '../config/enemyKinds';

/**
 * Опыт — за цену цели, а не за факт убийства. Эти тесты и есть контракт того,
 * что «убить танка» и «убить погонялу» — разные события для прогрессии: без них
 * правка опыта молча вернётся к плоскому «1 за всех», и рой снова будет
 * наказан за правильные цели.
 */
test('мелочь стоит одну единицу, толстая цель — три', () => {
  assert.equal(xpForKill('charger', false), TUNING.progression.xpPerKill);
  assert.equal(xpForKill('splitter', false), TUNING.progression.xpPerKill);
  // Танк стоит трёх погонял — ровно столько, сколько на него уходит урона
  // (hpMult вида равен 3): цена цели в опыте следует цене цели в уроне.
  assert.equal(xpForKill('tank', false), kindById('tank').hpMult * TUNING.progression.xpPerKill);
  // Стрелок — дороже мелочи, но дешевле танка: его ценность в охоте на него.
  assert.equal(xpForKill('shooter', false), 2 * TUNING.progression.xpPerKill);
});

test('элита добавляет к цене ЛЮБОГО вида', () => {
  assert.equal(xpForKill('charger', true), 3 * TUNING.progression.xpPerKill);
  assert.equal(xpForKill('tank', true), 5 * TUNING.progression.xpPerKill);
  assert.ok(xpForKill('tank', true) > xpForKill('tank', false));
});

test('порог уровня растёт, а не падает, и опыт цели всегда положителен', () => {
  for (let level = 1; level < 40; level++) {
    assert.ok(xpForNextLevel(level + 1) >= xpForNextLevel(level));
  }
  for (const id of ['charger', 'tank', 'shooter', 'splitter'] as const) {
    assert.ok(xpForKill(id, false) > 0);
    assert.ok(xpForKill(id, true) > xpForKill(id, false));
  }
});
