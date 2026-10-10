import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../core/rng';
import { eliteHpBonus, eliteSpeedMult, nonChaserCap, pickSpawn } from './spawnDirector';

test('на первом уровне спавнится только погоняла', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 40; i++) assert.equal(pickSpawn(1, 'normal', 4, 0, rng).kind, 'charger');
});

test('пока живых меньше двух, всегда приходит погоняла', () => {
  const rng = mulberry32(21);
  for (let i = 0; i < 40; i++) assert.equal(pickSpawn(12, 'normal', 1, 0, rng).kind, 'charger');
});

test('тот же сид — та же последовательность видов', () => {
  const run = () => {
    const r = mulberry32(99);
    return Array.from({ length: 12 }, () => pickSpawn(9, 'hardcore', 8, 1, r));
  };
  assert.deepEqual(run(), run());
});

test('потолок не-погонял удерживается', () => {
  assert.equal(nonChaserCap(1), 1);
  assert.equal(nonChaserCap(3), 1);
  assert.equal(nonChaserCap(8), 3);
  const rng = mulberry32(3);
  for (let i = 0; i < 50; i++) assert.equal(pickSpawn(12, 'hardcore', 8, 3, rng).kind, 'charger');
});

test('элиты не раньше четвёртого уровня', () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 40; i++) assert.equal(pickSpawn(3, 'normal', 4, 0, rng).elite, null);
});

test('бросок элиты читается по сиду', () => {
  assert.equal(pickSpawn(8, 'normal', 4, 0, () => 0).elite, 'shielded');
  assert.equal(pickSpawn(8, 'normal', 4, 0, () => 0.999).elite, null);
});

test('на высоком уровне не-погонялы действительно приходят', () => {
  const rng = mulberry32(4);
  const kinds = new Set(Array.from({ length: 200 }, () => pickSpawn(12, 'normal', 8, 0, rng).kind));
  assert.ok(kinds.has('tank') && kinds.has('shooter') && kinds.has('splitter'), [...kinds].join(','));
});

test('числа модификаторов', () => {
  assert.equal(eliteHpBonus('shielded'), 2);
  assert.equal(eliteHpBonus('swift'), 0);
  assert.equal(eliteHpBonus('volatile'), 0);
  assert.equal(eliteSpeedMult('swift'), 1.35);
  assert.equal(eliteSpeedMult('volatile'), 1);
});
